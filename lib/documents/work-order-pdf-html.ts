import type { Database } from '@/lib/supabase/database.types'
import type { JobContact } from '@/lib/types/contacts'
import { getContactsByRole } from '../contacts/defaults'

// Trade-facing Work Order document, rendered server-side to PDF by
// /api/work-orders/[id]/pdf (see lib/work-orders/work-order-pdf.ts).
//
// Layout follows the original browser-print work order
// (lib/documents/work-order-html.ts) so both documents look the same, with
// additions: DRAFT watermark, scheduled date, visits, trade details and
// special instructions.
//
// PRICING RULE — this document goes to trades. The only dollar figure it may
// show is the allocated amount: agreed_amount when set, otherwise the total
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
  /** @font-face rules for an Arial-metric font (the PDF runtime has no Arial). */
  fontFaceCss?: string | null
  generatedAt: Date
}

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

// Shared label style used for section headings throughout the original layout.
const SECTION_LABEL = 'font-size:11.5px;letter-spacing:1.5px;text-transform:uppercase;color:#b0a89e;font-weight:700;'

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
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function formatGenerated(date: Date): string {
  return date.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Australia/Perth' })
}

function formatCurrency(v: number): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v)
}

function formatQty(qty: number | null): string {
  if (qty == null) return '-'
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
        ? 'Homeowner'
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
      label: 'Homeowner',
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
    const room = item.room?.trim() || 'Unassigned'
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

// "Label: value | Label: value" row used in the header, as in the original.
function inlineFields(fields: Array<{ label: string; value: string }>, fontSize = 12): string {
  const shown = fields.filter(f => f.value)
  return `<div style="display:flex;flex-wrap:wrap;font-size:${fontSize}px;">
    ${shown.map((f, i) => `
      <span style="padding-right:8px;margin-right:8px;border-right:${i < shown.length - 1 ? '1px solid #e0dbd4' : 'none'};">
        <span style="color:#b0a89e;">${esc(f.label)}: </span>
        <span style="color:#3a3530;">${f.value}</span>
      </span>`).join('')}
  </div>`
}

function siteContactCardHtml(contact: SiteContact, propertyAddress: string | null): string {
  return `
    <div style="flex:1;">
      ${!contact.isInsured ? `
      <div style="display:inline-block;background:#c8302f;color:#fff;font-size:9px;
        font-weight:700;text-transform:uppercase;letter-spacing:0.6px;
        border-radius:3px;padding:2px 6px;margin-bottom:5px;">
        Not the homeowner — ${esc(contact.label)}
      </div>
      <br/>` : `
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;
        letter-spacing:0.6px;color:#9e998f;margin-bottom:4px;">${esc(contact.label)}</div>
      `}
      <div style="font-size:14px;color:#1a1a1a;font-weight:700;margin-bottom:4px;">
        ${esc(contact.name) || '—'}
      </div>
      ${propertyAddress ? `<div style="font-size:12px;color:#3a3530;margin-bottom:2px;">Site: ${esc(propertyAddress)}</div>` : ''}
      ${contact.phone ? `<div style="font-size:12px;color:#3a3530;margin-bottom:2px;">Phone: ${esc(formatPhone(contact.phone))}</div>` : ''}
      ${contact.email ? `<div style="font-size:12px;color:#3a3530;">Email: ${esc(contact.email)}</div>` : ''}
    </div>`
}

const TH = 'font-size:8px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#b0a89e;'

export function generateWorkOrderPdfHtml(data: WorkOrderPdfData): string {
  const {
    workOrder, job, tenant, trade, tradeLabel, visits, scopeItems, otherTradeItems,
    roomDimensions, workOrderAmount, isSent, logoDataUri, fontFaceCss, generatedAt,
  } = data

  const ref = workOrder.work_order_ref || workOrder.id.slice(0, 8).toUpperCase()
  const companyName = tenant.trading_name || tenant.name || 'INSURANCE REPAIR CO PTY LTD'
  const legalName = tenant.name || tenant.trading_name || 'INSURANCE REPAIR CO PTY LTD'
  const scheduledDate = resolveScheduledDate(workOrder, visits)
  const workTypeLabel = WORK_TYPE_LABELS[workOrder.work_type ?? ''] ?? (workOrder.work_type || '')
  const textNotes = getWorkOrderTextNotes(workOrder.notes)
  const specialInstructions = job.special_instructions?.trim() || ''

  const primarySite = resolveSiteContact(job, 'primary_site')
  const secondarySite = resolveSiteContact(job, 'secondary_site')

  // ── Your scope of work ────────────────────────────────────────────────────
  let counter = 0
  const tradeScopeHtml = groupByRoom(scopeItems).map(([room, items]) => {
    const dims = roomDimensionsLabel(roomDimensions[room])
    return `
    <tr>
      <td colspan="4" style="padding:4px 12px;background:#f5f2ee;
        border-bottom:1px solid #e0dbd4;border-top:6px solid white;">
        <span style="font-weight:700;color:#3a3530;font-size:12px;text-transform:uppercase;">${esc(room)}</span>
        ${dims ? `<span style="font-size:12px;color:#9e998f;font-family:monospace;margin-left:8px;">${esc(dims)}</span>` : ''}
      </td>
    </tr>
    ${items.map(item => {
      counter++
      return `
      <tr style="border-bottom:1px solid #f0ece6;">
        <td style="width:28px;padding:6px 4px;text-align:center;font-family:monospace;font-size:10px;color:#3a3530;">${counter}</td>
        <td style="padding:6px 8px;font-size:10px;color:#3a3530;line-height:1.5;">${esc(item.description) || '-'}</td>
        <td style="width:44px;padding:6px 4px;text-align:center;font-size:10px;color:#3a3530;">${esc(formatQty(item.qty))}</td>
        <td style="width:44px;padding:6px 4px;text-align:center;font-size:10px;color:#3a3530;">${esc(item.unit) || '-'}</td>
      </tr>`
    }).join('')}`
  }).join('')

  // ── Other trades (context only — descriptions, no pricing) ────────────────
  let otherCounter = 0
  const otherScopeHtml = groupByRoom(otherTradeItems).map(([room, items]) => {
    const dims = roomDimensionsLabel(roomDimensions[room])
    return `
    <tr>
      <td colspan="5" style="padding:4px 12px;background:#faf8f5;
        border-bottom:1px solid #e8e4e0;border-top:6px solid white;">
        <span style="font-weight:700;color:#6a6560;font-size:11px;text-transform:uppercase;">${esc(room)}</span>
        ${dims ? `<span style="font-size:11px;color:#9e998f;font-family:monospace;margin-left:8px;">${esc(dims)}</span>` : ''}
      </td>
    </tr>
    ${items.map(item => {
      otherCounter++
      return `
      <tr style="border-bottom:1px solid #f0ece6;">
        <td style="width:28px;padding:6px 4px;text-align:center;font-family:monospace;font-size:9px;color:#6a6560;">${otherCounter}</td>
        <td style="padding:6px 8px;font-size:9px;color:#6a6560;line-height:1.4;">${esc(item.description) || '-'}</td>
        <td style="width:44px;padding:6px 4px;text-align:center;font-size:9px;color:#6a6560;">${esc(formatQty(item.qty))}</td>
        <td style="width:70px;padding:6px 4px;text-align:center;font-size:9px;color:#6a6560;font-weight:600;text-transform:uppercase;">${esc(item.tradeLabel) || '—'}</td>
        <td style="width:100px;padding:6px 4px;text-align:center;font-size:9px;color:#6a6560;">${esc(item.contractorName) || '—'}</td>
      </tr>`
    }).join('')}`
  }).join('')

  // ── Visits ────────────────────────────────────────────────────────────────
  const visitRows = (visits.length > 0 ? visits : null)?.map(visit => {
    const date = visitDate(visit)
    const lagParts: string[] = []
    if (visit.lag_days_after && visit.lag_days_after > 0) {
      lagParts.push(`${visit.lag_days_after} day${visit.lag_days_after === 1 ? '' : 's'} before next visit`)
    }
    if (visit.lag_description) lagParts.push(visit.lag_description)
    return { number: String(visit.visit_number), date, confirmed: !!visit.confirmed_date, hours: visit.estimated_hours, lag: lagParts.join(' — ') }
  }) ?? [{ number: '1', date: scheduledDate, confirmed: false, hours: null, lag: '' }]

  const visitsHtml = visitRows.map(v => `
      <tr style="border-bottom:1px solid #f0ece6;">
        <td style="width:28px;padding:6px 4px;text-align:center;font-family:monospace;font-size:10px;color:#3a3530;">${esc(v.number)}</td>
        <td style="padding:6px 8px;font-size:10px;color:#3a3530;">
          ${v.date ? esc(formatDateOnly(v.date)) + (v.confirmed ? ' <span style="font-size:8px;font-weight:700;color:#2d6a4f;">CONFIRMED</span>' : '') : '<span style="color:#9e998f;">To be scheduled</span>'}
        </td>
        <td style="width:70px;padding:6px 4px;text-align:center;font-size:10px;color:#3a3530;">${v.hours != null ? `${esc(formatQty(v.hours))} h` : '-'}</td>
        <td style="padding:6px 8px;font-size:10px;color:#3a3530;">${esc(v.lag) || '-'}</td>
      </tr>`).join('')

  const tradeDetailFields = [
    { label: 'Trade', value: esc(tradeLabel) },
    { label: 'Work type', value: esc(workTypeLabel) },
    { label: 'ABN', value: esc(formatAbn(trade?.abn ?? null)) },
    { label: 'Contact', value: esc(trade?.primary_contact) },
    { label: 'Mobile', value: esc(formatPhone(trade?.contact_mobile ?? null)) },
    { label: 'Office', value: esc(formatPhone(trade?.contact_office ?? null)) },
    { label: 'Email', value: esc(trade?.contact_email) },
  ]

  const notesBlocks = [
    specialInstructions ? `<div style="font-weight:700;color:#3a3530;margin-bottom:2px;">Special instructions / access</div><div>${esc(specialInstructions)}</div>` : '',
    textNotes ? `<div style="font-weight:700;color:#3a3530;margin-bottom:2px;">Work order notes</div><div>${esc(textNotes)}</div>` : '',
  ].filter(Boolean)

  return `<!DOCTYPE html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<title>Work Order ${esc(ref)}</title>
<style>
  ${fontFaceCss ?? ''}
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, 'Liberation Sans', Helvetica, sans-serif; background: white;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  table { border-collapse: collapse; width: 100%; table-layout: fixed; }
  tr { break-inside: avoid; }
  thead { display: table-header-group; }
  .keep { break-inside: avoid; }
  .heading { break-after: avoid; }
  .watermark { position: fixed; top: 40%; left: 0; right: 0; text-align: center; transform: rotate(-30deg);
    font-size: 150px; font-weight: 800; color: rgba(200, 48, 47, 0.14); letter-spacing: 12px; z-index: 10; pointer-events: none; }
</style>
</head>
<body>
${isSent ? '' : '<div class="watermark">DRAFT</div>'}
<div style="max-width:860px;margin:0 auto;background:white;">

  <!-- HEADER -->
  <div style="display:flex;align-items:stretch;background:white;">
    <div style="width:148px;min-width:148px;padding:14px 8px 14px 20px;border-right:1px solid #e0dbd4;">
      ${logoDataUri ? `<img src="${esc(logoDataUri)}" alt="IRC Logo" style="width:100%;height:auto;display:block;margin-bottom:5px;" />` : ''}
      <div style="font-size:6.5px;letter-spacing:1.8px;text-transform:uppercase;color:#9e998f;font-weight:700;white-space:nowrap;">${esc(companyName)}</div>
    </div>
    <div style="flex:1;padding:14px 16px;border-right:1px solid #e0dbd4;">
      <div style="${SECTION_LABEL}margin-bottom:7px;">WORK ORDER DETAILS</div>
      <div style="display:flex;gap:24px;align-items:center;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:11px;color:#9e998f;">Work Order: </span>
          <span style="font-size:14px;font-weight:600;color:#1a1a1a;">${esc(ref)}</span>
        </div>
      </div>
      <div style="margin-top:6px;">
        ${inlineFields([
          { label: 'Generated', value: esc(formatGenerated(generatedAt)) },
          { label: 'Scheduled', value: scheduledDate ? esc(formatDateOnly(scheduledDate)) : 'To be scheduled' },
          { label: 'Visits', value: esc(workOrder.total_visits ?? (visits.length || 1)) },
        ])}
      </div>
      <div style="${SECTION_LABEL}margin-top:12px;margin-bottom:7px;">JOB DETAILS</div>
      ${inlineFields([
        { label: 'Job #', value: esc(job.job_number) },
        { label: 'Claim #', value: esc(job.claim_number) },
        { label: 'Insurer', value: esc(job.insurer) },
      ])}
      ${job.property_address ? `<div style="font-size:12px;margin-top:4px;"><span style="color:#b0a89e;">Site: </span><span style="color:#3a3530;">${esc(job.property_address)}</span></div>` : ''}
    </div>
    <div style="width:200px;min-width:200px;padding:14px 12px 14px 16px;">
      <div style="font-size:9.5px;letter-spacing:1.3px;text-transform:uppercase;color:#b0a89e;font-weight:700;margin-bottom:7px;">${esc(companyName)}</div>
      <div style="font-size:12px;color:#3a3530;margin-bottom:3px;">${esc(tenant.address) || '—'}</div>
      <div style="font-size:11px;color:#3a3530;margin-bottom:3px;overflow-wrap:anywhere;">${esc(tenant.contact_email) || '—'}</div>
      <div style="font-size:12px;color:#3a3530;">${esc(formatPhone(tenant.contact_phone)) || '—'}</div>
    </div>
  </div>

  <!-- FORM BAND -->
  <div style="border-top:1px solid #e0dbd4;border-bottom:1px solid #e0dbd4;padding:12px 20px;display:flex;
    align-items:center;justify-content:center;gap:14px;margin-bottom:14px;">
    <span style="font-size:28px;font-weight:700;color:#9e998f;text-transform:uppercase;letter-spacing:2px;white-space:nowrap;">WORK ORDER</span>
    ${isSent ? '' : `<span style="font-size:12px;font-weight:700;color:#c8302f;border:1.5px solid #c8302f;border-radius:4px;
      padding:3px 8px;letter-spacing:1.5px;text-transform:uppercase;">Draft — not yet issued</span>`}
  </div>

  <!-- BODY -->
  <div style="padding:14px 20px 0;">

    <!-- Trade Details -->
    <div class="keep" style="margin-bottom:14px;">
      <div style="${SECTION_LABEL}margin-bottom:8px;">ASSIGNED TRADE</div>
      <div style="background:#f5f2ee;border-radius:8px;padding:16px;">
        <div style="font-size:18px;color:#1a1a1a;font-weight:700;">
          ${esc(trade?.business_name || trade?.primary_trade) || 'Unassigned'}
        </div>
        <div style="margin-top:6px;">${inlineFields(tradeDetailFields, 11)}</div>
      </div>
    </div>

    <!-- Site Contact(s) -->
    <div class="keep" style="margin-bottom:14px;">
      <div style="${SECTION_LABEL}margin-bottom:8px;">SITE CONTACT</div>
      <div style="background:#f5f2ee;border-radius:8px;padding:16px;">
        <div style="display:flex;gap:20px;">
          ${primarySite ? siteContactCardHtml(primarySite, job.property_address) : `
          <div style="flex:1;font-size:12px;color:#9e998f;">No site contact on file — check with the office before attending.</div>`}
          ${secondarySite ? siteContactCardHtml(secondarySite, null) : ''}
        </div>
      </div>
    </div>

    <!-- Trade Scope Items -->
    <div style="margin-bottom:14px;">
      <div class="heading" style="${SECTION_LABEL}margin-bottom:8px;">YOUR SCOPE OF WORK</div>
      <table>
        <thead>
          <tr style="background:#fafaf8;border-bottom:1px solid #e8e4e0;">
            <th style="width:28px;text-align:center;padding:6px 4px;${TH}">#</th>
            <th style="text-align:left;padding:6px 8px;${TH}">Description of works</th>
            <th style="width:44px;text-align:center;padding:6px 4px;${TH}">Qty</th>
            <th style="width:44px;text-align:center;padding:6px 4px;${TH}">Unit</th>
          </tr>
        </thead>
        <tbody>
          ${tradeScopeHtml || '<tr><td colspan="4" style="padding:12px;text-align:center;color:#9e998f;font-size:11px;">No scope items assigned</td></tr>'}
        </tbody>
      </table>
    </div>

    ${workOrderAmount != null ? `
    <!-- Allocated Amount -->
    <div class="keep" style="margin-bottom:14px;">
      <div style="background:#1a1a1a;border-radius:8px;padding:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#c8b89a;font-weight:700;">ALLOCATED AMOUNT</div>
          <div style="display:flex;align-items:baseline;gap:6px;">
            <div style="font-size:28px;color:#ffffff;font-weight:700;">${esc(formatCurrency(workOrderAmount))}</div>
            <div style="font-size:14px;color:#c8b89a;font-weight:600;">+ GST</div>
          </div>
        </div>
      </div>
    </div>` : ''}

    <!-- Visits -->
    <div class="keep" style="margin-bottom:14px;">
      <div class="heading" style="${SECTION_LABEL}margin-bottom:8px;">VISITS</div>
      <table>
        <thead>
          <tr style="background:#fafaf8;border-bottom:1px solid #e8e4e0;">
            <th style="width:28px;text-align:center;padding:6px 4px;${TH}">#</th>
            <th style="text-align:left;padding:6px 8px;${TH}">Date</th>
            <th style="width:70px;text-align:center;padding:6px 4px;${TH}">Est. hours</th>
            <th style="text-align:left;padding:6px 8px;${TH}">Follow-up</th>
          </tr>
        </thead>
        <tbody>${visitsHtml}</tbody>
      </table>
    </div>

    ${otherTradeItems.length > 0 ? `
    <!-- Other Trades Scope (Context) -->
    <div style="margin-bottom:14px;">
      <div class="heading" style="${SECTION_LABEL}margin-bottom:8px;">OTHER TRADES ON THIS JOB (FOR CONTEXT)</div>
      <div style="background:#faf8f5;border-radius:8px;padding:14px;border:1px solid #e8e4e0;">
        <table>
          <thead>
            <tr style="background:#f5f2ee;border-bottom:1px solid #e0dbd4;">
              <th style="width:28px;text-align:center;padding:6px 4px;${TH}color:#9e998f;">#</th>
              <th style="text-align:left;padding:6px 8px;${TH}color:#9e998f;">Description</th>
              <th style="width:44px;text-align:center;padding:6px 4px;${TH}color:#9e998f;">Qty</th>
              <th style="width:70px;text-align:center;padding:6px 4px;${TH}color:#9e998f;">Trade</th>
              <th style="width:100px;text-align:center;padding:6px 4px;${TH}color:#9e998f;">Contractor</th>
            </tr>
          </thead>
          <tbody>${otherScopeHtml}</tbody>
        </table>
      </div>
    </div>` : ''}

    <!-- Notes -->
    <div class="keep" style="margin-bottom:14px;">
      <div style="${SECTION_LABEL}margin-bottom:6px;">NOTES</div>
      <div style="background:#f5f2ee;border-radius:6px;padding:12px 14px;">
        <div style="font-size:10px;color:#3a3530;line-height:1.65;white-space:pre-wrap;">${notesBlocks.length
          ? notesBlocks.join('<div style="height:8px;"></div>')
          : 'No additional notes for this work order.'}</div>
      </div>
    </div>

  </div>

  <!-- FOOTER -->
  <div class="keep" style="background:#1a1a1a;padding:9px 16px;display:flex;align-items:center;gap:10px;">
    ${logoDataUri ? `
    <img src="${esc(logoDataUri)}" alt="" style="width:26px;height:26px;object-fit:contain;flex-shrink:0;" />` : `
    <div style="width:26px;height:26px;border:1.5px solid #c8b89a;border-radius:50%;display:flex;align-items:center;
      justify-content:center;flex-shrink:0;font-size:9px;font-weight:800;color:#c8b89a;font-style:italic;">IRC.</div>`}
    <div>
      <div style="font-size:7.5px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#f5f2ee;">${esc(companyName)}</div>
      <div style="font-size:10px;color:#c8b89a;">Building &amp; Restoration</div>
    </div>
    <div style="width:1px;height:22px;background:#c8b89a;margin:0 4px;flex-shrink:0;"></div>
    <span style="font-size:12px;color:#c8b89a;">${esc(legalName.toUpperCase())} • ABN ${esc(formatAbn(tenant.abn)) || '—'}${tenant.building_licence_number ? ` • BUILDERS LIC. ${esc(tenant.building_licence_number)}` : ''}</span>
    <div style="flex:1;"></div>
  </div>

</div>
</body>
</html>`
}
