import type { Database } from '@/lib/supabase/database.types'

type Invoice = Database['public']['Tables']['invoices']['Row']
type InvoiceLineItem = Database['public']['Tables']['invoice_line_items']['Row']
type InvoiceDeduction = Database['public']['Tables']['invoice_deductions']['Row']
type Job = Database['public']['Tables']['jobs']['Row']
type Tenant = Database['public']['Tables']['tenants']['Row']

export function generateInvoiceHtml(params: {
  invoice: Invoice
  job: Job
  tenant: Tenant & {
    bank_name?: string | null
    bsb?: string | null
    account_number?: string | null
    account_name?: string | null
    building_licence_number?: string | null
    accounts_email?: string | null
    invoice_payment_terms?: number | null
    excess_payment_terms?: number | null
  }
  lineItems: InvoiceLineItem[]
  deductions?: InvoiceDeduction[]
  approvedQuoteRefs?: string[]
}): string {
  const { invoice, job, tenant, lineItems, deductions = [], approvedQuoteRefs } = params

  const formatDate = (date: string | null) => {
    if (!date) return ''
    return new Date(date).toLocaleDateString('en-AU', {
      day: '2-digit', month: 'short', year: 'numeric',
    })
  }

  const fmt = (v: number | null | undefined) => {
    if (v == null) return '$0.00'
    return new Intl.NumberFormat('en-AU', {
      style: 'currency', currency: 'AUD',
    }).format(v)
  }

  const issueDateDisplay = formatDate(invoice.issued_date || invoice.created_at)
  const baseDate = invoice.issued_date || invoice.created_at || ''
  // Use tenant-configured payment terms, defaulting to 14 for standard invoices and 0 for excess
  const isExcess = invoice.invoice_type === 'excess' || (invoice.invoice_type === 'repair' && invoice.gst_treatment === 'inclusive')
  const paymentDays = isExcess
    ? (tenant.excess_payment_terms ?? 0)
    : (tenant.invoice_payment_terms ?? 14)
  const dueDateDisplay = formatDate(new Date(new Date(baseDate).getTime() + paymentDays * 24 * 60 * 60 * 1000).toISOString())

  const markupPct = (invoice as any).markup_pct as number | null ?? 0
  const hasBuilderMargin = markupPct > 0
  const completedLineItems = lineItems.filter(item => (item as any).completed !== false)
  const subtotalFromLines = completedLineItems.reduce((sum, item) => sum + (item.line_total ?? 0), 0)
  const markupAmount = hasBuilderMargin ? Math.round(subtotalFromLines * markupPct * 100) / 100 : 0

  // Deductions (e.g. policy excess already paid) are deducted from the total post-GST
  const notesDisplay = invoice.notes || ''
  const excessDeductionIncGst = Math.round(deductions.reduce((sum, d) => sum + (d.amount_inc_gst ?? 0), 0) * 100) / 100

  const grossIncGst = Math.round(((invoice.amount_ex_gst ?? 0) + (invoice.gst ?? 0)) * 100) / 100
  const quoteRefDisplay = approvedQuoteRefs && approvedQuoteRefs.length > 0
    ? approvedQuoteRefs.join(' & ')
    : null

  // Build line items table HTML — grouped under a "Quote {ref}" subheading whenever
  // an invoice's items span more than one quote (quoted_amounts invoices); items
  // with no linked quote fall under a trailing "Additional Items" group. When
  // everything belongs to a single group, render the plain flat row list exactly
  // as before — no heading is introduced for invoice types that never span quotes.
  const lineItemRow = (item: InvoiceLineItem) => {
    const isIncomplete = (item as any).completed === false
    const cellColor = isIncomplete ? '#9e998f' : '#3a3530'
    const struck = isIncomplete ? 'text-decoration:line-through;' : ''
    return `
    <tr style="border-bottom:1px solid #f0ece6;${isIncomplete ? 'background:#fafaf8;' : ''}">
      <td style="padding:8px 12px;font-size:11px;color:${cellColor};line-height:1.5;${struck}">${item.description || '-'}</td>
      <td style="padding:8px 12px;text-align:center;font-size:11px;color:${cellColor};${struck}">${item.quantity || '-'}</td>
      <td style="padding:8px 12px;text-align:right;font-size:11px;font-weight:600;color:${isIncomplete ? '#9e998f' : '#1a1a1a'};${struck}">${fmt(item.line_total)}</td>
    </tr>
  `}

  const buildLineItemsHtml = (items: InvoiceLineItem[]) => {
    const OTHER_LABEL = 'Additional Items'
    const groups: { label: string; items: InvoiceLineItem[] }[] = []
    const groupIndexByKey = new Map<string, number>()

    for (const item of items) {
      const quoteRef = item.quote_ref
      const key = quoteRef || '__other__'
      let idx = groupIndexByKey.get(key)
      if (idx === undefined) {
        idx = groups.length
        groupIndexByKey.set(key, idx)
        groups.push({ label: quoteRef ? `Quote ${quoteRef}` : OTHER_LABEL, items: [] })
      }
      groups[idx].items.push(item)
    }

    if (groups.length <= 1) {
      return items.map(lineItemRow).join('')
    }

    // Keep quote groups in first-seen order, but the no-quote group always trails
    const otherIdx = groups.findIndex(g => g.label === OTHER_LABEL)
    if (otherIdx !== -1 && otherIdx !== groups.length - 1) {
      groups.push(groups.splice(otherIdx, 1)[0])
    }

    return groups.map(group => `
      <tr>
        <td colspan="3" style="padding:9px 12px 5px;font-size:9px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#9e998f;background:#fafaf8;border-bottom:1px solid #e8e4e0;">${group.label}</td>
      </tr>
      ${group.items.map(lineItemRow).join('')}
    `).join('')
  }

  const lineItemsHtml = buildLineItemsHtml(lineItems)

  // ── Build the line-items + totals section (different layout for quoted_amounts) ──────

  const sectionDivider = (label: string) =>
    `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
      <span style="font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#3a3530;white-space:nowrap;">${label}</span>
      <div style="flex:1;height:1px;background:#e0dbd4;"></div>
    </div>`

  const mainBodySectionHtml = invoice.invoice_type === 'quoted_amounts' ? `

    <!-- Clause statement -->
    <div style="background:#f5f2ee;border-left:3px solid #c8b89a;padding:10px 14px;margin-bottom:18px;border-radius:0 4px 4px 0;">
      <span style="font-size:11px;color:#3a3530;line-height:1.6;">
        Work completed as per our quote
        <strong>${quoteRefDisplay ?? 'approved quote'}</strong>,
        as authorised
      </span>
    </div>

    <!-- Scope of works section -->
    ${sectionDivider(`${quoteRefDisplay ?? 'Quote'} — Scope of Works`)}
    <div style="margin-bottom:8px;">
      <table>
        <thead>
          <tr style="background:#fafaf8;border-bottom:1px solid #e8e4e0;">
            <th style="text-align:left;padding:8px 12px;font-size:8px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#b0a89e;">Description</th>
            <th style="width:60px;text-align:center;padding:8px 12px;font-size:8px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#b0a89e;">Qty</th>
            <th style="width:100px;text-align:right;padding:8px 12px;font-size:8px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#b0a89e;">Total</th>
          </tr>
        </thead>
        <tbody>${lineItemsHtml}</tbody>
      </table>
    </div>

    <!-- Quote Invoice Amount sub-totals -->
    <div style="display:flex;justify-content:flex-end;margin-bottom:18px;margin-top:6px;">
      <div style="width:290px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#3a3530;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid #3a3530;">
          ${quoteRefDisplay ?? 'Quote'} Invoice Amount
        </div>
        ${hasBuilderMargin ? `
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0ece6;">
          <span style="font-size:10px;color:#9e998f;">Line Items Subtotal</span>
          <span style="font-size:11px;color:#3a3530;">${fmt(subtotalFromLines)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0ece6;">
          <span style="font-size:10px;color:#9e998f;">Builder&apos;s Margin (${(markupPct * 100).toFixed(1)}%)</span>
          <span style="font-size:11px;color:#3a3530;">${fmt(markupAmount)}</span>
        </div>
        ` : ''}
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0ece6;">
          <span style="font-size:10px;color:#9e998f;">Subtotal (ex GST)</span>
          <span style="font-size:11px;color:#3a3530;">${fmt(invoice.amount_ex_gst)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0ece6;">
          <span style="font-size:10px;color:#9e998f;">GST Applied</span>
          <span style="font-size:11px;color:#3a3530;">${fmt(invoice.gst)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:8px 10px;background:#f5f2ee;border-radius:4px;margin-top:2px;">
          <span style="font-size:11px;font-weight:700;color:#3a3530;">Total (inc GST)</span>
          <span style="font-size:12px;font-weight:700;color:#3a3530;">${fmt(grossIncGst)}</span>
        </div>
      </div>
    </div>

    ${deductions.length > 0 ? `
    <!-- Deductions section -->
    ${sectionDivider('Deductions')}
    <div style="margin-bottom:18px;display:flex;flex-direction:column;gap:6px;">
      ${deductions.map(d => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;background:#fce8e6;border-radius:4px;border-left:3px solid #c5221f;">
        <span style="font-size:11px;color:#3a3530;">${d.description || 'Deduction'}</span>
        <span style="font-size:12px;font-weight:600;color:#c5221f;">${fmt(-(d.amount_inc_gst ?? 0))}</span>
      </div>
      `).join('')}
    </div>
    ` : ''}

    <!-- Total Invoice Payable -->
    ${sectionDivider('Total Invoice Payable')}
    <div style="display:flex;justify-content:flex-end;margin-bottom:20px;">
      <div style="width:290px;">
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0ece6;">
          <span style="font-size:10px;color:#9e998f;">Subtotal (ex GST)</span>
          <span style="font-size:11px;color:#3a3530;">${fmt(invoice.amount_ex_gst)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0ece6;">
          <span style="font-size:10px;color:#9e998f;">GST Applied</span>
          <span style="font-size:11px;color:#3a3530;">${fmt(invoice.gst)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0ece6;">
          <span style="font-size:10px;color:#9e998f;">Total (inc GST)</span>
          <span style="font-size:11px;color:#3a3530;">${fmt(grossIncGst)}</span>
        </div>
        ${excessDeductionIncGst > 0 ? `
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0ece6;">
          <span style="font-size:10px;color:#9e998f;">Less Deductions</span>
          <span style="font-size:11px;color:#c5221f;">${fmt(-excessDeductionIncGst)}</span>
        </div>
        ` : ''}
        <div style="display:flex;justify-content:space-between;padding:12px;background:#1a1a1a;border-radius:4px;margin-top:4px;">
          <span style="font-size:12px;font-weight:600;color:#f5f2ee;">Total Invoice Payable</span>
          <span style="font-size:14px;font-weight:700;color:#ffffff;">${fmt(invoice.amount_inc_gst)}</span>
        </div>
      </div>
    </div>

  ` : `

    <!-- Standard: Line Items Table -->
    <div style="margin-bottom:14px;">
      <table>
        <thead>
          <tr style="background:#fafaf8;border-bottom:1px solid #e8e4e0;">
            <th style="text-align:left;padding:8px 12px;font-size:8px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#b0a89e;">Description</th>
            <th style="width:60px;text-align:center;padding:8px 12px;font-size:8px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#b0a89e;">Qty</th>
            <th style="width:100px;text-align:right;padding:8px 12px;font-size:8px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#b0a89e;">Total</th>
          </tr>
        </thead>
        <tbody>${lineItemsHtml}</tbody>
      </table>
    </div>

    <!-- Standard: Totals Section -->
    <div style="display:flex;justify-content:flex-end;margin-bottom:20px;">
      <div style="width:280px;">
        ${hasBuilderMargin ? `
        <div style="display:flex;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #e0dbd4;">
          <span style="font-size:11px;color:#9e998f;">Subtotal</span>
          <span style="font-size:12px;color:#3a3530;">${fmt(subtotalFromLines)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #e0dbd4;">
          <span style="font-size:11px;color:#9e998f;">Builder&apos;s Margin (${(markupPct * 100).toFixed(1)}%)</span>
          <span style="font-size:12px;color:#3a3530;">${fmt(markupAmount)}</span>
        </div>
        ` : ''}
        <div style="display:flex;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #e0dbd4;">
          <span style="font-size:11px;color:#9e998f;">Subtotal (ex GST)</span>
          <span style="font-size:12px;color:#3a3530;">${fmt(invoice.amount_ex_gst)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #e0dbd4;">
          <span style="font-size:11px;color:#9e998f;">GST (10%)</span>
          <span style="font-size:12px;color:#3a3530;">${fmt(invoice.gst)}</span>
        </div>
        ${excessDeductionIncGst > 0 ? `
        <div style="display:flex;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #e0dbd4;">
          <span style="font-size:11px;color:#9e998f;">Total (inc GST)</span>
          <span style="font-size:12px;color:#3a3530;">${fmt(grossIncGst)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #e0dbd4;">
          <span style="font-size:11px;color:#9e998f;">Less: Excess payment received</span>
          <span style="font-size:12px;color:#c5221f;">${fmt(-excessDeductionIncGst)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:12px;background:#1a1a1a;border-radius:4px;margin-top:4px;">
          <span style="font-size:12px;font-weight:600;color:#f5f2ee;">Final Invoice Total (inc GST)</span>
          <span style="font-size:14px;font-weight:700;color:#ffffff;">${fmt(invoice.amount_inc_gst)}</span>
        </div>
        ` : `
        <div style="display:flex;justify-content:space-between;padding:12px;background:#1a1a1a;border-radius:4px;margin-top:4px;">
          <span style="font-size:12px;font-weight:600;color:#f5f2ee;">Total (inc GST)</span>
          <span style="font-size:14px;font-weight:700;color:#ffffff;">${fmt(invoice.amount_inc_gst)}</span>
        </div>
        `}
      </div>
    </div>

  `

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; background: white; }
  table { border-collapse: collapse; width: 100%; table-layout: fixed; }
</style>
</head>
<body>
<div style="max-width:860px;margin:0 auto;background:white;">

  <!-- HEADER -->
  <div style="display:flex;align-items:stretch;background:white;">
    <div style="width:148px;min-width:148px;padding:14px 8px 14px 20px;
      border-right:1px solid #e0dbd4;">
      <img src="/logo-alt.png" alt="IRC Logo" style="width:100%;height:auto;display:block;margin-bottom:5px;" />
      <div style="font-size:6.5px;letter-spacing:1.8px;text-transform:uppercase;
        color:#9e998f;font-weight:700;white-space:nowrap;">INSURANCE REPAIR CO</div>
    </div>
    <div style="flex:1;padding:14px 10px;border-right:1px solid #e0dbd4;">
      <div style="font-size:11.5px;letter-spacing:1.5px;text-transform:uppercase;
        color:#b0a89e;font-weight:700;margin-bottom:7px;">INVOICE DETAILS</div>
      <div style="display:flex;gap:12px;align-items:center;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:11px;color:#9e998f;">Invoice Number: </span>
          <span style="font-size:14px;font-weight:600;color:#1a1a1a;">
            ${invoice.invoice_ref || 'Draft'}</span>
        </div>
        <div style="display:flex;align-items:center;gap:4px;">
          <span style="font-size:11px;color:#9e998f;">Invoice to: </span>
          <span style="font-size:14px;font-weight:600;color:#1a1a1a;">
            ${isExcess ? (job.insured_name || '—') : (job.invoice_to || '—')}</span>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;font-size:12px;margin-top:6px;">
        ${[
          { label: 'Invoice Date', value: issueDateDisplay },
          { label: 'Due Date', value: dueDateDisplay },
        ].filter(f => f.value).map((field, i, arr) => `
          <span style="padding-right:8px;margin-right:8px;
            border-right:${i < arr.length - 1 ? '1px solid #e0dbd4' : 'none'};">
            <span style="color:#b0a89e;">${field.label}: </span>
            <span style="color:#3a3530;">${field.value || '—'}</span>
          </span>`).join('')}
      </div>
      <div style="font-size:11.5px;letter-spacing:1.5px;text-transform:uppercase;
        color:#b0a89e;font-weight:700;margin-top:12px;margin-bottom:7px;">JOB DETAILS</div>
      <div style="display:flex;flex-wrap:wrap;font-size:12px;">
        ${[
          { label: 'Insurer', value: job.insurer },
          { label: 'Property Address', value: job.property_address },
          { label: 'Insured', value: job.insured_name },
          { label: 'Claim #', value: job.claim_number },
          { label: 'Job #', value: job.job_number },
        ].filter(f => f.value).map((field, i, arr) => `
          <span style="padding-right:8px;margin-right:8px;
            border-right:${i < arr.length - 1 ? '1px solid #e0dbd4' : 'none'};">
            <span style="color:#b0a89e;">${field.label}: </span>
            <span style="color:#3a3530;">${field.value || '—'}</span>
          </span>`).join('')}
      </div>
    </div>
    <div style="width:184px;min-width:184px;padding:14px 26px 14px 10px;">
      <div style="font-size:9.5px;letter-spacing:1.3px;text-transform:uppercase;
        color:#b0a89e;font-weight:700;margin-bottom:7px;">INSURANCE REPAIR CO</div>
      <div style="font-size:10px;color:#3a3530;margin-bottom:3px;">${tenant.address || '—'}</div>
      <div style="font-size:10px;color:#3a3530;margin-bottom:3px;">${tenant.contact_email || '—'}</div>
      <div style="font-size:10px;color:#3a3530;">${tenant.contact_phone || '—'}</div>
    </div>
  </div>

  <!-- FORM BAND -->
  <div style="border-top:1px solid #e0dbd4;border-bottom:1px solid #e0dbd4;
    padding:12px 20px;display:flex;align-items:center;justify-content:center;position:relative;margin-bottom:14px;">
    <span style="font-size:28px;font-weight:700;color:#9e998f;text-transform:uppercase;
      letter-spacing:2px;white-space:nowrap;">TAX INVOICE</span>
  </div>

  <!-- BODY -->
  <div style="padding:14px 20px 0;">

    ${mainBodySectionHtml}

    <!-- Payment Details -->
    <div style="margin-bottom:14px;">
      <div style="font-size:11.5px;letter-spacing:1.5px;text-transform:uppercase;
        color:#b0a89e;font-weight:700;margin-bottom:8px;">PAYMENT DETAILS</div>
      <div style="background:#f5f2ee;border-radius:8px;padding:16px;">
        <div style="display:flex;gap:20px;">
          <!-- Bank Account Details -->
          <div style="flex:2;">
            <div style="background:#1a1a1a;border-radius:6px;padding:14px 16px;">
              <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
                <div style="width:36px;height:36px;background:#c8b89a;border-radius:50%;
                  display:flex;align-items:center;justify-content:center;font-size:18px;">🏦</div>
                <div style="font-size:18px;color:#f5f2ee;font-weight:700;">${tenant.bank_name || '—'}</div>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div>
                  <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;
                    color:#c8b89a;margin-bottom:4px;">BSB</div>
                  <div style="font-size:20px;color:#f5f2ee;font-weight:700;">${tenant.bsb || '—'}</div>
                </div>
                <div>
                  <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;
                    color:#c8b89a;margin-bottom:4px;">Account</div>
                  <div style="font-size:20px;color:#f5f2ee;font-weight:700;">${tenant.account_number || '—'}</div>
                </div>
              </div>
              <div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(200,184,154,0.2);">
                <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;
                  color:#c8b89a;margin-bottom:4px;">Account Name</div>
                <div style="font-size:14px;color:#f5f2ee;font-weight:600;">${tenant.account_name || '—'}</div>
              </div>
            </div>
          </div>
          
          <!-- Reference & Terms -->
          <div style="flex:1;">
            <div style="background:white;border:1px solid #e0dbd4;border-radius:6px;padding:14px;">
              <div style="margin-bottom:14px;">
                <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.2px;
                  color:#9e998f;margin-bottom:6px;">Reference</div>
                <div style="font-size:14px;color:#1a1a1a;font-weight:600;">
                  ${invoice.invoice_ref || invoice.id}
                </div>
              </div>
              <div style="margin-bottom:14px;">
                <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.2px;
                  color:#9e998f;margin-bottom:6px;">Due Date</div>
                <div style="font-size:14px;color:#1a1a1a;font-weight:600;">
                  ${dueDateDisplay}
                </div>
              </div>
              <div style="background:#e8f4e8;border-left:3px solid #2d7d2d;padding:10px 12px;border-radius:4px;">
                <div style="font-size:11px;color:#2d5a2d;font-weight:600;line-height:1.4;">
                  📧 Send receipt to<br/>
                  ${tenant.accounts_email || tenant.contact_email || '—'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Notes/Conditions -->
    <div style="margin-bottom:14px;">
      <div style="font-size:11.5px;letter-spacing:1.5px;text-transform:uppercase;
        color:#b0a89e;font-weight:700;margin-bottom:6px;">NOTES</div>
      <div style="background:#f5f2ee;border-radius:6px;padding:12px 14px;">
        <div style="font-size:10px;color:#3a3530;line-height:1.65;">
          ${notesDisplay || 'No additional notes for this invoice.'}
        </div>
      </div>
    </div>

  </div>

  <!-- FOOTER -->
  <div style="background:#1a1a1a;padding:9px 16px;display:flex;align-items:center;
    gap:10px;">
    ${tenant.logo_storage_path ? `
    <img src="${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/tenant-assets/${tenant.logo_storage_path}" 
      alt="Tenant Logo" style="width:26px;height:26px;object-fit:contain;flex-shrink:0;" />
    ` : `
    <div style="width:26px;height:26px;border:1.5px solid #c8b89a;border-radius:50%;
      display:flex;align-items:center;justify-content:center;flex-shrink:0;
      font-size:9px;font-weight:800;color:#c8b89a;font-style:italic;">IRC.</div>
    `}
    <div>
      <div style="font-size:7.5px;font-weight:700;letter-spacing:1.5px;
        text-transform:uppercase;color:#f5f2ee;">${tenant.trading_name || tenant.name || 'INSURANCE REPAIR CO PTY LTD'}</div>
      <div style="font-size:10px;color:#c8b89a;">Building &amp; Restoration</div>
    </div>
    <div style="width:1px;height:22px;background:#c8b89a;margin:0 4px;
      flex-shrink:0;"></div>
    <span style="font-size:12px;color:#c8b89a;">${(tenant.trading_name || tenant.name || 'INSURANCE REPAIR CO PTY LTD').toUpperCase()} • ABN ${tenant.abn || '—'} • BUILDERS LIC. ${tenant.building_licence_number || '—'}</span>
    <div style="flex:1;"></div>
  </div>

</div>
</body>
</html>`
}
