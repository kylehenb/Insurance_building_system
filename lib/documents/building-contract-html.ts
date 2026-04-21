import type { Database } from '@/lib/supabase/database.types'

type Quote = Database['public']['Tables']['quotes']['Row']
type ScopeItem = Database['public']['Tables']['scope_items']['Row']
type Job = Database['public']['Tables']['jobs']['Row']

export function generateBuildingContractHtml(params: {
  quote: Quote
  job: Job
  scopeItems: ScopeItem[]
}): string {
  const { quote, job, scopeItems } = params

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

  const contractDate = formatDate(new Date().toISOString())
  const excessValue = job.excess != null && job.excess !== 0 ? fmt(job.excess) : 'N/A'
  
  // Calculate total incl GST if approved_amount is not set
  const subtotal = scopeItems.reduce((sum, item) => sum + (item.line_total || 0), 0)
  const markup = subtotal * (quote.markup_pct || 0.2)
  const subtotalAfterMarkup = subtotal + markup
  const gst = subtotalAfterMarkup * (quote.gst_pct || 0.1)
  const totalInclGst = subtotalAfterMarkup + gst
  const approvedAmount = quote.approved_amount != null ? fmt(quote.approved_amount) : fmt(totalInclGst)

  // Group and sort items — identical logic to sow-html.ts
  const items = [...scopeItems].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

  const groupedByRoom = items.reduce((acc, item) => {
    const room = item.room || 'Unassigned'
    if (!acc[room]) acc[room] = []
    acc[room].push(item)
    return acc
  }, {} as Record<string, ScopeItem[]>)

  const sortedRooms = (() => {
    const roomNames = Object.keys(groupedByRoom)
    if (quote.room_order && quote.room_order.length > 0) {
      const orderMap = new Map(quote.room_order.map((r, i) => [r, i]))
      return roomNames.sort((a, b) => {
        const aIdx = orderMap.get(a) ?? 999
        const bIdx = orderMap.get(b) ?? 999
        return aIdx - bIdx
      })
    }
    return roomNames.sort((a, b) => a.localeCompare(b))
  })()

  // Build scope rows HTML for Item 9
  let globalCounter = 0
  const scopeRowsHtml = sortedRooms.map(room => {
    const roomItems = groupedByRoom[room]
    const itemWithDimensions = roomItems.find(
      item => item.room_length != null || item.room_width != null || item.room_height != null
    )
    const roomLength = itemWithDimensions?.room_length
    const roomWidth = itemWithDimensions?.room_width
    const roomHeight = itemWithDimensions?.room_height
    const hasDimensions = roomLength != null || roomWidth != null || roomHeight != null
    const roomSizeStr = hasDimensions
      ? `${roomLength ?? '—'} × ${roomWidth ?? '—'} × ${roomHeight ?? '—'} m`
      : ''

    const roomHtml = `
    <div style="margin-bottom:8px;">
      <div style="padding:4px 12px;border-bottom:1px solid #e0dbd4;background-color:#f5f2ee;">
        <span style="font-weight:700;color:#3a3530;font-size:12px;text-transform:uppercase;">${room}</span>
        ${hasDimensions ? `<span style="font-size:12px;color:#9e998f;font-family:monospace;margin-left:8px;">${roomSizeStr}</span>` : ''}
      </div>
      <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
        <tbody>
          ${roomItems.map(item => {
            globalCounter++
            return `
            <tr style="border-bottom:1px solid #f0ece6;">
              <td style="width:28px;padding:6px 4px;text-align:center;font-family:monospace;font-size:10px;color:#3a3530;">${globalCounter}</td>
              <td style="padding:6px 8px;font-size:10px;color:#3a3530;line-height:1.5;">${item.item_description || '-'}</td>
              <td style="width:44px;padding:6px 4px;text-align:center;font-size:10px;color:#3a3530;">${item.qty ?? '-'}</td>
              <td style="width:44px;padding:6px 4px;text-align:center;font-size:10px;color:#3a3530;">${item.unit ?? '-'}</td>
              <td style="width:80px;padding:6px 8px;font-size:10px;color:#3a3530;">${item.trade ?? '-'}</td>
            </tr>`
          }).join('')}
        </tbody>
      </table>
    </div>`

    return roomHtml
  }).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>IRC Building Contract – ${job.job_number}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 9pt;
    color: #1a1a1a;
    background: #fff;
  }

  /* ── Page shell ── */
  .page {
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto;
    padding: 0;
    background: #fff;
  }

  /* ── Repeating page header ── */
  .page-header {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    align-items: center;
    border-bottom: 2px solid #1a1a1a;
    padding: 8px 16px;
    gap: 8px;
  }
  .page-header .logo-block {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
  }
  .page-header img {
    height: 36px;
    width: auto;
  }
  .page-header .doc-type {
    text-align: center;
  }
  .page-header .doc-type .doc-title {
    font-size: 8pt;
    font-weight: bold;
    letter-spacing: 0.5px;
  }
  .page-header .doc-type .doc-sub {
    font-size: 7.5pt;
  }
  .page-header .doc-type .doc-section {
    font-size: 10pt;
    font-weight: bold;
    text-transform: uppercase;
    margin-top: 2px;
  }
  .page-header .contact-block {
    text-align: right;
    font-size: 7.5pt;
    line-height: 1.5;
    display: flex;
    align-items: center;
    justify-content: flex-end;
  }

  /* ── Section content area ── */
  .content {
    padding: 10px 16px;
  }

  /* ── Cover letter (page 1) ── */
  .cover-date { margin: 16px 0 12px; font-size: 9pt; }
  .cover-addressee { margin-bottom: 16px; font-size: 9pt; }
  .cover-re-block { margin-bottom: 16px; }
  .cover-re-block table { border-collapse: collapse; }
  .cover-re-block td { padding: 1px 8px 1px 0; font-size: 9pt; }
  .cover-re-block td:first-child { font-weight: bold; width: 90px; }
  .cover-body { font-size: 9pt; line-height: 1.6; margin-bottom: 10px; }
  .cover-list { margin: 8px 0 8px 24px; }
  .cover-list li { margin-bottom: 4px; font-size: 9pt; line-height: 1.5; }
  .cover-sign { margin-top: 20px; font-size: 9pt; line-height: 1.8; }

  /* ── Schedule tables ── */
  .schedule-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 0;
    font-size: 8.5pt;
  }
  .schedule-table th {
    background: #2563a8;
    color: #fff;
    text-align: left;
    padding: 4px 8px;
    font-size: 8.5pt;
    font-weight: bold;
    letter-spacing: 0.3px;
  }
  .schedule-table td {
    border: 1px solid #ccc;
    padding: 4px 8px;
    vertical-align: top;
    line-height: 1.4;
  }
  .schedule-table td.label {
    font-weight: bold;
    text-align: right;
    width: 38%;
    background: #f5f5f5;
    white-space: nowrap;
  }
  .schedule-table td.value {
    width: 62%;
  }
  .schedule-table tr.section-header td {
    background: #2563a8;
    color: #fff;
    font-weight: bold;
    padding: 4px 8px;
    font-size: 8.5pt;
  }

  /* ── Progress payments table ── */
  .progress-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 8pt;
    margin: 6px 0;
  }
  .progress-table th {
    border: 1px solid #999;
    padding: 3px 6px;
    text-align: center;
    background: #e8e8e8;
    font-weight: bold;
    text-decoration: underline;
  }
  .progress-table td {
    border: 1px solid #999;
    padding: 3px 6px;
    text-align: center;
  }
  .progress-table td.stage-label { font-weight: bold; }

  /* ── Scope of works ── */
  .sow-section { margin-bottom: 10px; }
  .sow-section-title {
    background: #e8e8e8;
    padding: 3px 8px;
    font-weight: bold;
    font-size: 8.5pt;
    border: 1px solid #ccc;
    margin-bottom: 0;
  }
  .sow-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 8pt;
  }
  .sow-table td {
    border: 1px solid #ddd;
    padding: 3px 6px;
    vertical-align: top;
    line-height: 1.4;
  }
  .sow-table td.sow-num { width: 5%; text-align: center; }
  .sow-table td.sow-desc { width: 80%; }
  .sow-table td.sow-qty { width: 15%; text-align: right; white-space: nowrap; }

  /* ── General conditions ── */
  .gc-content { font-size: 8pt; line-height: 1.45; }
  .gc-columns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .gc-content h3 {
    font-size: 8pt;
    font-weight: bold;
    margin: 8px 0 3px;
    text-transform: uppercase;
  }
  .gc-content h4 {
    font-size: 8pt;
    font-weight: bold;
    margin: 6px 0 2px;
    font-style: italic;
  }
  .gc-content p { margin-bottom: 4px; }
  .gc-content ol { margin-left: 14px; margin-bottom: 4px; }
  .gc-content ol li { margin-bottom: 2px; }
  .gc-content ul { margin-left: 14px; margin-bottom: 4px; }
  .gc-content ul li { margin-bottom: 2px; }
  .gc-note {
    border: 1px solid #999;
    padding: 4px 8px;
    font-size: 7.5pt;
    margin-bottom: 8px;
    font-style: italic;
  }

  /* ── Notice for Home Owner ── */
  .notice-title {
    text-align: center;
    font-size: 14pt;
    font-weight: bold;
    margin: 16px 0 4px;
  }
  .notice-subtitle {
    text-align: center;
    font-size: 11pt;
    font-weight: bold;
    margin-bottom: 12px;
  }
  .notice-body { font-size: 8pt; line-height: 1.5; }
  .notice-body h4 { font-weight: bold; margin: 8px 0 3px; }
  .notice-body p { margin-bottom: 5px; }
  .notice-body ul { margin-left: 16px; margin-bottom: 5px; }
  .notice-body ul li { margin-bottom: 2px; }

  /* ── Signing section ── */
  .signing-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-top: 8px;
  }
  .signing-box { font-size: 8.5pt; line-height: 1.7; }
  .signing-box .sig-line {
    border-bottom: 1px solid #666;
    margin: 16px 0 4px;
    height: 32px;
  }
  .signing-box .sig-label { font-size: 7.5pt; color: #555; font-style: italic; }

  /* ── Important notices ── */
  .important-block { margin: 10px 0; }
  .important-block h4 { font-weight: bold; font-size: 8.5pt; margin-bottom: 4px; }
  .important-block p { font-size: 8pt; margin-bottom: 4px; line-height: 1.45; }
  .important-block ul { margin-left: 16px; font-size: 8pt; }
  .important-block ul li { margin-bottom: 2px; }

  /* ── Footer ── */
  .page-footer {
    border-top: 1px solid #999;
    padding: 4px 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 7pt;
    color: #555;
    margin-top: 16px;
  }

  /* ── Page breaks ── */
  .page-break { page-break-after: always; break-after: page; }

  /* ── Utility ── */
  .bold { font-weight: bold; }
  .center { text-align: center; }
  .mt4 { margin-top: 4px; }
  .mt8 { margin-top: 8px; }
  .mt12 { margin-top: 12px; }
  .mb4 { margin-bottom: 4px; }
  .mb8 { margin-bottom: 8px; }
  .dotted { border-bottom: 1px dotted #666; display: inline-block; min-width: 120px; }
  .checkbox { display: inline-block; border: 1px solid #333; width: 10px; height: 10px; margin-right: 3px; vertical-align: middle; text-align: center; font-size: 8pt; line-height: 10px; }
  .checkbox.checked::after { content: "✖"; }
  .field-blank { border-bottom: 1px dotted #666; display: inline-block; min-width: 80px; }

  @media print {
    body { margin: 0; }
    .page { margin: 0; width: 100%; }
    .no-print { display: none; }
  }
</style>
</head>
<body>

<!-- ═══════════════════════════════════════════════════════════════
     PRINT BUTTON (hidden on print)
═══════════════════════════════════════════════════════════════ -->
<div class="no-print" style="position:fixed;top:12px;right:12px;z-index:999;">
  <button onclick="window.print()" style="background:#1a1a1a;color:#fff;border:none;padding:10px 20px;font-size:13px;cursor:pointer;border-radius:4px;font-family:Arial;">
    🖨 Print / Save PDF
  </button>
</div>

<!-- ═══════════════════════════════════════════════════════════════
     PAGE 1 — COVER LETTER
═══════════════════════════════════════════════════════════════ -->
<div class="page">
  <div class="page-header">
    <div class="logo-block">
      <img src="/logo-alt.png" alt="Insurance Repair Co" />
      <div style="font-size:6.5px;letter-spacing:1.8px;text-transform:uppercase;color:#9e998f;font-weight:700;white-space:nowrap;margin-top:4px;">INSURANCE REPAIR CO</div>
    </div>
    <div class="doc-type">
      <div class="doc-title">INSURANCE REPAIR CONTRACT - WA</div>
      <div class="doc-sub">PRIVATE INSURER</div>
      <div class="doc-section">CONTRACT SCHEDULE</div>
    </div>
    <div class="contact-block">
      office@insurancerepairco.com.au
    </div>
  </div>

  <div class="content">
    <p class="cover-date">${contractDate}</p>
    <p class="cover-addressee">${job.insured_name || ''}</p>

    <div class="cover-re-block">
      <table>
        <tr><td><strong>RE:</strong></td><td>Building Contract: ${job.insured_name || ''} - ${job.property_address || ''}</td></tr>
        <tr><td><strong>CLAIM NO:</strong></td><td>${job.claim_number || ''}</td></tr>
        <tr><td><strong>REF NO:</strong></td><td>${quote.quote_ref || ''}</td></tr>
        <tr><td><strong>JOB NO:</strong></td><td>${job.job_number || ''}</td></tr>
      </table>
    </div>

    <p class="cover-body">We are pleased to advise that your Insurer has instructed Insurance Repair Co to proceed with the insurance repairs at your property.</p>
    <p class="cover-body">Attached is a Building Contract for your reference, which is a state based requirement for jobs over $7,500 in WA.</p>
    <p class="cover-body">To enable repairs to commence at your property, please complete the below steps:</p>

    <ul class="cover-list">
      <li>Review and sign the attached Building Contract, scan and return via email to office@insurancerepairco.com.au</li>
      <li>Pay your excess if applicable. (please see separate email regarding this)</li>
      <li>Complete maintenance if applicable as advised (please see separate email regarding this)</li>
    </ul>

    <p class="cover-body">If you have any queries, please call our office to discuss.</p>

    <div class="cover-sign">
      <p>Kind regards</p>
      <br>
      <p>Insurance Repair Co</p>
      <p>Kyle Bindon</p>
      <p>office@insurancerepairco.com.au</p>
    </div>
  </div>

  <div class="page-footer">
    <span>DOC-${job.job_number || ''}</span>
    <span>Insurance Repair Co Pty Ltd &nbsp;ABN 12 686 067 881 &nbsp;WA Lic. BC105884</span>
    <span>Page 1</span>
  </div>
</div>

<div class="page-break"></div>

<!-- ═══════════════════════════════════════════════════════════════
     PAGE 2 — CONTRACT SCHEDULE (Items 1–8)
═══════════════════════════════════════════════════════════════ -->
<div class="page">
  <div class="page-header">
    <div class="logo-block">
      <img src="/logo-alt.png" alt="Insurance Repair Co" />
      <div style="font-size:6.5px;letter-spacing:1.8px;text-transform:uppercase;color:#9e998f;font-weight:700;white-space:nowrap;margin-top:4px;">INSURANCE REPAIR CO</div>
      <div style="font-size:7.5pt;color:#555;margin-top:2px;">office@insurancerepairco.com.au</div>
    </div>
    <div class="doc-type">
      <div class="doc-title">INSURANCE REPAIR CONTRACT - WA</div>
      <div class="doc-sub">PRIVATE INSURER</div>
      <div class="doc-section">CONTRACT SCHEDULE</div>
    </div>
    <div class="contact-block"></div>
  </div>

  <div class="content">

    <!-- Item 1 -->
    <table class="schedule-table" style="margin-bottom:6px;">
      <tr><td colspan="2" class="section-header">Item 1 - OWNER</td></tr>
      <tr><td class="label">OWNER NAME:</td><td class="value">${job.insured_name || ''}</td></tr>
      <tr><td class="label">Postal Address:</td><td class="value">${job.property_address || ''}</td></tr>
      <tr><td class="label">Phone:</td><td class="value">Mobile: ${job.insured_phone || ''}</td></tr>
      <tr><td class="label">Email:</td><td class="value">${job.insured_email || ''}</td></tr>
      <tr><td class="label">Owner's Representative:</td><td class="value" style="height:28px;">
        <span style="font-size:7.5pt;font-style:italic;color:#888;">Printed Name of person authorized by the Owner to act on their behalf</span>
      </td></tr>
      <tr><td class="label">Phone:</td><td class="value">&nbsp;</td></tr>
      <tr><td class="label">Registered owner of the Site?</td><td class="value">
        <span class="checkbox checked"></span> Yes &nbsp;&nbsp; <span class="checkbox"></span> No
      </td></tr>
    </table>

    <!-- Item 2 -->
    <table class="schedule-table" style="margin-bottom:6px;">
      <tr><td colspan="2" class="section-header">Item 2 - CONTRACTOR</td></tr>
      <tr><td class="label">CONTRACTOR NAME:</td><td class="value">Insurance Repair Co Pty Ltd</td></tr>
      <tr><td class="label">ABN No:</td><td class="value">12 686 067 881 &nbsp;&nbsp; Licence No: BC105884</td></tr>
      <tr><td class="label">Postal Address:</td><td class="value">20 Roche Road, Duncraig, WA 6023</td></tr>
      <tr><td class="label">Phone:</td><td class="value">0431 132 077</td></tr>
      <tr><td class="label">Email:</td><td class="value">office@insurancerepairco.com.au</td></tr>
    </table>

    <!-- Item 3 -->
    <table class="schedule-table" style="margin-bottom:6px;">
      <tr><td colspan="2" class="section-header">Item 3 - OWNER INSURANCE DETAILS</td></tr>
      <tr>
        <td class="label">Insurer's Name:</td>
        <td class="value" style="width:31%;">${job.insurer || ''}</td>
        <td class="label" style="width:19%;text-align:right;">Claim Number:</td>
        <td class="value" style="width:19%;">${job.claim_number || ''}</td>
      </tr>
      <tr>
        <td class="label">Insurer's Address:</td>
        <td class="value" colspan="3">&nbsp;</td>
      </tr>
      <tr>
        <td class="label">Excess:</td>
        <td class="value" style="width:31%;">${excessValue}</td>
        <td class="label" style="width:19%;text-align:right;">Approved:</td>
        <td class="value" style="width:19%;">${approvedAmount}</td>
      </tr>
    </table>

    <!-- Item 4 -->
    <table class="schedule-table" style="margin-bottom:6px;">
      <tr>
        <td class="section-header" style="width:12%;">Item 4 - SITE</td>
        <td style="border:1px solid #ccc;padding:4px 8px;font-size:8.5pt;" colspan="3">
          Address: ${job.property_address || ''}
        </td>
      </tr>
      <tr>
        <td class="label">Lot No:</td><td class="value"></td>
        <td class="label">Deposited Plan No:</td><td class="value"></td>
      </tr>
    </table>

    <!-- Item 5 -->
    <table class="schedule-table" style="margin-bottom:6px;">
      <tr><td colspan="2" class="section-header">Item 5 - ESTIMATED (incl GST)</td></tr>
      <tr><td colspan="2" style="border:1px solid #ccc;padding:4px 8px;font-size:8pt;line-height:1.5;">
        Building Works Component inclusive of GST (the Contract Sum) as adjusted in accordance with the Contract, at the times and in the manner specified in the Conditions.<br><br>
        <strong>ESTIMATED (inclusive GST) &nbsp;&nbsp; ${approvedAmount}</strong><br><br>
        Home Owners Warranty has been allowed for a total cost of: <span class="field-blank">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span> INCL GST<br>
        This allowance is not included in the total job value provided within Items 3 &amp; 5 within the Contract.<br><br>
        <em>Warning: The Contract Price may increase in accordance with the contract terms. This is because not all costs can be absolutely determined at the outset, although the Contractor is obliged to make reasonable estimates given known conditions. The reasons for possible increases include:</em>
        <ul style="margin-left:16px;margin-top:4px;">
          <li>extra costs incurred by the Contractor in accessing the Site (Refer clause 5.2 of the General Conditions)</li>
          <li>the actual cost of prime cost items and work for which provisional sums have been specified exceeding the estimates set out in the contract (Refer clause 7 of the General Conditions)</li>
          <li>variations including those required by the council/registered building surveyor (Refer clause 8 of the General Conditions)</li>
          <li>extra costs for delay claimed by the Contractor (Refer clauses 5.4 and 9.5 of the General Conditions)</li>
        </ul>
      </td></tr>
    </table>

    <!-- Item 6 -->
    <table class="schedule-table" style="margin-bottom:6px;">
      <tr><td colspan="4" class="section-header">Item 6 - WORK PERIOD</td></tr>
      <tr><td colspan="4" style="border:1px solid #ccc;padding:4px 8px;font-size:8pt;line-height:1.6;">
        <strong>TBC</strong> Calendar Days (including "Delays Allowance" - below)<br><br>
        <em>*If there is a reasonable likelihood that the work period will be affected by a delay, the following section must be completed</em><br><br>
        <strong>DELAYS ALLOWANCE (included in the Work Period)</strong><br>
        A. Inclement Weather &nbsp;<span class="field-blank">&nbsp;&nbsp;&nbsp;</span> Calendar Days<br>
        B. Weekends/Public Holidays/RDOs and other foreseeable breaks in continuity of the Works &nbsp;<span class="field-blank">&nbsp;&nbsp;&nbsp;</span> Calendar Days<br>
        C. Other delays that are reasonable having regard to the nature of contract &nbsp;<span class="field-blank">&nbsp;&nbsp;&nbsp;</span> Calendar Days<br>
        D. TOTAL DELAYS allowed &nbsp;<span class="field-blank">&nbsp;&nbsp;&nbsp;</span> Calendar Days
      </td></tr>
    </table>

    <!-- Items 7 & 8 -->
    <table class="schedule-table" style="margin-bottom:6px;">
      <tr>
        <td class="section-header" style="width:30%;">Item 7 - DATE for COMMENCEMENT</td>
        <td style="border:1px solid #ccc;padding:4px 8px;font-size:8pt;width:30%;">
          <span class="field-blank" style="min-width:60px;">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
        </td>
        <td style="border:1px solid #ccc;padding:4px 8px;font-size:8pt;width:8%;text-align:center;">OR</td>
        <td style="border:1px solid #ccc;padding:4px 8px;font-size:8pt;">to be determined under Clause 7 of the General Conditions</td>
      </tr>
      <tr>
        <td class="section-header">Item 8 - DATE for PRACT. COMPL</td>
        <td colspan="3" style="border:1px solid #ccc;padding:4px 8px;font-size:8pt;">The Day being the Date for Commencement (Item 7) plus the Work Period (Item 6)</td>
      </tr>
    </table>

  </div>

  <div class="page-footer">
    <span>DOC-${job.job_number || ''}</span>
    <span>Insurance Repair Co Pty Ltd &nbsp;ABN 12 686 067 881 &nbsp;WA Lic. BC105884</span>
    <span>Page 2</span>
  </div>
</div>

<div class="page-break"></div>

<!-- ═══════════════════════════════════════════════════════════════
     PAGE 3 — CONTRACT SCHEDULE (Items 9–13)
═══════════════════════════════════════════════════════════════ -->
<div class="page">
  <div class="page-header">
    <div class="logo-block">
      <img src="/logo-alt.png" alt="Insurance Repair Co" />
      <div style="font-size:6.5px;letter-spacing:1.8px;text-transform:uppercase;color:#9e998f;font-weight:700;white-space:nowrap;margin-top:4px;">INSURANCE REPAIR CO</div>
      <div style="font-size:7.5pt;color:#555;margin-top:2px;">office@insurancerepairco.com.au</div>
    </div>
    <div class="doc-type">
      <div class="doc-title">INSURANCE REPAIR CONTRACT - WA</div>
      <div class="doc-sub">PRIVATE INSURER</div>
      <div class="doc-section">CONTRACT SCHEDULE</div>
    </div>
    <div class="contact-block"></div>
  </div>

  <div class="content">

    <!-- Item 9 - Scope of Works -->
    <table class="schedule-table" style="margin-bottom:6px;">
      <tr><td colspan="2" class="section-header">Item 9 - WORKS</td></tr>
      <tr><td colspan="2" style="border:1px solid #ccc;padding:4px 8px;font-size:8pt;line-height:1.6;">
        Description of the Works to be performed under this Contract:<br>
        <span class="checkbox checked"></span> <strong>in accordance with the Contractor's Scope of Works approved by the Insurer (copy attached),</strong><br>
        or<br>
        <span class="checkbox"></span> as described below: <em>(attach and describe any Drawings or Site Plans that are being relied upon)</em><br>
        <span class="field-blank" style="min-width:300px;">&nbsp;</span>
      </td></tr>
    </table>

    <!-- Scope of Works Table (similar to SOW but no pricing) -->
    <div style="margin-bottom:0;">
      <div style="font-size:11.5px;letter-spacing:1.5px;text-transform:uppercase;color:#b0a89e;font-weight:700;margin-bottom:6px;">
        SCOPE OF WORKS (Approved by Insurer)
      </div>

      {/* Table header */}
      <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
        <thead>
          <tr style="background:#fafaf8;border-bottom:1px solid #e8e4e0;">
            <th style="width:28px;text-align:center;padding:6px 4px;font-size:8px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#b0a89e;">#</th>
            <th style="text-align:left;padding:6px 8px;font-size:8px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#b0a89e;">Description of works</th>
            <th style="width:44px;text-align:center;padding:6px 4px;font-size:8px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#b0a89e;">Qty</th>
            <th style="width:44px;text-align:center;padding:6px 4px;font-size:8px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#b0a89e;">Unit</th>
            <th style="width:80px;text-align:left;padding:6px 8px;font-size:8px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#b0a89e;">Trade</th>
          </tr>
        </thead>
      </table>

      {/* Rooms and items */}
      ${scopeRowsHtml}
    </div>

    <!-- Item 10 -->
    <table class="schedule-table" style="margin-bottom:6px;">
      <tr>
        <td class="section-header" style="width:50%;">Item 10 - PROGRESS PAYMENTS</td>
        <td style="border:1px solid #ccc;padding:4px 8px;font-size:8.5pt;">
          <span class="checkbox"></span> YES &nbsp;&nbsp;&nbsp; <span class="checkbox checked"></span> NO
        </td>
      </tr>
      <tr><td colspan="2" style="border:1px solid #ccc;padding:4px 8px;font-size:8pt;line-height:1.5;">
        <em>Note:</em>
        <ul style="margin-left:16px;">
          <li>Deposit limit: 6.5% of the Contract Price</li>
          <li>Deposit is payable in accordance with clause 1.3 of the General Conditions and equal to the Excess (Item 3) but not more than the Deposit limit</li>
          <li>Each progress claim must not exceed an amount directly related to the progress of Work under the Contract</li>
        </ul>
      </td></tr>
      <tr><td colspan="2" style="border:1px solid #ccc;padding:0;">
        <table class="progress-table" style="margin:0;width:100%;">
          <thead>
            <tr>
              <th>STAGE of Work</th>
              <th>WORKS INCLUDED IN STAGE</th>
              <th>% of WORKS</th>
              <th>AMOUNT Due</th>
            </tr>
          </thead>
          <tbody>
            <tr><td class="stage-label">Deposit</td><td></td><td>%</td><td>$</td></tr>
            <tr><td>Stage 1</td><td></td><td>%</td><td>$</td></tr>
            <tr><td>Stage 2</td><td></td><td>%</td><td>$</td></tr>
            <tr><td>Stage 3</td><td></td><td>%</td><td>$</td></tr>
            <tr><td>Stage 4</td><td></td><td>%</td><td>$</td></tr>
            <tr><td>Stage 5</td><td></td><td>%</td><td>$</td></tr>
            <tr><td>Stage 6</td><td><em>Practical Completion</em></td><td>%</td><td>$</td></tr>
            <tr><td class="stage-label">TOTAL</td><td></td><td>100 %</td><td>$</td></tr>
          </tbody>
        </table>
      </td></tr>
    </table>

    <!-- Item 11 -->
    <table class="schedule-table" style="margin-bottom:6px;">
      <tr><td class="section-header">Item 11 - EXCLUDED ITEMS</td></tr>
      <tr><td style="border:1px solid #ccc;padding:4px 8px;font-size:8pt;line-height:1.5;">
        Unless otherwise stated elsewhere in the Contract, the following items are not part of the Works and are excluded from the Contract and not included in the Contract Price:<br><br>
        Warranty or liability in respect of any nature on any work not actually performed by the Contractor, any work in whole or in part that is carried out by the Owner or others (prior to, during or after the Contract); survey of the property; the cost of overcoming any Latent Condition, and any other excluded items shown hereunder:<br><br>
        <span style="font-weight:bold;">.....N/A - REFER SCOPE OF WORKS ATTACHED FOR INCLUSION.....</span>
      </td></tr>
    </table>

    <!-- Item 12 -->
    <table class="schedule-table" style="margin-bottom:6px;">
      <tr><td class="section-header">Item 12 - OTHER CONTRACT DOCUMENTS</td></tr>
      <tr><td style="border:1px solid #ccc;padding:4px 8px;font-size:8.5pt;font-weight:bold;">N/A</td></tr>
      <tr><td style="border:1px solid #ccc;padding:4px 8px;font-size:7.5pt;font-style:italic;line-height:1.4;">
        Note: Existing Plans/Specifications must be obtained before entering into this Contract. If the Contractor is required to obtain such data, a copy must be given to the Owner on payment of the Contractor's costs incurred in obtaining the data. If a detailed footings or slab design is required, it should be based on the Foundations Data and included in the Plans prior to the parties signing this Contract. Copies of all other contract documents must be attached to this Contract.
      </td></tr>
    </table>

    <!-- Item 13 -->
    <table class="schedule-table" style="margin-bottom:6px;">
      <tr><td class="section-header">Item 13 - CONTRACTORS' MARGIN</td></tr>
      <tr><td style="border:1px solid #ccc;padding:4px 8px;font-size:8pt;">
        For the purpose of valuing Variations, Adjustments to Prime Cost Items or Provisional Sums, the Contractor's Margin is .........N/A.........%
      </td></tr>
    </table>

  </div>

  <div class="page-footer">
    <span>DOC-${job.job_number || ''}</span>
    <span>Insurance Repair Co Pty Ltd &nbsp;ABN 12 686 067 881 &nbsp;WA Lic. BC105884</span>
    <span>Page 3</span>
  </div>
</div>

<div class="page-break"></div>

<!-- ═══════════════════════════════════════════════════════════════
     PAGE 4 — ITEMS 14–16 + SIGNING
═══════════════════════════════════════════════════════════════ -->
<div class="page">
  <div class="page-header">
    <div class="logo-block">
      <img src="/logo-alt.png" alt="Insurance Repair Co" />
      <div style="font-size:6.5px;letter-spacing:1.8px;text-transform:uppercase;color:#9e998f;font-weight:700;white-space:nowrap;margin-top:4px;">INSURANCE REPAIR CO</div>
      <div style="font-size:7.5pt;color:#555;margin-top:2px;">office@insurancerepairco.com.au</div>
    </div>
    <div class="doc-type">
      <div class="doc-title">INSURANCE REPAIR CONTRACT - WA</div>
      <div class="doc-sub">PRIVATE INSURER</div>
      <div class="doc-section">CONTRACT SCHEDULE</div>
    </div>
    <div class="contact-block"></div>
  </div>

  <div class="content">

    <!-- Items 14 & 15 -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:6px;">
      <table class="schedule-table">
        <tr><td class="section-header">Item 14 - PROVISIONAL SUM ITEMS</td></tr>
        <tr><td style="border:1px solid #ccc;padding:4px 8px;font-size:8pt;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><th style="text-align:left;font-size:7.5pt;border-bottom:1px solid #ccc;">Description</th><th style="text-align:right;font-size:7.5pt;border-bottom:1px solid #ccc;">Provisional Sum Allowance</th></tr>
            <tr><td style="padding:3px 0;font-weight:bold;">.....N/A.....</td><td></td></tr>
            <tr><td style="padding:3px 0;">&nbsp;</td><td></td></tr>
            <tr><td style="padding:3px 0;">&nbsp;</td><td></td></tr>
            <tr style="border-top:1px solid #ccc;"><td style="padding:3px 0;font-size:7.5pt;">TOTAL of Provisional Sum Items:</td><td style="text-align:right;">$ ............</td></tr>
          </table>
          <p style="font-size:7pt;font-style:italic;margin-top:4px;">Warning: If the cost of a Provisional Sum Item exceeds the allowance above, the Contract Price will be adjusted in accordance with Clause 7 of the General Conditions.</p>
        </td></tr>
      </table>

      <table class="schedule-table">
        <tr><td class="section-header">Item 15 - PRIME COST ITEMS</td></tr>
        <tr><td style="border:1px solid #ccc;padding:4px 8px;font-size:8pt;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <th style="text-align:left;font-size:7.5pt;border-bottom:1px solid #ccc;">Description</th>
              <th style="text-align:center;font-size:7.5pt;border-bottom:1px solid #ccc;">Rate</th>
              <th style="text-align:right;font-size:7.5pt;border-bottom:1px solid #ccc;">Prime Cost Allowance</th>
            </tr>
            <tr><td style="padding:3px 0;font-weight:bold;">.....N/A.....</td><td></td><td></td></tr>
            <tr><td style="padding:3px 0;">&nbsp;</td><td></td><td></td></tr>
            <tr style="border-top:1px solid #ccc;"><td style="padding:3px 0;font-size:7.5pt;">TOTAL of Prime Cost Items:</td><td style="text-align:center;">$ .......</td><td style="text-align:right;">$ .......</td></tr>
          </table>
          <p style="font-size:7pt;font-style:italic;margin-top:4px;">Warning: If the cost of a Prime Cost Item exceeds the allowance above, the Contract Price will be adjusted in accordance with Clause 7 of the General Conditions.</p>
        </td></tr>
      </table>
    </div>

    <!-- Item 16 -->
    <table class="schedule-table" style="margin-bottom:10px;">
      <tr><td class="section-header">Item 16 - SPECIAL CONDITIONS</td></tr>
      <tr><td style="border:1px solid #ccc;padding:4px 8px;font-size:8pt;height:40px;font-weight:bold;">.....N/A.....</td></tr>
    </table>

    <!-- Important notices -->
    <div class="important-block">
      <h4>IMPORTANT NOTICES</h4>
      <ul>
        <li>Do not sign this Contract unless you have read and understand the clauses as well as the notes and explanations contained in this document.</li>
        <li>Both the Contractor and the Owner should retain an identical signed copy of this Contract including the drawings, specifications and other attached documents.</li>
        <li>Make sure that you initial all attached documents and any amendments or deletions to the Contract.</li>
      </ul>
    </div>

    <div class="important-block" style="margin-top:8px;">
      <h4>INSURANCE UNDER PART 3A OF THE HOME BUILDING CONTRACTS ACT 1991</h4>
      <p>The Contractor must provide the Owner with a certificate of insurance under Part 3A of the Home Building Contracts Act 1991 before the Contractor commences work and before the Contractor can request or receive any payment.</p>
    </div>

    <div class="important-block" style="margin-top:8px;">
      <h4>HOME BUILDING CONTRACTS ACT 1991 SECTION 6 - RECEIPT OF DOCUMENTS</h4>
      <p>Under section 6 of the Home Building Contracts Act 1991 (the Act), the Owner acknowledges receipt of the following documents:</p>
      <ol style="margin-left:16px;font-size:8pt;">
        <li>Attached notice of explanation of the relevant provisions of the Act, prescribed under section 4 (2) (Schedule, pages 12-13).</li>
        <li>A signed copy of the Building Contract dated: ${contractDate}</li>
      </ol>
    </div>

    <div style="margin-top:12px;font-size:8.5pt;">
      Signed<span class="field-blank" style="min-width:200px;">&nbsp;</span> (Owner) ${job.insured_name || ''} &nbsp;&nbsp; Date <span class="field-blank" style="min-width:80px;">&nbsp;</span>
    </div>

  </div>

  <div class="page-footer">
    <span>DOC-${job.job_number || ''}</span>
    <span>Insurance Repair Co Pty Ltd &nbsp;ABN 12 686 067 881 &nbsp;WA Lic. BC105884</span>
    <span>Page 4</span>
  </div>
</div>

<div class="page-break"></div>

<!-- ═══════════════════════════════════════════════════════════════
     PAGE 5 — SIGNING PAGE
═══════════════════════════════════════════════════════════════ -->
<div class="page">
  <div class="page-header">
    <div class="logo-block">
      <img src="/logo-alt.png" alt="Insurance Repair Co" />
      <div style="font-size:6.5px;letter-spacing:1.8px;text-transform:uppercase;color:#9e998f;font-weight:700;white-space:nowrap;margin-top:4px;">INSURANCE REPAIR CO</div>
      <div style="font-size:7.5pt;color:#555;margin-top:2px;">office@insurancerepairco.com.au</div>
    </div>
    <div class="doc-type">
      <div class="doc-title">INSURANCE REPAIR CONTRACT - WA</div>
      <div class="doc-sub">PRIVATE INSURER</div>
      <div class="doc-section">CONTRACT SCHEDULE</div>
    </div>
    <div class="contact-block"></div>
  </div>

  <div class="content">
    <div class="signing-grid" style="margin-top:16px;">

      <div class="signing-box">
        <p class="bold">OWNER:</p>
        <p class="mt8">DATE signed by Owner/s: <span class="field-blank" style="min-width:140px;">&nbsp;</span></p>
        <p class="mt8">${job.insured_name || ''}</p>
        <p style="font-size:7.5pt;color:#555;">(Printed Name of Owner/s)</p>
        <p class="mt8">Authorised Signature/s:</p>
        <div class="sig-line"></div>
        <p class="sig-label">&nbsp;</p>
      </div>

      <div class="signing-box">
        <p class="bold">CONTRACTOR:</p>
        <p class="mt8">DATE signed by Contractor: ${contractDate}</p>
        <p class="mt8">Insurance Repair Co Pty Ltd</p>
        <p style="font-size:7.5pt;color:#555;">(Printed Name of Contractor)</p>
        <p class="mt8">Authorised Signature/s:</p>
        <div class="sig-line" style="position:relative;">
          <img src="/signature.png" alt="Kyle Bindon signature" style="position:absolute;top:4px;left:0;height:28px;opacity:0.85;" />
        </div>
        <p class="sig-label">(on behalf of Contractor)</p>
        <p class="mt4">Kyle Bindon</p>
        <p style="font-size:7.5pt;color:#555;">(Printed Name of Authorised Representative of the Contractor)</p>
      </div>

    </div>
  </div>

  <div class="page-footer">
    <span>DOC-${job.job_number || ''}</span>
    <span>Insurance Repair Co Pty Ltd &nbsp;ABN 12 686 067 881 &nbsp;WA Lic. BC105884</span>
    <span>Page 5</span>
  </div>
</div>

</body>
</html>`
}
