// The "Add a report" dropdown in the field app. Reports with both keys ask Internal or External when picked.
// internal = the panel filled in on the phone; external = a trade asked to report (keys match the saved draft).
// tradeTypes = the trades' primary_trade values offered for the external report; makeSafe = trades marked
// "can do make safe" instead.
export interface ReportOption {
  id: string
  name: string
  internal?: string
  external?: string
  extSub?: string
  tradeTypes?: string[]
  makeSafe?: boolean
}

export const REPORT_OPTIONS: ReportOption[] = [
  { id: 'make-safe', name: 'Make Safe', internal: 'make-safe', external: 'make-safe-ext', extSub: 'Make safe trade', makeSafe: true },
  { id: 'roof', name: 'Roof Report', internal: 'roof-report', external: 'roof-plumber', extSub: 'Roof plumber', tradeTypes: ['Roof Plumber'] },
  { id: 'leak', name: 'Leak Detection', internal: 'leak-detection', external: 'leak-plumber', extSub: 'Plumber', tradeTypes: ['Plumber'] },
  { id: 'restoration', name: 'Restoration Assessment', internal: 'restoration', external: 'restoration-ext', extSub: 'Restorer', tradeTypes: ['Restorer'] },
  { id: 'electrical', name: 'Electrical', external: 'electrical', extSub: 'Electrician · test + report', tradeTypes: ['Electrician'] },
  { id: 'aircon', name: 'Air Conditioning', external: 'aircon', extSub: 'Air conditioning · report', tradeTypes: ['Air Conditioning'] },
  { id: 'fencing', name: 'Fencing / Gates', external: 'fencing', extSub: 'Fencer · report', tradeTypes: ['Fencer'] },
  { id: 'asbestos', name: 'Asbestos Test', external: 'asbestos', extSub: 'Asbestos assessor · clearance report', tradeTypes: ['Asbestos Assessment / Certifier'] },
  { id: 'structural', name: 'Structural Engineer', external: 'structural', extSub: 'Engineer · report', tradeTypes: ['Engineer'] },
]

/** A trade the inspector can pick for an external report */
export interface FieldTrade { id: string; name: string; trade: string | null; makeSafe: boolean }

/** Trades for one report option, best first: make safe priority for Make Safe, otherwise star rating then name */
export function tradesForReport(opt: ReportOption, trades: (FieldTrade & { makesafePriority: number | null; priorityRank: number | null })[]): FieldTrade[] {
  const types = new Set((opt.tradeTypes ?? []).map(t => t.toLowerCase()))
  return trades
    .filter(t => opt.makeSafe ? t.makeSafe : !!t.trade && types.has(t.trade.toLowerCase()))
    .sort((a, b) => opt.makeSafe
      ? (a.makesafePriority ?? 999) - (b.makesafePriority ?? 999) || a.name.localeCompare(b.name)
      : (b.priorityRank ?? 0) - (a.priorityRank ?? 0) || a.name.localeCompare(b.name))
    .map(({ id, name, trade, makeSafe }) => ({ id, name, trade, makeSafe }))
}
