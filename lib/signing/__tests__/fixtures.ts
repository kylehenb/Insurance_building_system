import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { workOrderPdfFixture } from '@/lib/__tests__/work-order-pdf.fixture'

type Tables = Database['public']['Tables']
type Row = Record<string, unknown>

// Synthetic data for the signing module tests — no real customer data.

export function quoteDocumentFixture(options: { items?: number; approvedAmount?: number | null } = {}) {
  const { job, tenant } = workOrderPdfFixture()
  const quoteId = '00000000-0000-4000-8000-0000000000a1'

  const quote = {
    id: quoteId,
    tenant_id: tenant.id,
    job_id: job.id,
    inspection_id: null,
    report_id: null,
    parent_quote_id: null,
    quote_ref: 'Q-IRC1234-01',
    quote_type: 'insurance',
    version: 1,
    is_active_version: true,
    is_locked: true,
    status: 'approved',
    approved_amount: options.approvedAmount === undefined ? 6380 : options.approvedAmount,
    approval_notes: null,
    raw_scope_notes: null,
    total_amount: 6380,
    markup_pct: 0.2,
    gst_pct: 0.1,
    doc_storage_path: null,
    pdf_storage_path: null,
    notes: null,
    created_at: '2026-10-01T00:00:00Z',
    permit_block_dismissed: false,
    room_order: null,
  } as unknown as Tables['quotes']['Row']

  const rooms = ['Kitchen', 'Laundry', 'Bedroom 2', 'Hallway']
  const count = options.items ?? 6
  const scopeItems = Array.from({ length: count }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(0xb00 + i).padStart(12, '0')}`,
    tenant_id: tenant.id,
    quote_id: quoteId,
    room: rooms[i % rooms.length],
    room_length: i % rooms.length === 0 ? 4.2 : null,
    room_width: i % rooms.length === 0 ? 3 : null,
    room_height: i % rooms.length === 0 ? 2.7 : null,
    item_description: `Repair item ${i + 1}: remove and replace water damaged plasterboard, set, sand and prepare for paint`,
    qty: 2 + (i % 5),
    unit: 'm2',
    trade: i % 2 === 0 ? 'Plasterer' : 'Painter',
    line_total: 250 + i * 10,
    sort_order: i,
    approval_status: i === 1 ? 'declined' : 'pending',
  })) as unknown as Tables['scope_items']['Row'][]

  return { job, tenant, quote, scopeItems }
}

/**
 * A tiny in-memory stand-in for the Supabase query builder, covering the
 * calls the document loaders make: select / eq / in / order / maybeSingle.
 */
export function fakeSupabase(tables: Record<string, Row[]>): SupabaseClient<Database> {
  function builder(table: string) {
    let rows = [...(tables[table] ?? [])]
    const api = {
      select: () => api,
      eq: (col: string, value: unknown) => { rows = rows.filter(r => r[col] === value); return api },
      in: (col: string, values: unknown[]) => { rows = rows.filter(r => values.includes(r[col])); return api },
      order: (col: string, opts: { ascending?: boolean } = {}) => {
        const dir = opts.ascending === false ? -1 : 1
        rows.sort((a, b) => (String(a[col] ?? '') < String(b[col] ?? '') ? -dir : String(a[col] ?? '') > String(b[col] ?? '') ? dir : 0))
        return api
      },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      single: async () => (rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'not found' } }),
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: rows, error: null }),
    }
    return api
  }
  return { from: builder } as unknown as SupabaseClient<Database>
}

export function quoteDocumentContext(options: Parameters<typeof quoteDocumentFixture>[0] = {}) {
  const f = quoteDocumentFixture(options)
  const supabase = fakeSupabase({
    jobs: [f.job as unknown as Row],
    tenants: [f.tenant as unknown as Row],
    quotes: [f.quote as unknown as Row],
    scope_items: f.scopeItems as unknown as Row[],
  })
  return { ...f, ctx: { supabase, tenantId: f.tenant.id } }
}
