import { describe, expect, it } from 'vitest'
import {
  decisionForChoice,
  excessDueText,
  excessInvoiceStatusLine,
  excessNeedsConfirming,
  parseExcessChoice,
} from '../decision'

const UUID = '3f2b1c9e-8a7d-4e6f-9b0a-1c2d3e4f5a6b'

describe('parseExcessChoice', () => {
  it('accepts each valid choice', () => {
    expect(parseExcessChoice({ kind: 'new_invoice', amountIncGst: '500.004' })).toEqual({ kind: 'new_invoice', amountIncGst: 500 })
    expect(parseExcessChoice({ kind: 'attach_existing', invoiceId: UUID })).toEqual({ kind: 'attach_existing', invoiceId: UUID })
    expect(parseExcessChoice({ kind: 'existing_not_attached' })).toEqual({ kind: 'existing_not_attached' })
    expect(parseExcessChoice({ kind: 'no_excess' })).toEqual({ kind: 'no_excess' })
    expect(parseExcessChoice({ kind: 'not_collecting', reason: 'cash_settlement', note: '  fence cash settled ' }))
      .toEqual({ kind: 'not_collecting', reason: 'cash_settlement', note: 'fence cash settled' })
  })

  it('makes the note optional for every reason', () => {
    for (const reason of ['cash_settlement', 'insurer_waived', 'already_paid', 'other']) {
      expect(parseExcessChoice({ kind: 'not_collecting', reason })).toEqual({ kind: 'not_collecting', reason, note: null })
    }
  })

  it('rejects anything else', () => {
    for (const raw of [
      null, 'x', {}, { kind: 'collect' },
      { kind: 'new_invoice', amountIncGst: 0 },
      { kind: 'new_invoice', amountIncGst: -5 },
      { kind: 'new_invoice', amountIncGst: 'abc' },
      { kind: 'new_invoice', amountIncGst: 1_000_000 },
      { kind: 'attach_existing', invoiceId: 'not-a-uuid' },
      { kind: 'not_collecting', reason: 'because' },
    ]) {
      expect(parseExcessChoice(raw)).toBeNull()
    }
  })
})

describe('decisionForChoice', () => {
  it('maps choices to the job decision', () => {
    expect(decisionForChoice({ kind: 'new_invoice', amountIncGst: 500 })).toBe('collect')
    expect(decisionForChoice({ kind: 'attach_existing', invoiceId: UUID })).toBe('collect')
    expect(decisionForChoice({ kind: 'existing_not_attached' })).toBe('collect')
    expect(decisionForChoice({ kind: 'no_excess' })).toBe('nil')
    expect(decisionForChoice({ kind: 'not_collecting', reason: 'insurer_waived' })).toBe('insurer_waived')
  })
})

describe('excessNeedsConfirming', () => {
  it('flags insurance jobs with no amount and no decision only', () => {
    expect(excessNeedsConfirming({ applies: true, amount: null, decision: null })).toBe(true)
    expect(excessNeedsConfirming({ applies: true, amount: 0, decision: null })).toBe(true)
    expect(excessNeedsConfirming({ applies: true, amount: 500, decision: null })).toBe(false)
    expect(excessNeedsConfirming({ applies: true, amount: null, decision: 'nil' })).toBe(false)
    expect(excessNeedsConfirming({ applies: false, amount: null, decision: null })).toBe(false)
  })
})

describe('excessDueText', () => {
  it('is "on receipt" without payment terms', () => {
    expect(excessDueText('2026-10-21', 0)).toBe('on receipt')
    expect(excessDueText('2026-10-21', null)).toBe('on receipt')
    expect(excessDueText(null, 7)).toBe('on receipt')
  })

  it('adds the terms to the issue date in Perth time', () => {
    expect(excessDueText('2026-10-21', 7)).toBe('by 28 Oct 2026')
    expect(excessDueText('2026-12-28', 14)).toBe('by 11 Jan 2027')
  })
})

describe('excessInvoiceStatusLine', () => {
  const inv = { id: UUID, ref: 'IRC1001-EX', amountIncGst: 500, status: 'sent', issuedDate: '2026-10-21', paidDate: null }

  it('never says unpaid — asks the office to check instead', () => {
    const line = excessInvoiceStatusLine(inv)
    expect(line).toBe('Excess invoice IRC1001-EX ($500.00) sent 21 Oct 2026 — check it’s been paid before works start')
    expect(line.toLowerCase()).not.toContain('unpaid')
  })

  it('says paid once accounts record it', () => {
    expect(excessInvoiceStatusLine({ ...inv, paidDate: '2026-10-25' })).toBe('Excess paid 25 Oct 2026 (Excess invoice IRC1001-EX, $500.00)')
  })
})
