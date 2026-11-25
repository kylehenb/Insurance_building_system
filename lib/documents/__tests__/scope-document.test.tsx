import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import * as fx from '@/lib/__tests__/print-documents.fixture'
import { ScopeDocument } from '@/components/documents/ScopeDocument'
import { scopePdfFilename, scopeQuoteIds, scopeTitle } from '@/lib/documents/print-document-pdfs'

// The uncosted scope of works: the quotes' items with no prices, one or
// several quotes in one document.

const Q2 = '00000000-0000-4000-8000-0000000000a2'
const quote2 = fx.printQuote({ id: Q2, quote_ref: 'Q-IRC1234-2', notes: 'Second visit: laundry.', room_order: ['Laundry', 'Kitchen'] })
const items2 = [
  { ...fx.printScopeItems()[1], id: 'q2-a', quote_id: Q2, room: 'Kitchen', item_description: 'Replace kitchen kickboards', sort_order: 1 },
  { ...fx.printScopeItems()[1], id: 'q2-b', quote_id: Q2, room: 'Laundry', item_description: 'Replace laundry trough', sort_order: 2 },
]
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ')

describe('ScopeDocument', () => {
  it('shows the items with quantities and trades, and no prices', () => {
    const html = renderToStaticMarkup(<ScopeDocument quotes={[fx.printQuote()]} scopeItems={fx.printScopeItems()} job={fx.printJob()} tenant={fx.printTenant()} />)
    const t = text(html)
    expect(t).toContain('SCOPE OF WORKS')
    expect(t).toContain('Quote Number: Q-IRC1234-1')
    expect(t).toContain('Patch and set ceiling where water damaged')
    expect(t).toContain('Plasterer')
    expect(t).toContain('Provisional Sum')
    expect(t).not.toMatch(/\$|Total|Rate|GST/)
    // One quote: no quote column
    expect(t).not.toMatch(/ Quote (?!Number|to|Date)/)
  })

  it("combines several quotes: both refs, a quote column, each quote's items together within a room", () => {
    const html = renderToStaticMarkup(
      <ScopeDocument quotes={[fx.printQuote(), quote2]} scopeItems={[...items2, ...fx.printScopeItems()]} job={fx.printJob()} tenant={fx.printTenant()} />,
    )
    const t = text(html)
    expect(t).toContain('Quote Numbers: Q-IRC1234-1, Q-IRC1234-2')
    // Rooms: the first quote's order, then the second's new rooms
    expect(t.indexOf('Kitchen')).toBeLessThan(t.indexOf('Bathroom'))
    expect(t.indexOf('Bathroom')).toBeLessThan(t.indexOf('Laundry'))
    // In the kitchen the first quote's items come before the second's
    expect(t.indexOf('Supply and install downlight')).toBeLessThan(t.indexOf('Replace kitchen kickboards'))
    expect(t).toMatch(/Replace kitchen kickboards .*Q-IRC1234-2/)
    // Each quote's notes, labelled
    expect(t).toContain('Notes — Q-IRC1234-1')
    expect(t).toContain('Notes — Q-IRC1234-2 Second visit: laundry.')
    expect(t).not.toContain('$')
  })
})

describe('scope of works names', () => {
  it('names the file and title after the quotes', () => {
    const job = fx.printJob()
    expect(scopePdfFilename({ quotes: [fx.printQuote()], job })).toBe('Scope of Works - Q-IRC1234-1 - 1 Example Street, Sampleton WA 6000.pdf')
    expect(scopePdfFilename({ quotes: [fx.printQuote(), quote2], job })).toBe('Scope of Works - Q-IRC1234-1, Q-IRC1234-2 - 1 Example Street, Sampleton WA 6000.pdf')
    expect(scopeTitle([fx.printQuote(), quote2])).toBe('Scope of Works Q-IRC1234-1 + Q-IRC1234-2')
  })

  it('puts the first quote first, once', () => {
    expect(scopeQuoteIds({ id: 'a', quoteIds: ['b', 'a', 'c'] })).toEqual(['a', 'b', 'c'])
    expect(scopeQuoteIds({ id: 'a' })).toEqual(['a'])
  })
})
