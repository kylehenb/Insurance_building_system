// How an invoice is totalled from its lines. Client-safe: the invoice editor
// (InvoiceEditor) and server-side edits (lib/invoices/edit.ts) both use it.

const round2 = (n: number) => Math.round(n * 100) / 100
const GST_RATE = 0.1

/**
 * An invoice's totals from its lines: the ticked (completed) lines, plus the
 * builder's margin when it has one, plus GST; a quoted-amounts invoice then
 * takes off its deductions (e.g. the excess already paid) after GST. Excess
 * invoices and GST-inclusive ones keep the amount they were raised with —
 * null means "don't recalculate".
 */
export function invoiceTotals(
  invoice: { invoice_type: string; markup_pct: number | null; gst_treatment?: string | null },
  lines: { line_total: number | null; completed?: boolean | null }[],
  deductions: { amount_inc_gst: number | null }[],
): { amount_ex_gst: number; gst: number; amount_inc_gst: number } | null {
  if (invoice.invoice_type === 'excess' || invoice.gst_treatment === 'inclusive') return null
  const sub = round2(lines.filter(l => l.completed !== false).reduce((s, l) => s + (l.line_total ?? 0), 0))
  const markupPct = invoice.markup_pct ?? 0
  const markup = markupPct > 0 ? round2(sub * markupPct) : 0
  const ex = round2(sub + markup)
  const gst = round2(ex * GST_RATE)
  const grossInc = round2(ex + gst)
  const deductionsTotal = round2(deductions.reduce((s, d) => s + (d.amount_inc_gst ?? 0), 0))
  return {
    amount_ex_gst: ex,
    gst,
    amount_inc_gst: invoice.invoice_type === 'quoted_amounts' ? round2(grossInc - deductionsTotal) : grossInc,
  }
}
