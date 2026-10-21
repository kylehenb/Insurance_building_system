import { describe, expect, it } from 'vitest'
import { generateBuildingContractHtml, BUILDING_CONTRACT_MARKERS } from '@/lib/documents/building-contract-html'
import { generateSowHtml, SOW_AGREEMENT, SOW_MARKERS } from '@/lib/documents/sow-html'
import { fieldMarkerHref } from '@/lib/pdf/field-markers'
import { loadQuoteDocumentData, quotesTotalInclGst } from '@/lib/documents/quote-document-data'
import { CONTRACT_TEXT } from '../documents/building-contract'
import { SIGNING_DOCUMENT_TYPES } from '../documents/registry'
import { SIGNING_DOCUMENT_CATALOG } from '../documents/catalog'
import { quoteDocumentContext, quoteDocumentFixture } from './fixtures'

const decode = (html: string) => html.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ')

describe('document templates', () => {
  const f = quoteDocumentFixture()

  it('print output is unchanged unless signing markers are asked for', () => {
    const contract = generateBuildingContractHtml({ quotes: [f.quote], job: f.job, scopeItems: f.scopeItems })
    expect(contract).not.toContain('irc-sign.invalid')
    expect(contract).toContain('src="/logo-alt.png"')
    expect(contract).toContain('scan and return via email')
    const sow = generateSowHtml({ quotes: [f.quote], job: f.job, scopeItems: f.scopeItems, tenant: f.tenant })
    expect(sow).not.toContain('irc-sign.invalid')
  })

  it('adds every configured marker when rendering for signing', () => {
    const contract = generateBuildingContractHtml({ quotes: [f.quote], job: f.job, scopeItems: f.scopeItems, render: { signingMarkers: true } })
    for (const m of Object.values(BUILDING_CONTRACT_MARKERS)) expect(contract).toContain(fieldMarkerHref(m))
    expect(contract).toContain('electronically using the secure link')
    const sow = generateSowHtml({ quotes: [f.quote], job: f.job, scopeItems: f.scopeItems, tenant: f.tenant, render: { signingMarkers: true } })
    for (const m of Object.values(SOW_MARKERS)) expect(sow).toContain(fieldMarkerHref(m))
  })

  it('every marker a document type needs exists in its template', () => {
    const contract = generateBuildingContractHtml({ quotes: [f.quote], job: f.job, scopeItems: f.scopeItems, render: { signingMarkers: true } })
    const sow = generateSowHtml({ quotes: [f.quote], job: f.job, scopeItems: f.scopeItems, tenant: f.tenant, render: { signingMarkers: true } })
    const html = { building_contract: contract, scope_of_works: sow }
    for (const type of Object.values(SIGNING_DOCUMENT_TYPES)) {
      for (const field of type.fields) {
        for (const placement of [field.signature, field.date, field.name]) {
          if (placement && 'anchor' in placement) expect(html[type.key]).toContain(fieldMarkerHref(placement.anchor))
        }
      }
    }
  })

  // The phone reading view must say what the PDF says.
  it('contract wording in the reading view matches the contract', () => {
    const contract = decode(generateBuildingContractHtml({ quotes: [f.quote], job: f.job, scopeItems: f.scopeItems }))
    const texts = Object.values(CONTRACT_TEXT).flat()
    for (const text of texts) expect(contract).toContain(text)
  })

  it('SOW agreement wording matches the SOW', () => {
    const sow = decode(generateSowHtml({ quotes: [f.quote], job: f.job, scopeItems: f.scopeItems, tenant: f.tenant }))
    expect(sow).toContain(SOW_AGREEMENT)
  })
})

describe('quote document data', () => {
  it('leaves out items the insurer declined', async () => {
    const { ctx, job, quote } = quoteDocumentContext({ items: 6 })
    const data = await loadQuoteDocumentData(job.id, [quote.id], ctx)
    expect(data.scopeItems).toHaveLength(5)
    expect(data.scopeItems.some(i => i.approval_status === 'declined')).toBe(false)
  })

  it('works out the total like the contract (approved amount wins)', () => {
    const f = quoteDocumentFixture({ approvedAmount: null })
    const lines = f.scopeItems.reduce((s, i) => s + (i.line_total ?? 0), 0)
    expect(quotesTotalInclGst([f.quote], f.scopeItems)).toBeCloseTo(lines * 1.2 * 1.1, 6)
    const g = quoteDocumentFixture({ approvedAmount: 9000 })
    expect(quotesTotalInclGst([g.quote], g.scopeItems)).toBe(9000)
  })

  it('refuses quotes from another job or not approved', async () => {
    const { ctx, job, quote } = quoteDocumentContext()
    await expect(loadQuoteDocumentData(job.id, ['00000000-0000-4000-8000-00000000ffff'], ctx)).rejects.toThrow(/not found/)
    await expect(loadQuoteDocumentData('00000000-0000-4000-8000-00000000eeee', [quote.id], ctx)).rejects.toThrow(/Job not found/)
  })
})

describe('catalog and registry agree', () => {
  it('has the same document types', () => {
    expect(Object.keys(SIGNING_DOCUMENT_CATALOG).sort()).toEqual(Object.keys(SIGNING_DOCUMENT_TYPES).sort())
    for (const t of Object.values(SIGNING_DOCUMENT_TYPES)) {
      expect(t.label).toBe(SIGNING_DOCUMENT_CATALOG[t.key].label)
      expect(t.fields.length).toBeGreaterThan(0)
    }
    expect(SIGNING_DOCUMENT_TYPES.building_contract.fields).toHaveLength(2)
  })
})
