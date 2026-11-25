import type { CSSProperties, ReactNode } from 'react'
import type { Database } from '@/lib/supabase/database.types'
import { groupScopeItemsAcrossQuotes, combinedQuoteRefLabel } from '@/lib/documents/scope-grouping'

type Quote = Database['public']['Tables']['quotes']['Row']
type ScopeItem = Database['public']['Tables']['scope_items']['Row']
type Job = Database['public']['Tables']['jobs']['Row']
type Tenant = Database['public']['Tables']['tenants']['Row']

type ItemType = 'provisional_sum' | 'prime_cost' | 'cash_settlement'

const ITEM_TYPE_LABELS: Record<ItemType, { label: string; color: string; border: string }> = {
  provisional_sum: { label: 'Provisional Sum', color: '#b45309', border: '#f59e0b' },
  prime_cost:      { label: 'Prime Cost',      color: '#1a73e8', border: '#60a5fa' },
  cash_settlement: { label: 'Cash Settlement', color: '#64748b', border: '#94a3b8' },
}

// The uncosted Scope of Works: one or more quotes' items by room, with no
// rates, totals or sign-off — what the insurer or homeowner gets when they
// ask "what work is being done" without the prices. (The Scope of Works
// Authorisation the homeowner signs is lib/documents/sow-html.ts.)
// Rendered by the browser print page (/print/quotes/[quoteId]/sow-preview)
// and, as static HTML, by the emailed PDF (lib/documents/send) — one layout
// for both. Apart from the page wrapper (the quote document's classes), the
// styles are inline.

export interface ScopeDocumentProps {
  /** In the order they should appear; the first one's rooms lead */
  quotes: Quote[]
  scopeItems: ScopeItem[]
  job: Job
  tenant: Tenant
  /** Print page controls (hidden when printing). Omitted in the PDF. */
  toolbar?: ReactNode
}

const formatDate = (date: string | null) => {
  if (!date) return ''
  return new Date(date).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Australia/Perth' })
}

const th = (width: string, align: 'left' | 'center' = 'left'): CSSProperties => ({
  width, textAlign: align, padding: '8px', fontWeight: 600, color: '#b0a89e', fontSize: '8px',
  textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'var(--font-dm-sans)',
})
const td = (width: string, align: 'left' | 'center' = 'left'): CSSProperties => ({
  width, textAlign: align, padding: '6px 8px', color: '#3a3530', fontSize: '10px', fontFamily: 'var(--font-dm-sans)', verticalAlign: 'top',
})

export function ScopeDocument({ quotes, scopeItems, job, tenant, toolbar }: ScopeDocumentProps) {
  const isMultiQuote = quotes.length > 1
  const { groupedByRoom, sortedRooms, quoteRefById } = groupScopeItemsAcrossQuotes(quotes, scopeItems)
  const companyName = tenant.trading_name || tenant.name || 'Insurance Repair Co'
  const quoteRefs = combinedQuoteRefLabel(quotes) || 'Draft'
  const dates = [...new Set(quotes.map(q => formatDate(q.created_at)).filter(Boolean))].join(', ')
  const notes = quotes.filter(q => q.notes?.trim())
  // Description takes what the quote column doesn't
  const widths = isMultiQuote
    ? { n: '4%', desc: '60%', qty: '6%', unit: '6%', trade: '14%', quote: '10%' }
    : { n: '4%', desc: '70%', qty: '6%', unit: '6%', trade: '14%', quote: '0%' }
  let counter = 0

  return (
    <div className="min-h-screen bg-[#f5f2ee] print:bg-white">
      <div className="max-w-4xl mx-auto bg-white shadow-lg min-h-screen print:shadow-none print:min-h-0 print:p-0">
        {toolbar}

        {/* Header: logo | quote & job details | company contact */}
        <div style={{ display: 'flex', alignItems: 'stretch', backgroundColor: 'white' }}>
          <div style={{ width: '148px', minWidth: '148px', padding: '14px 8px 14px 20px', borderRight: '1px solid #e0dbd4' }}>
            <img src="/logo-alt.png" alt="IRC Logo" style={{ width: '100%', height: 'auto', display: 'block', marginBottom: '5px' }} />
            <div style={{ fontSize: '6.5px', letterSpacing: '1.8px', textTransform: 'uppercase', color: '#9e998f', fontWeight: 700, whiteSpace: 'nowrap' }}>INSURANCE REPAIR CO</div>
          </div>

          <div style={{ flex: 1, padding: '14px 10px', borderRight: '1px solid #e0dbd4' }}>
            <div style={{ fontSize: '11.5px', letterSpacing: '1.5px', textTransform: 'uppercase', color: '#b0a89e', fontWeight: 700, marginBottom: '7px' }}>QUOTE DETAILS</div>
            <div style={{ display: 'flex', gap: '24px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: '#9e998f' }}>{isMultiQuote ? 'Quote Numbers:' : 'Quote Number:'} </span>
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#1a1a1a' }}>{quoteRefs}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: '#9e998f' }}>Quote to: </span>
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#1a1a1a' }}>{job.insurer || '—'}</span>
              </div>
            </div>
            {dates && (
              <div style={{ fontSize: '12px', marginTop: '6px' }}>
                <span style={{ color: '#b0a89e' }}>{isMultiQuote ? 'Quote Dates' : 'Quote Date'}: </span>
                <span style={{ color: '#3a3530' }}>{dates}</span>
              </div>
            )}
            <div style={{ fontSize: '11.5px', letterSpacing: '1.5px', textTransform: 'uppercase', color: '#b0a89e', fontWeight: 700, marginTop: '12px', marginBottom: '7px' }}>JOB DETAILS</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', fontSize: '12px' }}>
              {[
                { label: 'Insurer', value: job.insurer },
                { label: 'Property Address', value: job.property_address },
                { label: 'Insured', value: job.insured_name },
                { label: 'Claim #', value: job.claim_number },
                { label: 'Job #', value: job.job_number },
              ].filter(f => f.value).map((field, i, arr) => (
                <span key={field.label} style={{ paddingRight: '8px', marginRight: '8px', borderRight: i < arr.length - 1 ? '1px solid #e0dbd4' : 'none' }}>
                  <span style={{ color: '#b0a89e' }}>{field.label}: </span>
                  <span style={{ color: '#3a3530' }}>{field.value}</span>
                </span>
              ))}
            </div>
          </div>

          <div style={{ width: '184px', minWidth: '184px', padding: '14px 26px 14px 10px' }}>
            <div style={{ fontSize: '9.5px', letterSpacing: '1.3px', textTransform: 'uppercase', color: '#b0a89e', fontWeight: 700, marginBottom: '7px' }}>{companyName}</div>
            <div style={{ fontSize: '10px', color: '#3a3530', marginBottom: '3px' }}>{tenant.address || '—'}</div>
            <div style={{ fontSize: '10px', color: '#3a3530', marginBottom: '3px' }}>{tenant.contact_email || '—'}</div>
            <div style={{ fontSize: '10px', color: '#3a3530' }}>{tenant.contact_phone || '—'}</div>
          </div>
        </div>

        {/* Form band */}
        <div style={{ borderTop: '1px solid #e0dbd4', borderBottom: '1px solid #e0dbd4', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '14px' }}>
          <span style={{ fontSize: '28px', fontWeight: 700, color: '#9e998f', textTransform: 'uppercase', letterSpacing: '2px', whiteSpace: 'nowrap' }}>SCOPE OF WORKS</span>
        </div>

        {/* Items by room — no rates or totals */}
        <div style={{ padding: '0 20px 8px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr style={{ background: '#fafaf8', borderBottom: '1px solid #e8e4e0' }}>
                <th style={th(widths.n, 'center')}>#</th>
                <th style={th(widths.desc)}>Description</th>
                <th style={th(widths.qty, 'center')}>Qty</th>
                <th style={th(widths.unit, 'center')}>Unit</th>
                <th style={th(widths.trade)}>Trade</th>
                {isMultiQuote && <th style={th(widths.quote)}>Quote</th>}
              </tr>
            </thead>
          </table>
          {sortedRooms.length === 0 && (
            <div style={{ padding: '16px 12px', fontSize: '11px', color: '#9e998f' }}>No items.</div>
          )}
          {sortedRooms.map(room => {
            const roomItems = groupedByRoom[room]
            const dims = roomItems.find(i => i.room_length != null || i.room_width != null || i.room_height != null)
            const size = dims ? `${dims.room_length ?? '—'} × ${dims.room_width ?? '—'} × ${dims.room_height ?? '—'} m` : ''
            return (
              <div key={room} style={{ marginBottom: '16px', breakInside: 'avoid-page' }}>
                <div style={{ padding: '4px 12px', borderBottom: '1px solid #e0dbd4', backgroundColor: '#f5f2ee' }}>
                  <span style={{ fontWeight: 700, color: '#3a3530', fontSize: '12px', textTransform: 'uppercase', fontFamily: 'var(--font-dm-sans)' }}>{room}</span>
                  {size && <span style={{ fontSize: '12px', color: '#9e998f', marginLeft: '8px', fontFamily: 'var(--font-dm-mono)' }}>{size}</span>}
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                  <tbody>
                    {roomItems.map(item => {
                      counter++
                      const type = ITEM_TYPE_LABELS[item.item_type as ItemType] as typeof ITEM_TYPE_LABELS[ItemType] | undefined
                      const edge = `3px solid ${type?.border ?? 'transparent'}`
                      return (
                        <tr key={item.id} style={{ borderBottom: '1px solid #f0ece6', borderLeft: edge, borderRight: edge }}>
                          <td style={{ ...td(widths.n, 'center'), fontFamily: 'var(--font-dm-mono)' }}>{counter}</td>
                          <td style={{ ...td(widths.desc), lineHeight: 1.5 }}>
                            {type && (
                              <div style={{ marginBottom: '2px' }}>
                                <span style={{ display: 'inline-block', padding: '2px 4px', borderRadius: '4px', fontSize: '8px', fontWeight: 700, background: `${type.border}22`, color: type.color }}>{type.label}</span>
                              </div>
                            )}
                            {item.item_description || '-'}
                          </td>
                          <td style={td(widths.qty, 'center')}>{item.qty ?? '-'}</td>
                          <td style={td(widths.unit, 'center')}>{item.unit || '-'}</td>
                          <td style={td(widths.trade)}>{item.trade || '-'}</td>
                          {isMultiQuote && <td style={{ ...td(widths.quote), color: '#9e998f', fontFamily: 'var(--font-dm-mono)' }}>{quoteRefById.get(item.quote_id) || '-'}</td>}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          })}
        </div>

        {/* Notes (no totals) */}
        <div style={{ padding: '0 20px 80px' }}>
          {notes.map(q => (
            <div key={q.id} style={{ background: '#f5f2ee', borderRadius: '8px', padding: '12px', marginBottom: '8px' }}>
              <p style={{ color: '#b0a89e', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, margin: '0 0 8px', fontFamily: 'var(--font-dm-sans)' }}>
                {isMultiQuote ? `Notes — ${q.quote_ref || 'Draft'}` : 'Notes'}
              </p>
              <div style={{ fontSize: '10px', color: '#3a3530', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-dm-sans)' }}>{q.notes}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div style={{ background: '#1a1a1a', padding: '9px 16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        {tenant.logo_storage_path ? (
          <img src={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/tenant-assets/${tenant.logo_storage_path}`} alt="Tenant Logo" style={{ width: '26px', height: '26px', objectFit: 'contain', flexShrink: 0 }} />
        ) : (
          <div style={{ width: '26px', height: '26px', border: '1.5px solid #c8b89a', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '9px', fontWeight: 800, color: '#c8b89a', fontStyle: 'italic' }}>IRC.</div>
        )}
        <div>
          <div style={{ fontSize: '7.5px', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#f5f2ee' }}>{tenant.trading_name || tenant.name || 'INSURANCE REPAIR CO PTY LTD'}</div>
          <div style={{ fontSize: '10px', color: '#c8b89a' }}>Building &amp; Restoration</div>
        </div>
        <div style={{ width: '1px', height: '22px', background: '#c8b89a', margin: '0 4px', flexShrink: 0 }} />
        <span style={{ fontSize: '12px', color: '#c8b89a' }}>{(tenant.trading_name || tenant.name || 'INSURANCE REPAIR CO PTY LTD').toUpperCase()} • ABN {tenant.abn || '—'} • BUILDERS LIC. {(tenant as Tenant & { building_licence_number?: string | null }).building_licence_number || '—'}</span>
      </div>
    </div>
  )
}
