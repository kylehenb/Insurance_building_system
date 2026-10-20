import { describe, it, expect } from 'vitest'
import { generateWorkOrderPdfHtml, getWorkOrderTextNotes } from '../documents/work-order-pdf-html'
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

  it('has no schedule or visits section', () => {
    const html = generateWorkOrderPdfHtml(workOrderPdfFixture())
    expect(html).not.toMatch(/Scheduled|To be scheduled|VISITS/)
  })

  it('uses the tenant logo in the footer and the IRC. badge without one', () => {
    const withLogo = generateWorkOrderPdfHtml(workOrderPdfFixture({ footerLogoDataUri: 'data:image/png;base64,AAAA' }))
    expect(withLogo).toContain('alt="Tenant Logo"')
    const without = generateWorkOrderPdfHtml(workOrderPdfFixture({ footerLogoDataUri: null }))
    expect(without).not.toContain('alt="Tenant Logo"')
    expect(without).toContain('>IRC.</div>')
  })
})

describe('helpers', () => {
  it('getWorkOrderTextNotes never leaks the JSON overlay', () => {
    expect(getWorkOrderTextNotes('{"item_overrides":{"a":{"line_total":500}}}')).toBe('')
    expect(getWorkOrderTextNotes('{"text_notes":" Bring ladder "}')).toBe('Bring ladder')
    expect(getWorkOrderTextNotes('Plain legacy note')).toBe('Plain legacy note')
  })
})
