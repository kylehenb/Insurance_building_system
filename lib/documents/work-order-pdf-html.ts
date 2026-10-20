import type { Database } from '@/lib/supabase/database.types'
import type { JobContact } from '@/lib/types/contacts'
import { getContactsByRole } from '../contacts/defaults'

// Trade-facing Work Order document, rendered server-side to PDF by
// /api/work-orders/[id]/pdf (see lib/work-orders/work-order-pdf.ts).
//
// PRICING RULE — this document goes to trades. The only dollar figure it may
// show is the work order amount: agreed_amount when set, otherwise the total
// of this work order's own scope items at the quoted price (the same figure the
// Work Orders tab shows in its Override column). Never render rates, other
// trades' amounts, charge_out_amount, trade_cost, markup or margin here.
//
// Every value interpolated into the HTML goes through esc().

type WorkOrder = Database['public']['Tables']['work_orders']['Row']
type WorkOrderVisit = Database['public']['Tables']['work_order_visits']['Row']
type Job = Database['public']['Tables']['jobs']['Row']
type Tenant = Database['public']['Tables']['tenants']['Row']
type Trade = Database['public']['Tables']['trades']['Row']

export interface WorkOrderPdfScopeItem {
  description: string
  qty: number | null
  unit: string | null
  room: string | null
}

export interface WorkOrderPdfRoomDimensions {
  length: number | null
  width: number | null
  height: number | null
}

export interface WorkOrderPdfOtherTradeItem extends WorkOrderPdfScopeItem {
  tradeLabel: string | null
  contractorName: string | null
}

export interface WorkOrderPdfData {
  workOrder: WorkOrder
  job: Job
  tenant: Tenant
  trade: Trade | null
  tradeLabel: string
  visits: WorkOrderVisit[]
  scopeItems: WorkOrderPdfScopeItem[]
  otherTradeItems: WorkOrderPdfOtherTradeItem[]
  roomDimensions: Record<string, WorkOrderPdfRoomDimensions>
  /** agreed_amount if set, else this WO's own items at quoted price. Null hides the amount. */
  workOrderAmount: number | null
  isSent: boolean
  logoDataUri: string | null
  generatedAt: Date
}

const TIME_ZONE = 'Australia/Perth'

const ADDITIONAL_CONTACT_TYPE_LABELS: Record<string, string> = {
  tenant: 'Tenant',
  real_estate: 'Real Estate Agent',
  property_manager: 'Property Manager',
  owner: 'Owner',
  broker: 'Broker',
  other: 'Other Contact',
}

const WORK_TYPE_LABELS: Record<string, string> = {
  repair: 'Repair',
  make_safe: 'Make Safe',
}

export function esc(value: string | number | null | undefined): string {
  if (value == null) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatAbn(abn: string | null): string {
  if (!abn) return ''
  const digits = abn.replace(/\D/g, '')
  if (digits.length !== 11) return abn
  return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`
}

function formatPhone(phone: string | null): string {
  if (!phone) return ''
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10 && digits.startsWith('04')) {
    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`
  }
  if (digits.length === 10 && digits.startsWith('0')) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)} ${digits.slice(6)}`
  }
  return phone
}

// DATE columns ("2026-10-20") are calendar dates — format them in UTC so the
// day never shifts.
function formatDateOnly(date: string | null): string {
  if (!date) return ''
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function formatTimestamp(date: Date): string {
  return date.toLocaleString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TIME_ZONE,
  })
}

function formatCurrency(v: number): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v)
}

function formatQty(qty: number | null): string {
  if (qty == null) return '—'
  return Number.isInteger(qty) ? String(qty) : String(Number(qty.toFixed(2)))
}

// work_orders.notes is a structured JSON blob (item overrides, added items).
// Only a dedicated text_notes field is shown; legacy plain-text notes pass through.
export function getWorkOrderTextNotes(notes: string | null): string {
  if (!notes) return ''
  try {
    const parsed = JSON.parse(notes) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const text = (parsed as Record<string, unknown>).text_notes
      return typeof text === 'string' ? text.trim() : ''
    }
    return ''
  } catch {
    return notes.trim()
  }
}

interface SiteContact {
  label: string
  isInsured: boolean
  name: string
  phone: string
  email: string
}

function resolveSiteContact(job: Job, role: 'primary_site' | 'secondary_site'): SiteContact | null {
  const contacts = Array.isArray(job.contacts) ? (job.contacts as unknown as JobContact[]) : []
  const match = getContactsByRole(contacts.filter(c => Array.isArray(c.roles)), role)[0]

  if (match) {
    const isInsured = match.slot === 'insured'
    return {
      label: isInsured
        ? 'Homeowner / Insured'
        : (match.type && ADDITIONAL_CONTACT_TYPE_LABELS[match.type]) || 'Site Contact',
      isInsured,
      name: match.name || '',
      phone: match.phone || '',
      email: match.email || '',
    }
  }

  // No structured contacts yet — fall back to the legacy insured fields for the primary slot.
  if (role === 'primary_site' && (job.insured_name || job.insured_phone || job.insured_email)) {
    return {
      label: 'Homeowner / Insured',
      isInsured: true,
      name: job.insured_name || '',
      phone: job.insured_phone || '',
      email: job.insured_email || '',
    }
  }

  return null
}

function visitDate(visit: WorkOrderVisit): string | null {
  return visit.confirmed_date ?? visit.scheduled_date ?? null
}

export function resolveScheduledDate(workOrder: WorkOrder, visits: WorkOrderVisit[]): string | null {
  const dates = visits.map(visitDate).filter((d): d is string => !!d).sort()
  return dates[0] ?? workOrder.scheduled_date ?? null
}

function groupByRoom<T extends { room: string | null }>(items: T[]): Array<[string, T[]]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const room = item.room?.trim() || 'General'
    const list = groups.get(room)
    if (list) list.push(item)
    else groups.set(room, [item])
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b))
}

function roomDimensionsLabel(dims: WorkOrderPdfRoomDimensions | undefined): string {
  if (!dims || (dims.length == null && dims.width == null && dims.height == null)) return ''
  return `${dims.length ?? '—'} × ${dims.width ?? '—'} × ${dims.height ?? '—'} m`
}

function sectionTitle(title: string): string {
  return `<div class="section-title">${esc(title)}</div>`
}

function field(label: string, value: string, opts: { strong?: boolean } = {}): string {
  return `<div class="field"><div class="field-label">${esc(label)}</div><div class="field-value${opts.strong ? ' strong' : ''}">${value || '<span class="muted">—</span>'}</div></div>`
}

function siteContactCard(contact: SiteContact, propertyAddress: string | null): string {
  return `
    <div class="card contact-card">
      ${contact.isInsured
        ? `<div class="field-label">${esc(contact.label)}</div>`
        : `<div class="badge-warn">Not the homeowner — ${esc(contact.label)}</div>`}
      <div class="contact-name">${esc(contact.name) || '—'}</div>
      ${contact.phone ? `<div class="contact-line">Phone: ${esc(formatPhone(contact.phone))}</div>` : ''}
      ${contact.email ? `<div class="contact-line">Email: ${esc(contact.email)}</div>` : ''}
      ${propertyAddress ? `<div class="contact-line">Site: ${esc(propertyAddress)}</div>` : ''}
    </div>`
}

export function generateWorkOrderPdfHtml(data: WorkOrderPdfData): string {
  const {
    workOrder, job, tenant, trade, tradeLabel, visits, scopeItems, otherTradeItems,
    roomDimensions, workOrderAmount, isSent, logoDataUri, generatedAt,
  } = data

  const ref = workOrder.work_order_ref || workOrder.id.slice(0, 8).toUpperCase()
  const companyName = tenant.name || tenant.trading_name || 'Insurance Repair Co Pty Ltd'
  const scheduledDate = resolveScheduledDate(workOrder, visits)
  const workTypeLabel = WORK_TYPE_LABELS[workOrder.work_type ?? ''] ?? (workOrder.work_type || '')
  const textNotes = getWorkOrderTextNotes(workOrder.notes)
  const specialInstructions = job.special_instructions?.trim() || ''

  const primarySite = resolveSiteContact(job, 'primary_site')
  const secondarySite = resolveSiteContact(job, 'secondary_site')

  // ── Scope of works ────────────────────────────────────────────────────────
  let counter = 0
  const scopeRows = groupByRoom(scopeItems).map(([room, items]) => {
    const dims = roomDimensionsLabel(roomDimensions[room])
    return `
      <tr class="room-row"><td colspan="4">
        <span class="room-name">${esc(room)}</span>${dims ? `<span class="room-dims">${esc(dims)}</span>` : ''}
      </td></tr>
      ${items.map(item => {
        counter++
        return `<tr class="item-row">
          <td class="c-num">${counter}</td>
          <td class="c-desc">${esc(item.description) || '—'}</td>
          <td class="c-qty">${esc(formatQty(item.qty))}</td>
          <td class="c-unit">${esc(item.unit) || '—'}</td>
        </tr>`
      }).join('')}`
  }).join('')

  // ── Other trades (context only — descriptions, no pricing) ────────────────
  let otherCounter = 0
  const otherRows = groupByRoom(otherTradeItems).map(([room, items]) => `
      <tr class="room-row other"><td colspan="5"><span class="room-name">${esc(room)}</span></td></tr>
      ${items.map(item => {
        otherCounter++
        return `<tr class="item-row other">
          <td class="c-num">${otherCounter}</td>
          <td class="c-desc">${esc(item.description) || '—'}</td>
          <td class="c-qty">${esc(formatQty(item.qty))}</td>
          <td class="c-trade">${esc(item.tradeLabel) || '—'}</td>
          <td class="c-contractor">${esc(item.contractorName) || '—'}</td>
        </tr>`
      }).join('')}`).join('')

  // ── Visits ────────────────────────────────────────────────────────────────
  const visitRows = visits.map(visit => {
    const date = visitDate(visit)
    const lagParts: string[] = []
    if (visit.lag_days_after && visit.lag_days_after > 0) {
      lagParts.push(`${visit.lag_days_after} day${visit.lag_days_after === 1 ? '' : 's'} before next visit`)
    }
    if (visit.lag_description) lagParts.push(visit.lag_description)
    return `<tr class="item-row">
      <td class="c-num">${esc(visit.visit_number)}</td>
      <td>${date ? esc(formatDateOnly(date)) + (visit.confirmed_date ? ' <span class="pill">Confirmed</span>' : '') : '<span class="muted">To be scheduled</span>'}</td>
      <td class="c-qty">${visit.estimated_hours != null ? esc(formatQty(visit.estimated_hours)) + ' h' : '—'}</td>
      <td>${esc(lagParts.join(' — ')) || '<span class="muted">—</span>'}</td>
    </tr>`
  }).join('')

  const tradeContactLines = [
    trade?.primary_contact ? `Contact: ${esc(trade.primary_contact)}` : '',
    trade?.contact_mobile ? `Mobile: ${esc(formatPhone(trade.contact_mobile))}` : '',
    trade?.contact_office ? `Office: ${esc(formatPhone(trade.contact_office))}` : '',
    trade?.contact_email ? `Email: ${esc(trade.contact_email)}` : '',
  ].filter(Boolean)

  return `<!DOCTYPE html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<title>Work Order ${esc(ref)}</title>
<style>
  @page { size: A4; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #ffffff; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; font-size: 11px; line-height: 1.45;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .doc { padding: 0 14mm; }
  .muted { color: #9e998f; }
  table { border-collapse: collapse; width: 100%; table-layout: fixed; }
  tr { break-inside: avoid; }
  thead { display: table-header-group; }

  .letterhead { display: flex; align-items: center; gap: 16px; padding-bottom: 12px; border-bottom: 2px solid #1a1a1a; }
  .letterhead .logo { width: 120px; flex-shrink: 0; }
  .letterhead .logo img { width: 100%; height: auto; display: block; }
  .letterhead .company { flex: 1; }
  .company-name { font-size: 15px; font-weight: 700; letter-spacing: 0.3px; }
  .company-line { font-size: 10px; color: #3a3530; margin-top: 2px; }
  .doc-title { text-align: right; }
  .doc-title .label { font-size: 22px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #3a3530; }
  .doc-title .ref { font-size: 13px; font-weight: 700; margin-top: 2px; }
  .doc-title .generated { font-size: 9px; color: #9e998f; margin-top: 2px; }

  .draft-banner { margin-top: 10px; background: #fdecea; border: 1px solid #c8302f; color: #c8302f;
    font-weight: 700; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; padding: 6px 10px; border-radius: 4px; text-align: center; }
  .watermark { position: fixed; top: 38%; left: 0; right: 0; text-align: center; transform: rotate(-30deg);
    font-size: 150px; font-weight: 800; color: rgba(200, 48, 47, 0.14); letter-spacing: 12px; z-index: 10; pointer-events: none; }

  .section { margin-top: 14px; }
  .section-title { font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; color: #8a8278; font-weight: 700;
    margin-bottom: 6px; border-bottom: 1px solid #e0dbd4; padding-bottom: 3px; break-after: avoid; }
  .card, .cards { break-inside: avoid; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px 14px; }
  .grid.two { grid-template-columns: 1fr 1fr; }
  .field-label { font-size: 8.5px; letter-spacing: 1px; text-transform: uppercase; color: #9e998f; font-weight: 700; }
  .field-value { font-size: 11px; color: #1a1a1a; margin-top: 1px; }
  .field-value.strong { font-weight: 700; font-size: 12px; }

  .card { background: #f5f2ee; border-radius: 6px; padding: 10px 12px; }
  .cards { display: flex; gap: 10px; }
  .cards .card { flex: 1; }
  .contact-name { font-size: 13px; font-weight: 700; margin: 2px 0 3px; }
  .contact-line { font-size: 10.5px; color: #3a3530; }
  .badge-warn { display: inline-block; background: #c8302f; color: #fff; font-size: 8.5px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.6px; border-radius: 3px; padding: 2px 6px; }
  .trade-name { font-size: 15px; font-weight: 700; }

  th { font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #8a8278;
    text-align: left; padding: 5px 6px; background: #faf8f5; border-bottom: 1px solid #e0dbd4; }
  .room-row td { padding: 5px 6px 4px; background: #f5f2ee; border-top: 5px solid #ffffff; }
  .room-name { font-weight: 700; font-size: 10.5px; text-transform: uppercase; color: #3a3530; }
  .room-dims { font-family: monospace; font-size: 9.5px; color: #9e998f; margin-left: 8px; }
  .item-row td { padding: 5px 6px; border-bottom: 1px solid #f0ece6; vertical-align: top; font-size: 10.5px; color: #3a3530; }
  .item-row.other td, .room-row.other .room-name { font-size: 9.5px; color: #6a6560; }
  .c-num { width: 28px; text-align: center; font-family: monospace; }
  .c-qty, .c-unit { width: 52px; text-align: center; }
  .c-trade { width: 90px; text-transform: uppercase; font-weight: 600; }
  .c-contractor { width: 120px; }
  .pill { display: inline-block; font-size: 8px; font-weight: 700; color: #2d6a4f; background: #eaf4ef;
    border: 1px solid #a7d4bc; border-radius: 8px; padding: 0 5px; margin-left: 4px; }

  .amount { background: #1a1a1a; color: #ffffff; border-radius: 6px; padding: 12px 16px; display: flex;
    justify-content: space-between; align-items: center; break-inside: avoid; }
  .amount .label { font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; color: #c8b89a; font-weight: 700; }
  .amount .value { font-size: 22px; font-weight: 700; }
  .amount .gst { font-size: 11px; color: #c8b89a; font-weight: 600; margin-left: 4px; }

  .notes { white-space: pre-wrap; font-size: 10.5px; color: #3a3530; }
  .notes + .notes { margin-top: 8px; }
</style>
</head>
<body>
${isSent ? '' : '<div class="watermark">DRAFT</div>'}
<div class="doc">

  <div class="letterhead">
    ${logoDataUri ? `<div class="logo"><img src="${esc(logoDataUri)}" alt="${esc(companyName)}"></div>` : ''}
    <div class="company">
      <div class="company-name">${esc(companyName)}</div>
      <div class="company-line">ABN ${esc(formatAbn(tenant.abn)) || '—'}${tenant.building_licence_number ? ` &nbsp;•&nbsp; Builder's Licence ${esc(tenant.building_licence_number)}` : ''}</div>
      ${tenant.address ? `<div class="company-line">${esc(tenant.address)}</div>` : ''}
      <div class="company-line">${[tenant.contact_email ? esc(tenant.contact_email) : '', tenant.contact_phone ? esc(formatPhone(tenant.contact_phone)) : ''].filter(Boolean).join(' &nbsp;•&nbsp; ')}</div>
    </div>
    <div class="doc-title">
      <div class="label">Work Order</div>
      <div class="ref">${esc(ref)}</div>
      <div class="generated">Generated ${esc(formatTimestamp(generatedAt))}</div>
    </div>
  </div>

  ${isSent ? '' : '<div class="draft-banner">Draft — not yet issued to trade</div>'}

  <div class="section">
    ${sectionTitle('Job details')}
    <div class="grid">
      ${field('Work order', esc(ref), { strong: true })}
      ${field('Job number', esc(job.job_number), { strong: true })}
      ${field('Claim number', esc(job.claim_number))}
      ${field('Insurer', esc(job.insurer))}
    </div>
    <div class="grid two" style="margin-top:8px;">
      ${field('Site address', esc(job.property_address), { strong: true })}
      ${field('Scheduled', scheduledDate ? esc(formatDateOnly(scheduledDate)) : 'To be scheduled', { strong: true })}
    </div>
  </div>

  <div class="section">
    ${sectionTitle('Assigned trade')}
    <div class="card">
      <div class="trade-name">${esc(trade?.business_name || trade?.primary_trade || 'Contractor not yet assigned')}</div>
      <div class="grid" style="margin-top:6px;">
        ${field('Trade', esc(tradeLabel))}
        ${field('Work type', esc(workTypeLabel))}
        ${field('ABN', esc(formatAbn(trade?.abn ?? null)))}
        ${field('Visits', esc(workOrder.total_visits ?? (visits.length || 1)))}
      </div>
      ${tradeContactLines.length ? `<div class="contact-line" style="margin-top:6px;">${tradeContactLines.join(' &nbsp;•&nbsp; ')}</div>` : ''}
    </div>
  </div>

  <div class="section">
    ${sectionTitle('Site contact')}
    <div class="cards">
      ${primarySite ? siteContactCard(primarySite, job.property_address) : '<div class="card muted">No site contact on file — call the office before attending.</div>'}
      ${secondarySite ? siteContactCard(secondarySite, null) : ''}
    </div>
  </div>

  <div class="section">
    ${sectionTitle('Access notes & special instructions')}
    <div class="card">
      ${specialInstructions ? `<div class="notes">${esc(specialInstructions)}</div>` : ''}
      ${textNotes ? `<div class="notes">${esc(textNotes)}</div>` : ''}
      ${!specialInstructions && !textNotes ? '<div class="notes muted">No special instructions. Call the site contact before attending to arrange access.</div>' : ''}
    </div>
  </div>

  <div class="section">
    ${sectionTitle('Your scope of works')}
    <table>
      <thead><tr>
        <th class="c-num">#</th><th>Description of works</th><th class="c-qty">Qty</th><th class="c-unit">Unit</th>
      </tr></thead>
      <tbody>
        ${scopeRows || '<tr class="item-row"><td colspan="4" class="muted" style="text-align:center;padding:12px;">No scope items assigned to this work order.</td></tr>'}
      </tbody>
    </table>
  </div>

  ${workOrderAmount != null ? `
  <div class="section">
    <div class="amount">
      <div class="label">Work order amount</div>
      <div><span class="value">${esc(formatCurrency(workOrderAmount))}</span><span class="gst">+ GST</span></div>
    </div>
  </div>` : ''}

  <div class="section">
    ${sectionTitle('Visits')}
    <table>
      <thead><tr>
        <th class="c-num">#</th><th>Date</th><th class="c-qty">Est.</th><th>Follow-up</th>
      </tr></thead>
      <tbody>
        ${visitRows || `<tr class="item-row"><td class="c-num">1</td><td>${scheduledDate ? esc(formatDateOnly(scheduledDate)) : '<span class="muted">To be scheduled</span>'}</td><td class="c-qty">—</td><td><span class="muted">—</span></td></tr>`}
      </tbody>
    </table>
  </div>

  ${otherTradeItems.length > 0 ? `
  <div class="section">
    ${sectionTitle('Other trades on this job (for context)')}
    <table>
      <thead><tr>
        <th class="c-num">#</th><th>Description</th><th class="c-qty">Qty</th><th class="c-trade">Trade</th><th class="c-contractor">Contractor</th>
      </tr></thead>
      <tbody>${otherRows}</tbody>
    </table>
  </div>` : ''}

</div>
</body>
</html>`
}

// Footer printed on every page by Chrome (outside the page body, so it needs
// its own inline styles and an explicit font size).
export function generateWorkOrderPdfFooter(data: Pick<WorkOrderPdfData, 'workOrder' | 'tenant' | 'isSent'>): string {
  const ref = data.workOrder.work_order_ref || data.workOrder.id.slice(0, 8).toUpperCase()
  const company = data.tenant.name || data.tenant.trading_name || 'Insurance Repair Co Pty Ltd'
  return `<div style="width:100%;font-family:Arial,Helvetica,sans-serif;font-size:8px;color:#8a8278;padding:0 14mm;display:flex;justify-content:space-between;">
    <span>${esc(company)} &nbsp;•&nbsp; ${esc(ref)}${data.isSent ? '' : ' &nbsp;•&nbsp; <span style="color:#c8302f;font-weight:700;">DRAFT</span>'}</span>
    <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
  </div>`
}
