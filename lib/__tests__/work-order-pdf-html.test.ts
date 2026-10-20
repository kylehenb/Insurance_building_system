import { describe, it, expect } from 'vitest'
import { generateWorkOrderPdfHtml, getWorkOrderTextNotes, resolveScheduledDate } from '../documents/work-order-pdf-html'
import { workOrderPdfFixture } from './work-order-pdf.fixture'

describe('generateWorkOrderPdfHtml', () => {
  it('shows only the work order amount — never charge_out_amount or trade_cost', () => {
    const html = generateWorkOrderPdfHtml(workOrderPdfFixture())
    expect(html).toContain('$1,840.50')
    expect(html).not.toContain('9,999.99')
    expect(html).not.toContain('1,111.11')
    const text = html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]*>/g, ' ')
    expect(text).not.toMatch(/margin|markup|charge.?out/i)
  })

  it('hides the amount block when there is no amount', () => {
    const html = generateWorkOrderPdfHtml(workOrderPdfFixture({ workOrderAmount: null }))
    expect(html).not.toContain('ALLOCATED AMOUNT')
  })

  it('never prints a dollar figure for other trades', () => {
    const html = generateWorkOrderPdfHtml(workOrderPdfFixture())
    const otherTrades = html.slice(html.indexOf('OTHER TRADES ON THIS JOB'))
    expect(otherTrades).toContain('Bright Painting')
    expect(otherTrades).not.toContain('$')
  })

  it('adds a DRAFT watermark only when the work order has not been sent', () => {
    expect(generateWorkOrderPdfHtml(workOrderPdfFixture({ isSent: false }))).toContain('class="watermark"')
    expect(generateWorkOrderPdfHtml(workOrderPdfFixture({ isSent: true }))).not.toContain('class="watermark"')
  })

  it('escapes user-entered text', () => {
    const html = generateWorkOrderPdfHtml(workOrderPdfFixture())
    expect(html).toContain('Dog on site &lt;keep gate shut&gt;')
    expect(html).toContain('Patch wall &lt;behind&gt; fridge')
    expect(html).not.toContain('<keep gate shut>')
  })

  it('includes the letterhead, refs and the non-homeowner site contact warning', () => {
    const html = generateWorkOrderPdfHtml(workOrderPdfFixture())
    expect(html).toContain('INSURANCE REPAIR CO PTY LTD')
    expect(html).toContain('ABN 12 686 067 881')
    expect(html).toContain('BUILDERS LIC. BC105884')
    expect(html).toContain('Duncraig, WA')
    expect(html).toContain('0431 132 077')
    expect(html).toContain('WO-IRC1234-002')
    expect(html).toContain('IRC1234')
    expect(html).toContain('Not the homeowner — Tenant')
    expect(html).toContain('Smooth Walls Plastering')
  })

  it('says "To be scheduled" when no visit has a date', () => {
    const fixture = workOrderPdfFixture()
    const html = generateWorkOrderPdfHtml({ ...fixture, visits: fixture.visits.map(v => ({ ...v, scheduled_date: null })) })
    expect(html).toContain('To be scheduled')
  })
})

describe('helpers', () => {
  it('resolveScheduledDate picks the earliest visit date', () => {
    const fixture = workOrderPdfFixture()
    expect(resolveScheduledDate(fixture.workOrder, fixture.visits)).toBe('2026-11-03')
  })

  it('getWorkOrderTextNotes never leaks the JSON overlay', () => {
    expect(getWorkOrderTextNotes('{"item_overrides":{"a":{"line_total":500}}}')).toBe('')
    expect(getWorkOrderTextNotes('{"text_notes":" Bring ladder "}')).toBe('Bring ladder')
    expect(getWorkOrderTextNotes('Plain legacy note')).toBe('Plain legacy note')
  })
})
