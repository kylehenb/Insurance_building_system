import type { Database } from '@/lib/supabase/database.types'

type Quote = Database['public']['Tables']['quotes']['Row']
type ScopeItem = Database['public']['Tables']['scope_items']['Row']
type Job = Database['public']['Tables']['jobs']['Row']

export function generateSowHtml(params: {
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

  const excessValue = job.excess != null && job.excess !== 0 ? fmt(job.excess) : 'N/A'
  const issueDateDisplay = formatDate(new Date().toISOString())

  // Group and sort items — identical logic to page.tsx
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

  // Build scope rows HTML
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

    const roomHeaderHtml = `
    <tr>
      <td colspan="5" style="padding:4px 12px;background:#f5f2ee;
        border-bottom:1px solid #e0dbd4;border-top:6px solid white;">
        <span style="font-weight:700;color:#3a3530;font-size:12px;
          text-transform:uppercase;">${room}</span>
        ${hasDimensions ? `<span style="font-size:12px;color:#9e998f;
          font-family:monospace;margin-left:8px;">${roomSizeStr}</span>` : ''}
      </td>
    </tr>`

    const rowsHtml = roomItems.map(item => {
      globalCounter++
      return `
      <tr style="border-bottom:1px solid #f0ece6;">
        <td style="width:28px;padding:6px 4px;text-align:center;
          font-family:monospace;font-size:10px;color:#3a3530;">${globalCounter}</td>
        <td style="padding:6px 8px;font-size:10px;color:#3a3530;
          line-height:1.5;">${item.item_description || '-'}</td>
        <td style="width:44px;padding:6px 4px;text-align:center;
          font-size:10px;color:#3a3530;">${item.qty ?? '-'}</td>
        <td style="width:44px;padding:6px 4px;text-align:center;
          font-size:10px;color:#3a3530;">${item.unit || '-'}</td>
        <td style="width:80px;padding:6px 8px;font-size:10px;
          color:#3a3530;">${item.trade || '-'}</td>
      </tr>`
    }).join('')

    return roomHeaderHtml + rowsHtml
  }).join('')

  const conditions = [
    'Works will be carried out by tradespeople engaged by IRC. All works are covered by a workmanship warranty from date of completion as stipulated by general consumer laws and the Building Services (Complaint Resolution and Administration) Act.',
    'The scope above reflects works approved by your insurer. Any additional works identified on site will be referred back to your insurer for approval before proceeding.',
    'Access to the property must be provided at agreed times. To avoid rescheduling delays, please ensure access can be obtained at those agreed times.',
    'Your policy excess (if applicable) is payable directly to IRC upon completion of works. IRC will issue a tax invoice for this amount.',
    'Matching of existing materials (tiles, paint, flooring) is not guaranteed. IRC will make every reasonable effort to match existing finishes.',
  ]

  const conditionsHtml = conditions.map((text, idx) => `
  <div style="display:flex;gap:8px;font-size:10px;color:#3a3530;line-height:1.65;
    margin-bottom:${idx < 4 ? '6px' : '0'};">
    <span style="color:#b0a89e;font-family:monospace;flex-shrink:0;">${idx + 1}.</span>
    <span>${text}</span>
  </div>`).join('')

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
      <div style="font-size:6.5px;letter-spacing:1.8px;text-transform:uppercase;
        color:#9e998f;font-weight:700;white-space:nowrap;margin-top:4px;">
        INSURANCE REPAIR CO
      </div>
    </div>
    <div style="flex:1;padding:14px 16px;border-right:1px solid #e0dbd4;">
      <div style="font-size:11.5px;letter-spacing:1.5px;text-transform:uppercase;
        color:#b0a89e;font-weight:700;margin-bottom:7px;">JOB DETAILS</div>
      ${job.insured_name ? `<div style="font-size:16px;font-weight:600;color:#1a1a1a;
        margin-bottom:2px;">${job.insured_name}</div>` : ''}
      ${job.property_address ? `<div style="font-size:13px;color:#9e998f;
        margin-bottom:10px;">${job.property_address}</div>` : ''}
      <div style="display:flex;flex-wrap:wrap;font-size:12px;">
        ${[
          { label: 'Insurer', value: job.insurer },
          { label: 'Claim #', value: job.claim_number },
          { label: 'Adjuster', value: job.adjuster },
          { label: 'Date', value: formatDate(quote.created_at) },
        ].map((field, i, arr) => `
          <span style="padding-right:8px;margin-right:8px;
            border-right:${i < arr.length - 1 ? '1px solid #e0dbd4' : 'none'};">
            <span style="color:#b0a89e;">${field.label}: </span>
            <span style="color:#3a3530;">${field.value || '—'}</span>
          </span>`).join('')}
      </div>
    </div>
    <div style="width:184px;min-width:184px;padding:14px 20px 14px 16px;">
      <div style="font-size:11.5px;letter-spacing:1.5px;text-transform:uppercase;
        color:#b0a89e;font-weight:700;margin-bottom:7px;">CONTACT</div>
      <div style="font-size:14px;font-weight:600;color:#1a1a1a;margin-bottom:3px;">
        Kyle Bindon</div>
      <div style="font-size:12px;color:#9e998f;margin-bottom:2px;">
        kyle@insurancerepairco.com.au</div>
      <div style="font-size:12px;color:#9e998f;margin-bottom:2px;">0431 132 077</div>
      <div style="display:flex;gap:4px;margin-top:8px;">
        <span style="font-size:9.5px;background:#f5f2ee;color:#6a6460;
          border:1px solid #e0dbd4;border-radius:3px;padding:2px 6px;
          font-weight:700;">BC105884</span>
        <span style="font-size:9.5px;background:#f5f2ee;color:#6a6460;
          border:1px solid #e0dbd4;border-radius:3px;padding:2px 6px;
          font-weight:700;">IICRC Certified</span>
      </div>
    </div>
  </div>

  <!-- FORM BAND -->
  <div style="border-top:1px solid #e0dbd4;border-bottom:1px solid #e0dbd4;
    padding:4px 20px;display:flex;align-items:baseline;position:relative;">
    <span style="font-size:15px;font-weight:700;color:#1a1a1a;font-family:monospace;
      letter-spacing:-0.5px;">${quote.quote_ref}-SOW</span>
    <span style="position:absolute;left:50%;transform:translateX(-50%);
      font-size:16px;font-weight:700;color:#9e998f;text-transform:uppercase;
      letter-spacing:2px;white-space:nowrap;">Scope of Works &amp; Works Authority</span>
  </div>

  <!-- BODY -->
  <div style="padding:14px 20px 0;">

    <!-- Agreement -->
    <div style="margin-bottom:14px;">
      <div style="font-size:11.5px;letter-spacing:1.5px;text-transform:uppercase;
        color:#b0a89e;font-weight:700;margin-bottom:6px;">AGREEMENT</div>
      <p style="font-size:11px;color:#3a3530;line-height:1.7;margin-bottom:12px;">
        Insurance Repair Co Pty Ltd (ACN 686 067 881, Builder Licence BC105884,
        hereinafter referred to as <strong style="font-weight:600;color:#1a1a1a;">
        &quot;IRC&quot;</strong>) agrees to carry out the repair works described
        below at the property listed above. These works have been approved by your
        insurer in relation to the claim referenced above. This document constitutes
        your authority for works to proceed and must be signed prior to commencement.
      </p>
    </div>

    <!-- Key Details -->
    <div style="background:#f5f2ee;border-radius:6px;padding:10px 14px;
      display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
      <div>
        <div style="font-size:9px;letter-spacing:1.2px;text-transform:uppercase;
          color:#b0a89e;font-weight:700;margin-bottom:2px;">
          WORKS COMMENCEMENT &amp; ESTIMATED DURATION</div>
        <div style="font-size:12px;color:#1a1a1a;font-weight:600;">
          Subject to scheduling</div>
      </div>
      <div>
        <div style="font-size:9px;letter-spacing:1.2px;text-transform:uppercase;
          color:#b0a89e;font-weight:700;margin-bottom:2px;">EXCESS PAYABLE TO IRC</div>
        <div style="font-size:12px;color:#1a1a1a;font-weight:600;">${excessValue}</div>
      </div>
    </div>

    <!-- Scope Table -->
    <div style="margin-bottom:0;">
      <div style="font-size:11.5px;letter-spacing:1.5px;text-transform:uppercase;
        color:#b0a89e;font-weight:700;margin-bottom:6px;">APPROVED SCOPE OF WORKS</div>
      <table>
        <thead>
          <tr style="background:#fafaf8;border-bottom:1px solid #e8e4e0;">
            <th style="width:28px;text-align:center;padding:6px 4px;font-size:8px;
              font-weight:600;text-transform:uppercase;letter-spacing:1px;
              color:#b0a89e;">#</th>
            <th style="text-align:left;padding:6px 8px;font-size:8px;font-weight:600;
              text-transform:uppercase;letter-spacing:1px;color:#b0a89e;">
              Description of works</th>
            <th style="width:44px;text-align:center;padding:6px 4px;font-size:8px;
              font-weight:600;text-transform:uppercase;letter-spacing:1px;
              color:#b0a89e;">Qty</th>
            <th style="width:44px;text-align:center;padding:6px 4px;font-size:8px;
              font-weight:600;text-transform:uppercase;letter-spacing:1px;
              color:#b0a89e;">Unit</th>
            <th style="width:80px;text-align:left;padding:6px 8px;font-size:8px;
              font-weight:600;text-transform:uppercase;letter-spacing:1px;
              color:#b0a89e;">Trade</th>
          </tr>
        </thead>
        <tbody>
          ${scopeRowsHtml}
        </tbody>
      </table>
    </div>

    <!-- Conditions -->
    <div style="margin-top:14px;margin-bottom:14px;">
      <div style="font-size:11.5px;letter-spacing:1.5px;text-transform:uppercase;
        color:#b0a89e;font-weight:700;margin-bottom:6px;">CONDITIONS OF WORKS</div>
      <div style="background:#f5f2ee;border-radius:6px;padding:12px 14px;">
        ${conditionsHtml}
      </div>
    </div>

    <!-- Declaration -->
    <div style="border:1px solid #e0dbd4;border-radius:6px;border-left:3px solid #c8b89a;
      padding:10px 14px;margin-bottom:14px;">
      <p style="font-size:10px;color:#6a6460;line-height:1.7;margin:0;">
        By signing below, the owner/occupant confirms they have read and understood
        the scope of works and conditions above, authorise IRC to proceed with the
        approved works, and acknowledge that they have had the opportunity to seek
        independent advice prior to signing.
      </p>
    </div>

    <!-- Signing -->
    <div style="margin-bottom:6px;">
      <div style="font-size:11.5px;letter-spacing:1.5px;text-transform:uppercase;
        color:#b0a89e;font-weight:700;margin-bottom:10px;">
        AUTHORISATION &amp; SIGNATURES</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;
        margin-bottom:20px;">

        <!-- Owner block -->
        <div style="border:1px solid #e0dbd4;border-radius:6px;padding:12px 14px;">
          <div style="font-size:9px;letter-spacing:1.2px;text-transform:uppercase;
            color:#b0a89e;font-weight:700;margin-bottom:3px;">OWNER / INSURED</div>
          <div style="font-size:11px;color:#6a6460;margin-bottom:12px;">
            ${job.insured_name || '—'}</div>
          <div
            data-submitter="Owner / Insured"
            data-field-type="signature"
            data-field-name="Signature"
            data-field-required="true"
            style="border-bottom:1px solid #c8b89a;height:52px;margin-bottom:10px;
              position:relative;">
            <span style="font-size:8px;color:#b0a89e;position:absolute;
              bottom:4px;left:0;">Signature</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div
              data-submitter="Owner / Insured"
              data-field-type="text"
              data-field-name="Full name"
              data-field-required="true"
              style="border-bottom:1px solid #e0dbd4;padding-bottom:14px;">
              <span style="font-size:8px;color:#b0a89e;display:block;">
                Full name (print)</span>
            </div>
            <div
              data-submitter="Owner / Insured"
              data-field-type="date"
              data-field-name="Date"
              data-field-required="true"
              style="border-bottom:1px solid #e0dbd4;padding-bottom:14px;">
              <span style="font-size:8px;color:#b0a89e;display:block;">Date</span>
            </div>
          </div>
        </div>

        <!-- IRC block -->
        <div style="border:1px solid #e0dbd4;border-radius:6px;padding:12px 14px;">
          <div style="font-size:9px;letter-spacing:1.2px;text-transform:uppercase;
            color:#b0a89e;font-weight:700;margin-bottom:3px;">
            BUILDER — INSURANCE REPAIR CO PTY LTD</div>
          <div style="font-size:11px;color:#6a6460;margin-bottom:12px;">
            ACN 686 067 881 · Builder Licence BC105884</div>
          <div style="border-bottom:1px solid #e0dbd4;height:52px;margin-bottom:10px;
            position:relative;">
            <span style="font-size:8px;color:#b0a89e;position:absolute;
              bottom:4px;left:0;">Signature</span>
            <span style="font-size:8px;color:#c8b89a;font-style:italic;
              position:absolute;top:0;left:0;">
              Signed on behalf of IRC — authorised signatory</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div style="border-bottom:1px solid #f0ece6;padding-bottom:14px;">
              <div style="font-size:8px;color:#b0a89e;margin-bottom:2px;">
                Full name (print)</div>
              <div style="font-size:9px;color:#3a3530;">Kyle Bindon</div>
            </div>
            <div style="border-bottom:1px solid #f0ece6;padding-bottom:14px;">
              <div style="font-size:8px;color:#b0a89e;margin-bottom:2px;">Date</div>
              <div style="font-size:9px;color:#3a3530;">${issueDateDisplay}</div>
            </div>
          </div>
        </div>

      </div>
    </div>
  </div>

  <!-- FOOTER -->
  <div style="background:#1a1a1a;padding:9px 16px;display:flex;align-items:center;
    gap:10px;">
    <div style="width:26px;height:26px;border:1.5px solid #c8b89a;border-radius:50%;
      display:flex;align-items:center;justify-content:center;flex-shrink:0;
      font-size:9px;font-weight:800;color:#c8b89a;font-style:italic;">IRC.</div>
    <div>
      <div style="font-size:7.5px;font-weight:700;letter-spacing:1.5px;
        text-transform:uppercase;color:#f5f2ee;">INSURANCE REPAIR CO PTY LTD</div>
      <div style="font-size:10px;color:#c8b89a;">Building &amp; Restoration</div>
    </div>
    <div style="width:1px;height:22px;background:#c8b89a;margin:0 4px;
      flex-shrink:0;"></div>
    <span style="font-size:12px;color:#c8b89a;">BC105884 · IICRC Certified</span>
    <div style="flex:1;"></div>
  </div>

</div>
</body>
</html>`
}
