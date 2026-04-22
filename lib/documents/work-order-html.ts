import type { Database } from '@/lib/supabase/database.types'

type WorkOrder = Database['public']['Tables']['work_orders']['Row']
type Job = Database['public']['Tables']['jobs']['Row']
type Tenant = Database['public']['Tables']['tenants']['Row']
type Trade = Database['public']['Tables']['trades']['Row']
type ScopeItem = Database['public']['Tables']['scope_items']['Row']

export function generateWorkOrderHtml(params: {
  workOrder: WorkOrder
  job: Job
  tenant: Tenant & {
    building_licence_number?: string | null
  }
  trade: Trade | null
  tradeScopeItems: ScopeItem[]
  otherScopeItems: ScopeItem[]
}): string {
  const { workOrder, job, tenant, trade, tradeScopeItems, otherScopeItems } = params

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

  const workTypeDisplay = workOrder.work_type ? 
    workOrder.work_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : '—'
  
  const statusDisplay = workOrder.status ? 
    workOrder.status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : '—'

  // Calculate total from trade's scope items
  const allocatedAmount = tradeScopeItems.reduce((sum, item) => sum + (item.line_total || 0), 0)

  // Group trade scope items by room (similar to SOW layout)
  const tradeGroupedByRoom = tradeScopeItems.reduce((acc, item) => {
    const room = item.room || 'Unassigned'
    if (!acc[room]) acc[room] = []
    acc[room].push(item)
    return acc
  }, {} as Record<string, ScopeItem[]>)

  const tradeSortedRooms = Object.keys(tradeGroupedByRoom).sort((a, b) => a.localeCompare(b))

  // Build trade scope items table HTML with room subheadings
  let globalCounter = 0
  const tradeScopeHtml = tradeSortedRooms.map(room => {
    const roomItems = tradeGroupedByRoom[room]
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
      <td colspan="4" style="padding:4px 12px;background:#f5f2ee;
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
      </tr>`
    }).join('')

    return roomHeaderHtml + rowsHtml
  }).join('')

  // Build other trades scope items table HTML (grouped by trade, then by room)
  const otherTradesMap = new Map<string, ScopeItem[]>()
  otherScopeItems.forEach(item => {
    const tradeKey = item.trade || 'Other'
    if (!otherTradesMap.has(tradeKey)) {
      otherTradesMap.set(tradeKey, [])
    }
    otherTradesMap.get(tradeKey)!.push(item)
  })

  const otherScopeHtml = Array.from(otherTradesMap.entries()).map(([tradeName, items]) => {
    // Group items by room within each trade
    const groupedByRoom = items.reduce((acc, item) => {
      const room = item.room || 'Unassigned'
      if (!acc[room]) acc[room] = []
      acc[room].push(item)
      return acc
    }, {} as Record<string, ScopeItem[]>)

    const sortedRooms = Object.keys(groupedByRoom).sort((a, b) => a.localeCompare(b))

    let roomCounter = 0
    const roomHtml = sortedRooms.map(room => {
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
        <td colspan="3" style="padding:4px 12px;background:#faf8f5;
          border-bottom:1px solid #e8e4e0;border-top:6px solid white;">
          <span style="font-weight:700;color:#6a6560;font-size:11px;
            text-transform:uppercase;">${room}</span>
          ${hasDimensions ? `<span style="font-size:11px;color:#9e998f;
            font-family:monospace;margin-left:8px;">${roomSizeStr}</span>` : ''}
        </td>
      </tr>`

      const rowsHtml = roomItems.map(item => {
        roomCounter++
        return `
        <tr style="border-bottom:1px solid #f0ece6;">
          <td style="width:28px;padding:6px 4px;text-align:center;
            font-family:monospace;font-size:9px;color:#6a6560;">${roomCounter}</td>
          <td style="padding:6px 8px;font-size:9px;color:#6a6560;
            line-height:1.4;">${item.item_description || '-'}</td>
          <td style="width:44px;padding:6px 4px;text-align:center;
            font-size:9px;color:#6a6560;">${item.qty ?? '-'}</td>
        </tr>`
      }).join('')

      return roomHeaderHtml + rowsHtml
    }).join('')

    return `
    <div style="margin-bottom:12px;">
      <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;
        color:#9e998f;margin-bottom:6px;padding-left:8px;border-left:3px solid #c9a96e;">
        ${tradeName}
      </div>
      <table style="margin-bottom:8px;">
        <tbody>
          ${roomHtml}
        </tbody>
      </table>
    </div>
    `
  }).join('')

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
        color:#b0a89e;font-weight:700;margin-bottom:7px;">WORK ORDER DETAILS</div>
      <div style="display:flex;gap:24px;align-items:center;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:11px;color:#9e998f;">Work Order: </span>
          <span style="font-size:14px;font-weight:600;color:#1a1a1a;">
            ${workOrder.work_order_ref || workOrder.id.slice(0, 8).toUpperCase()}</span>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;font-size:12px;margin-top:6px;">
        ${[
          { label: 'Created', value: formatDate(workOrder.created_at) },
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
          { label: 'Job #', value: job.job_number },
          { label: 'Claim #', value: job.claim_number },
          { label: 'Insurer', value: job.insurer },
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
    padding:12px 20px;display:flex;align-items:center;justify-content:center;position:relative;margin-bottom:14px;">
    <span style="font-size:28px;font-weight:700;color:#9e998f;text-transform:uppercase;
      letter-spacing:2px;white-space:nowrap;">WORK ORDER</span>
  </div>

  <!-- BODY -->
  <div style="padding:14px 20px 0;">

    <!-- Trade Details -->
    <div style="margin-bottom:14px;">
      <div style="font-size:11.5px;letter-spacing:1.5px;text-transform:uppercase;
        color:#b0a89e;font-weight:700;margin-bottom:8px;">ASSIGNED TRADE</div>
      <div style="background:#f5f2ee;border-radius:8px;padding:16px;">
        <div style="font-size:18px;color:#1a1a1a;font-weight:700;">
          ${trade?.business_name || trade?.primary_trade || 'Unassigned'}
        </div>
      </div>
    </div>

    <!-- Homeowner Details -->
    <div style="margin-bottom:14px;">
      <div style="font-size:11.5px;letter-spacing:1.5px;text-transform:uppercase;
        color:#b0a89e;font-weight:700;margin-bottom:8px;">HOMEOWNER / SITE CONTACT</div>
      <div style="background:#f5f2ee;border-radius:8px;padding:16px;">
        <div style="display:flex;gap:20px;">
          <div style="flex:1;">
            <div style="font-size:14px;color:#1a1a1a;font-weight:700;margin-bottom:4px;">
              ${job.insured_name || '—'}
            </div>
            <div style="font-size:12px;color:#3a3530;margin-bottom:2px;">
              ${job.property_address ? `Site: ${job.property_address}` : ''}
            </div>
            <div style="font-size:12px;color:#3a3530;margin-bottom:2px;">
              ${job.insured_phone ? `Phone: ${job.insured_phone}` : ''}
            </div>
            <div style="font-size:12px;color:#3a3530;">
              ${job.insured_email ? `Email: ${job.insured_email}` : ''}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Trade Scope Items -->
    <div style="margin-bottom:14px;">
      <div style="font-size:11.5px;letter-spacing:1.5px;text-transform:uppercase;
        color:#b0a89e;font-weight:700;margin-bottom:8px;">YOUR SCOPE OF WORK</div>
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
          </tr>
        </thead>
        <tbody>
          ${tradeScopeHtml || '<tr><td colspan="4" style="padding:12px;text-align:center;color:#9e998f;font-size:11px;">No scope items assigned</td></tr>'}
        </tbody>
      </table>
    </div>

    <!-- Allocated Amount -->
    <div style="margin-bottom:14px;">
      <div style="background:#1a1a1a;border-radius:8px;padding:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;
            color:#c8b89a;font-weight:700;">ALLOCATED AMOUNT</div>
          <div style="font-size:28px;color:#ffffff;font-weight:700;">${fmt(allocatedAmount)}</div>
        </div>
      </div>
    </div>

    <!-- Other Trades Scope (Context) -->
    ${otherScopeItems.length > 0 ? `
    <div style="margin-bottom:14px;">
      <div style="font-size:11.5px;letter-spacing:1.5px;text-transform:uppercase;
        color:#b0a89e;font-weight:700;margin-bottom:8px;">OTHER TRADES ON THIS JOB (FOR CONTEXT)</div>
      <div style="background:#faf8f5;border-radius:8px;padding:14px;border:1px solid #e8e4e0;">
        ${otherScopeHtml}
      </div>
    </div>
    ` : ''}

    <!-- Notes -->
    <div style="margin-bottom:14px;">
      <div style="font-size:11.5px;letter-spacing:1.5px;text-transform:uppercase;
        color:#b0a89e;font-weight:700;margin-bottom:6px;">NOTES</div>
      <div style="background:#f5f2ee;border-radius:6px;padding:12px 14px;">
        <div style="font-size:10px;color:#3a3530;line-height:1.65;white-space:pre-wrap;">
          ${workOrder.notes || 'No additional notes for this work order.'}
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
