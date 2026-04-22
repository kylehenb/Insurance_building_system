import type { Database } from '@/lib/supabase/database.types'

// ─── DB Row aliases ────────────────────────────────────────────────────────────
export type WorkOrderRow      = Database['public']['Tables']['work_orders']['Row']
export type WorkOrderVisitRow = Database['public']['Tables']['work_order_visits']['Row']
export type QuoteRow          = Database['public']['Tables']['quotes']['Row']
export type ScopeItemRow      = Database['public']['Tables']['scope_items']['Row']
export type InvoiceRow        = Database['public']['Tables']['invoices']['Row']
export type TradeRow          = Database['public']['Tables']['trades']['Row']

// ─── Domain enums ─────────────────────────────────────────────────────────────
export type WorkOrderStatus  = 'pending' | 'engaged' | 'works_complete' | 'invoice_received'
export type GaryState        = 'not_started' | 'waiting_on_dependent' | 'waiting_reply' | 'booking_proposed' | 'confirmed' | 'return_visit_pending' | 'complete'
export type ProximityRange   = 'standard' | 'extended'
export type VisitStatus      = 'unscheduled' | 'gary_sent' | 'proposed' | 'confirmed' | 'complete'
export type PlacementState   = 'unplaced' | 'placed_unsent' | 'placed_sent' | 'placed_complete'

// ─── Composed type ─────────────────────────────────────────────────────────────
export interface WorkOrderWithDetails extends WorkOrderRow {
  visits:          WorkOrderVisitRow[]
  scopeItems:      ScopeItemRow[]
  trade:           TradeRow | null
  invoice:         InvoiceRow | null
  placementState:  PlacementState
  cushionDays:     number
  tradeTypeLabel:  string   // "Electrician" | "Plumber" | "Make Safe" | …
  quotedAllowance: number   // sum of scopeItems.line_total
  lagDays:         number   // first visit lag_days_after
  lagDescription:  string   // first visit lag_description
  dependency_type?: string | null  // 'finish-to-start' | 'start-to-start' | 'finish-to-finish' | 'start-to-finish'
  parentWorkOrder: WorkOrderWithDetails | null  // parent/child relationship for key trades
  children:        WorkOrderWithDetails[]       // child trades that depend on this one
}

// ─── Computed helpers ──────────────────────────────────────────────────────────
export function getPlacementState(wo: WorkOrderRow, invoices: InvoiceRow[]): PlacementState {
  if (wo.sequence_order === null || wo.sequence_order === undefined) return 'unplaced'
  const inv = invoices.find(i => i.work_order_id === wo.id)
  if (inv?.external_status === 'invoiced') return 'placed_complete'
  if (wo.gary_state && wo.gary_state !== 'not_started') return 'placed_sent'
  return 'placed_unsent'
}

export function woIsSent(wo: WorkOrderRow): boolean {
  return !!wo.gary_state && wo.gary_state !== 'not_started'
}

export function woIsPlaced(wo: WorkOrderRow): boolean {
  return wo.sequence_order !== null && wo.sequence_order !== undefined
}

export function getCushionDays(notes: string | null): number {
  if (!notes) return 1
  try {
    const parsed = JSON.parse(notes) as Record<string, unknown>
    return typeof parsed.cushion_days === 'number' ? parsed.cushion_days : 1
  } catch {
    return 1
  }
}

export function mergeCushionDays(notes: string | null, days: number): string {
  let parsed: Record<string, unknown> = {}
  if (notes) {
    try { parsed = JSON.parse(notes) as Record<string, unknown> } catch { /* ignore */ }
  }
  return JSON.stringify({ ...parsed, cushion_days: days })
}

// ─── Gary state display labels ────────────────────────────────────────────────
export const GARY_STATE_LABELS: Record<string, string> = {
  not_started:          'Not started',
  waiting_on_dependent: 'Waiting on prior trade',
  waiting_reply:        'Awaiting reply',
  booking_proposed:     'Proposed',
  confirmed:            'Confirmed',
  return_visit_pending: 'Return visit pending',
  complete:             'Complete',
}

export function garyLabel(state: string | null): string {
  if (!state) return 'Not started'
  return GARY_STATE_LABELS[state] ?? state
}

// ─── Trade colour palette ─────────────────────────────────────────────────────
export const TRADE_COLORS: Record<string, string> = {
  Electrician:   '#EF9F27',
  Plumber:       '#378ADD',
  Carpenter:     '#D85A30',
  Plasterer:     '#7F77DD',
  Painter:       '#1D9E75',
  Roofer:        '#64748b',
  'Make Safe':   '#E24B4A',
  make_safe:     '#E24B4A',
  repair:        '#9ca3af',
  investigation: '#7F77DD',
}

export function getTradeColor(label: string): string {
  return TRADE_COLORS[label] ?? '#9ca3af'
}

// ─── Currency formatter ────────────────────────────────────────────────────────
export const aud = new Intl.NumberFormat('en-AU', {
  style:                 'currency',
  currency:              'AUD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

// ─── Invoice chain steps ───────────────────────────────────────────────────────
export const INVOICE_CHAIN_STEPS = [
  { key: 'sent_awaiting_invoice', label: 'Sent' },
  { key: 'trade_invoice_received', label: 'Inv. received' },
  { key: 'trade_invoice_approved', label: 'Inv. approved' },
  { key: 'irc_invoice_created',    label: 'IRC invoice' },
  { key: 'invoiced',               label: 'Invoiced' },
] as const
