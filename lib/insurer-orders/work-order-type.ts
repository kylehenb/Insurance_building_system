// The work order type an insurer's order asks for, from the parser's wording
// (lib/email/order-parser.ts; compared when learning, lib/insurer-orders/learning.ts).

export function mapWorkOrderType(raw: string | null | undefined): string | null {
  if (!raw) return null
  const lower = raw.toLowerCase()
  if (lower.includes('make safe')) return 'make_safe'
  if (lower.includes('roof')) return 'roof_report'
  if (lower.includes('specialist')) return 'specialist'
  if (lower.includes('combination')) return 'variation'
  if (lower.includes('bar') || lower.includes('building assessment')) return 'BAR'
  return raw
}
