import type { Database } from '@/lib/supabase/database.types'

type Invoice = Database['public']['Tables']['invoices']['Row']
type InvoiceLineItem = Database['public']['Tables']['invoice_line_items']['Row']
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
  }
  lineItems: InvoiceLineItem[]
}): string {
  const { invoice, job, tenant, lineItems } = params

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
  const dueDateDisplay = formatDate(new Date(new Date(baseDate).getTime() + 14 * 24 * 60 * 60 * 1000).toISOString())

  // Build line items table HTML
  const lineItemsHtml = lineItems.map((item, idx) => `
    <tr style="border-bottom:1px solid #f0ece6;">
      <td style="padding:8px 12px;font-size:11px;color:#3a3530;line-height:1.5;">${item.description || '-'}</td>
      <td style="padding:8px 12px;text-align:center;font-size:11px;color:#3a3530;">${item.quantity || '-'}</td>
      <td style="padding:8px 12px;text-align:right;font-size:11px;color:#3a3530;">${fmt(item.unit_price)}</td>
      <td style="padding:8px 12px;text-align:right;font-size:11px;font-weight:600;color:#1a1a1a;">${fmt(item.line_total)}</td>
    </tr>
  `).join('')

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
    <div style="flex:1;padding:14px 16px;border-right:1px solid #e0dbd4;">
      <div style="font-size:11.5px;letter-spacing:1.5px;text-transform:uppercase;
        color:#b0a89e;font-weight:700;margin-bottom:7px;">INVOICE DETAILS</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;">
        <div>
          <div style="font-size:11px;color:#9e998f;margin-bottom:2px;">
            Invoice to</div>
          <div style="font-size:14px;font-weight:600;color:#1a1a1a;">
            ${job.insurer || '—'}</div>
        </div>
        <div>
          <div style="font-size:11px;color:#9e998f;margin-bottom:2px;">
            Invoice Number</div>
          <div style="font-size:14px;font-weight:600;color:#1a1a1a;">
            ${invoice.invoice_ref || 'Draft'}</div>
        </div>
        <div>
          <div style="font-size:11px;color:#9e998f;margin-bottom:2px;">
            Invoice Date</div>
          <div style="font-size:13px;color:#3a3530;">
            ${issueDateDisplay}</div>
        </div>
        <div>
          <div style="font-size:11px;color:#9e998f;margin-bottom:2px;">
            Due Date</div>
          <div style="font-size:13px;color:#3a3530;">
            ${dueDateDisplay}</div>
        </div>
      </div>
      <div style="font-size:11.5px;letter-spacing:1.5px;text-transform:uppercase;
        color:#b0a89e;font-weight:700;margin-top:12px;margin-bottom:7px;">JOB DETAILS</div>
      <div style="display:flex;flex-wrap:wrap;font-size:12px;">
        ${[
          { label: 'Insurer', value: job.insurer },
          { label: 'Property Address', value: job.property_address },
          { label: 'Job #', value: job.job_number },
          { label: 'Claim #', value: job.claim_number },
          { label: 'Insured', value: job.insured_name },
        ].filter(f => f.value).map((field, i, arr) => `
          <span style="padding-right:8px;margin-right:8px;
            border-right:${i < arr.length - 1 ? '1px solid #e0dbd4' : 'none'};">
            <span style="color:#b0a89e;">${field.label}: </span>
            <span style="color:#3a3530;">${field.value || '—'}</span>
          </span>`).join('')}
      </div>
    </div>
    <div style="width:184px;min-width:184px;padding:14px 20px 14px 16px;">
      <div style="font-size:9.5px;letter-spacing:1.3px;text-transform:uppercase;
        color:#b0a89e;font-weight:700;margin-bottom:7px;">INSURANCE REPAIR CO</div>
      <div style="font-size:12px;color:#3a3530;margin-bottom:3px;">${tenant.address || '—'}</div>
      <div style="font-size:12px;color:#3a3530;margin-bottom:3px;">${tenant.contact_email || '—'}</div>
      <div style="font-size:12px;color:#3a3530;">${tenant.contact_phone || '—'}</div>
    </div>
  </div>

  <!-- FORM BAND -->
  <div style="border-top:1px solid #e0dbd4;border-bottom:1px solid #e0dbd4;
    padding:4px 20px;display:flex;align-items:baseline;position:relative;">
    <span style="position:absolute;left:50%;transform:translateX(-50%);
      font-size:22px;font-weight:700;color:#9e998f;text-transform:uppercase;
      letter-spacing:2px;white-space:nowrap;">TAX INVOICE</span>
  </div>

  <!-- BODY -->
  <div style="padding:14px 20px 0;">

    <!-- Line Items Table -->
    <div style="margin-bottom:14px;">
      <table>
        <thead>
          <tr style="background:#fafaf8;border-bottom:1px solid #e8e4e0;">
            <th style="text-align:left;padding:8px 12px;font-size:8px;font-weight:600;
              text-transform:uppercase;letter-spacing:1px;color:#b0a89e;">
              Description</th>
            <th style="width:60px;text-align:center;padding:8px 12px;font-size:8px;
              font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#b0a89e;">
              Qty</th>
            <th style="width:100px;text-align:right;padding:8px 12px;font-size:8px;
              font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#b0a89e;">
              Unit Price</th>
            <th style="width:100px;text-align:right;padding:8px 12px;font-size:8px;
              font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#b0a89e;">
              Total</th>
          </tr>
        </thead>
        <tbody>
          ${lineItemsHtml}
        </tbody>
      </table>
    </div>

    <!-- Totals Section -->
    <div style="display:flex;justify-content:flex-end;margin-bottom:20px;">
      <div style="width:280px;">
        <div style="display:flex;justify-content:space-between;padding:8px 12px;
          border-bottom:1px solid #e0dbd4;">
          <span style="font-size:11px;color:#9e998f;">Subtotal (ex GST)</span>
          <span style="font-size:12px;color:#3a3530;">${fmt(invoice.amount_ex_gst)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:8px 12px;
          border-bottom:1px solid #e0dbd4;">
          <span style="font-size:11px;color:#9e998f;">GST (10%)</span>
          <span style="font-size:12px;color:#3a3530;">${fmt(invoice.gst)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:12px;
          background:#1a1a1a;border-radius:4px;margin-top:4px;">
          <span style="font-size:12px;font-weight:600;color:#f5f2ee;">Total (inc GST)</span>
          <span style="font-size:14px;font-weight:700;color:#ffffff;">${fmt(invoice.amount_inc_gst)}</span>
        </div>
      </div>
    </div>

    <!-- Payment Details -->
    <div style="margin-bottom:14px;">
      <div style="font-size:11.5px;letter-spacing:1.5px;text-transform:uppercase;
        color:#b0a89e;font-weight:700;margin-bottom:8px;">PAYMENT DETAILS</div>
      <div style="background:#f5f2ee;border-radius:6px;padding:12px 14px;">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
          <div>
            <div style="font-size:9px;letter-spacing:1.2px;text-transform:uppercase;
              color:#b0a89e;font-weight:700;margin-bottom:2px;">BANK</div>
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:16px;">💳</span>
              <div style="font-size:12px;color:#1a1a1a;font-weight:600;">${tenant.bank_name || '—'}</div>
            </div>
          </div>
          <div>
            <div style="font-size:9px;letter-spacing:1.2px;text-transform:uppercase;
              color:#b0a89e;font-weight:700;margin-bottom:2px;">BSB</div>
            <div style="font-size:12px;color:#1a1a1a;font-weight:600;">${tenant.bsb || '—'}</div>
          </div>
          <div>
            <div style="font-size:9px;letter-spacing:1.2px;text-transform:uppercase;
              color:#b0a89e;font-weight:700;margin-bottom:2px;">ACCOUNT NUMBER</div>
            <div style="font-size:12px;color:#1a1a1a;font-weight:600;">${tenant.account_number || '—'}</div>
          </div>
          <div>
            <div style="font-size:9px;letter-spacing:1.2px;text-transform:uppercase;
              color:#b0a89e;font-weight:700;margin-bottom:2px;">ACCOUNT NAME</div>
            <div style="font-size:12px;color:#1a1a1a;font-weight:600;">${tenant.account_name || '—'}</div>
          </div>
          <div style="grid-column:1/3;">
            <div style="font-size:9px;letter-spacing:1.2px;text-transform:uppercase;
              color:#b0a89e;font-weight:700;margin-bottom:2px;">REFERENCE</div>
            <div style="font-size:11px;color:#3a3530;">Please use invoice reference: ${invoice.invoice_ref || invoice.id}</div>
          </div>
          <div>
            <div style="font-size:9px;letter-spacing:1.2px;text-transform:uppercase;
              color:#b0a89e;font-weight:700;margin-bottom:2px;">PAYMENT TERMS</div>
            <div style="font-size:11px;color:#3a3530;">Payment due within 14 days</div>
          </div>
        </div>
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid #e0dbd4;">
          <div style="background:#e8f4e8;border-left:3px solid #2d7d2d;padding:6px 10px;
            border-radius:3px;">
            <div style="font-size:10px;color:#2d5a2d;font-weight:600;">
              Send receipt to ${tenant.accounts_email || tenant.contact_email || '—'}
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
          ${invoice.notes || 'No additional notes for this invoice.'}
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
