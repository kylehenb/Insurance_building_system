import { describe, it, expect } from 'vitest'
import { ORDER_CHECKS, phoneKind, runOrderChecks, type OrderCheck } from '../checks'

// The checks on an insurer order: what kind of phone number it gives for the
// insured, and what each situation tells the office and adds to the acknowledgement.

describe('phoneKind', () => {
  it('finds a mobile however it is written, even beside a landline', () => {
    for (const p of ['0412345678', '0412 345 678', '+61 412 345 678', '61412345678', '0457 427 157‬', '0426427492.', '(08) 9381 2200 / 0412 345 678']) {
      expect(phoneKind(p)).toBe('mobile')
    }
  })

  it('calls any other full number a landline', () => {
    for (const p of ['0862740500', '(08) 9381 2200', '08 9381 2200', '9381 2200', '1300 123 456']) expect(phoneKind(p)).toBe('landline')
  })

  it('treats empty fields and names typed into the field as no number', () => {
    for (const p of [null, undefined, '', '  ', 'Stuart Barkes & Coralee Loock', 'TBC', '123']) expect(phoneKind(p)).toBe('none')
  })
})

describe('runOrderChecks', () => {
  it('asks the sender for a number only when there is none', () => {
    const [none] = runOrderChecks({ insured_phone: null })
    expect(none).toMatchObject({ key: 'no_phone', acknowledgementLine: expect.stringContaining('best phone number') })
    expect(none.holdAcknowledgement).toBeUndefined()
  })

  it('only tells the office about a landline — the acknowledgement stays standard', () => {
    const results = runOrderChecks({ insured_phone: '08 9381 2200' })
    expect(results).toEqual([{ key: 'landline_only', message: expect.stringContaining("may be the broker's") }])
  })

  it('finds nothing for an order with a mobile', () => {
    expect(runOrderChecks({ insured_phone: '0412 345 678' })).toEqual([])
  })

  it('takes new checks without other changes (e.g. outside the service area)', () => {
    const outside: OrderCheck = {
      key: 'outside_area',
      run: o => o.property_address?.includes('Kalgoorlie') ? { key: 'outside_area', message: 'Outside the service area.', holdAcknowledgement: 'Outside the service area' } : null,
    }
    const results = runOrderChecks({ insured_phone: '0412 345 678', property_address: '1 Hannan St, Kalgoorlie' }, [...ORDER_CHECKS, outside])
    expect(results).toEqual([expect.objectContaining({ key: 'outside_area', holdAcknowledgement: 'Outside the service area' })])
  })
})
