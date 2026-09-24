import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import Anthropic from '@anthropic-ai/sdk'
import { notifySubmissionFailure } from '@/lib/email/notify-submission-failure'

type ServiceClient = SupabaseClient<Database>

export const dynamic = 'force-dynamic'
export const maxDuration = 120

interface ScopeRoom {
  room: string
  l: string
  w: string
  h: string
  items: string[]
}

interface ScopeItem {
  room: string
  trade: string
  keyword: string
  item_description: string
  qty: number | null
  unit: string
}

interface LibraryItem {
  id: string
  trade: string | null
  keyword: string | null
  item_description: string | null
  unit: string | null
  labour_per_unit: number | null
  materials_per_unit: number | null
  total_per_unit: number | null
  trade_rate_total: number | null
  estimated_hours: number | null
}

const LIBRARY_MATCH_THRESHOLD = 0.55

function normalizeStr(s: string | null | undefined): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()
}

function wordOverlapScore(a: string, b: string): number {
  const ta = new Set(a.split(/\s+/).filter(Boolean))
  const tb = new Set(b.split(/\s+/).filter(Boolean))
  if (ta.size === 0 || tb.size === 0) return 0
  const intersection = [...ta].filter(t => tb.has(t)).length
  return intersection / Math.max(ta.size, tb.size)
}

function computeLibraryMatchScore(parsed: ScopeItem, lib: LibraryItem): number {
  let score = 0
  const pk = normalizeStr(parsed.keyword)
  const lk = normalizeStr(lib.keyword)
  if (pk && lk) {
    if (pk === lk) score += 0.55
    else if (pk.includes(lk) || lk.includes(pk)) score += 0.35
    else score += 0.2 * wordOverlapScore(pk, lk)
  }
  score += 0.3 * wordOverlapScore(normalizeStr(parsed.item_description), normalizeStr(lib.item_description))
  const pt = normalizeStr(parsed.trade)
  const lt = normalizeStr(lib.trade)
  if (pt && lt && pt === lt) score += 0.15
  return score
}

function findBestLibraryMatch(parsed: ScopeItem, library: LibraryItem[]): LibraryItem | null {
  let best: LibraryItem | null = null
  let bestScore = 0
  for (const lib of library) {
    const s = computeLibraryMatchScore(parsed, lib)
    if (s > bestScore) { bestScore = s; best = lib }
  }
  return bestScore >= LIBRARY_MATCH_THRESHOLD ? best : null
}

async function parseScopeWithAI(scopeRooms: ScopeRoom[], jobContext: { insurer: string; lossType: string }, tenantId: string, service: any): Promise<ScopeItem[]> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const scopeText = scopeRooms.map(r => {
    const dims = [r.l, r.w, r.h].filter(Boolean).join('×')
    const dimStr = dims ? ` (${dims}m)` : ''
    const items = r.items.filter(Boolean).map(i => `  - ${i}`).join('\n')
    return `${r.room || 'General'}${dimStr}:\n${items || '  (no items)'}`
  }).join('\n\n')

  // Fetch the scope parsing prompt from the database
  let systemPrompt = `You are a building insurance scope parser. Parse the following field inspection scope notes into structured scope items.

Insurer: {insurer}
Loss Type: {loss_type}

Scope Notes:
{scope_notes}

Return ONLY a valid JSON array with no additional text. Each object must have these exact keys:
- room: room name (string)
- trade: trade type e.g. "Plastering", "Carpentry", "Painting", "Tiling" (string)
- keyword: short item keyword (string)
- item_description: full description of work required (string)
- qty: quantity as a number, or null if not quantifiable
- unit: unit of measure e.g. "m2", "lm", "item", "hr" (string)

Example: [{"room":"Living Room","trade":"Plastering","keyword":"ceiling","item_description":"Replaster damaged ceiling","qty":12,"unit":"m2"}]`
  try {
    const { data: promptData } = await service
      .from('prompts')
      .select('system_prompt')
      .eq('tenant_id', tenantId)
      .eq('key', 'scope_field_parse')
      .single()
    // Only use the DB prompt if it contains the scope_notes placeholder; otherwise the
    // scope text would never be included in the message sent to Claude
    if (promptData?.system_prompt?.includes('{scope_notes}')) {
      systemPrompt = promptData.system_prompt
    }
  } catch (e) {
    console.error('Failed to fetch scope parsing prompt, using default:', e)
  }

  // Replace placeholders in the prompt with actual values
  const prompt = systemPrompt
    .replace('{insurer}', jobContext.insurer || 'Unknown')
    .replace('{loss_type}', jobContext.lossType || 'Unknown')
    .replace('{scope_notes}', scopeText)

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content[0]?.type === 'text' ? message.content[0].text : '[]'
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return []

  try {
    return JSON.parse(match[0]) as ScopeItem[]
  } catch {
    return []
  }
}

async function generateBarReport(opts: {
  service: ServiceClient
  tenantId: string
  inspectionId: string
  resolvedReportId: string | null
  rawReportDump: string
  now: string
}): Promise<void> {
  const { service, tenantId, inspectionId, resolvedReportId, rawReportDump, now } = opts
  if (!resolvedReportId) return

  await service.from('reports').update({
    ...(rawReportDump ? { raw_report_notes: rawReportDump } : {}),
    attendance_date: now.split('T')[0],
  }).eq('id', resolvedReportId).eq('tenant_id', tenantId)

  if (!rawReportDump || !rawReportDump.trim()) return

  let barSystemPrompt = 'You are an expert building insurance assessor writing professional BAR reports.'
  try {
    const { data: pd } = await service
      .from('prompts')
      .select('system_prompt')
      .eq('tenant_id', tenantId)
      .eq('key', 'report_bar')
      .single()
    if (pd?.system_prompt) barSystemPrompt = pd.system_prompt
  } catch { /* use default */ }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const barMsg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: barSystemPrompt,
    messages: [{
      role: 'user',
      content: `Generate a structured BAR report from the following inspection notes. The inspector has dictated everything into a single note — extract all relevant details including who they met and the property description.

Raw Report Notes:
${rawReportDump}

Return ONLY a JSON object with these exact keys (empty string if unknown):
{
  "person_met": "",
  "property_description": "",
  "incident_description": "",
  "cause_of_damage": "",
  "how_damage_occurred": "",
  "resulting_damage": "",
  "pre_existing_conditions": "",
  "maintenance_notes": "",
  "conclusion": ""
}`,
    }],
  })

  const barText = barMsg.content[0]?.type === 'text' ? barMsg.content[0].text : '{}'
  const barMatch = barText.match(/\{[\s\S]*\}/)
  if (!barMatch) throw new Error('BAR report generation: AI response had no parseable JSON')

  const ai = JSON.parse(barMatch[0]) as Record<string, string>
  const updateData: Record<string, unknown> = {
    ...(ai.person_met ? { person_met: ai.person_met } : {}),
    incident_description: ai.incident_description || null,
    cause_of_damage: ai.cause_of_damage || null,
    how_damage_occurred: ai.how_damage_occurred || null,
    resulting_damage: ai.resulting_damage || null,
    pre_existing_conditions: ai.pre_existing_conditions || null,
    maintenance_notes: ai.maintenance_notes || null,
    conclusion: ai.conclusion || null,
  }
  await service.from('reports').update(updateData as any).eq('id', resolvedReportId).eq('tenant_id', tenantId)
  if (ai.person_met) {
    await service.from('inspections').update({ person_met: ai.person_met }).eq('id', inspectionId).eq('tenant_id', tenantId)
  }
}

async function extractPropertyDetails(opts: {
  service: ServiceClient
  tenantId: string
  jobId: string | null
  rawReportDump: string
}): Promise<void> {
  const { service, tenantId, jobId, rawReportDump } = opts
  if (!rawReportDump?.trim() || !jobId) return

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const pdMsg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: `Extract structured property details from the following inspection notes. Return ONLY a JSON object — only include keys where the value can be clearly identified. Omit keys you are uncertain about.

Inspection Notes:
${rawReportDump.trim()}

JSON keys and types:
{
  "building_age": "string e.g. 'Circa 1985' or '~30 years'",
  "condition": "string: 'Good', 'Fair', or 'Poor'",
  "roof_type": "string e.g. 'Concrete tile — hip'",
  "wall_type": "string e.g. 'Brick veneer'",
  "storeys": "string: '1' or '2'",
  "foundation": "string e.g. 'Concrete slab'",
  "fence": "string e.g. 'Colorbond' or 'None'",
  "pool": "boolean",
  "detached_garage": "boolean",
  "granny_flat": "boolean"
}`,
    }],
  })
  const pdText = pdMsg.content[0]?.type === 'text' ? pdMsg.content[0].text : '{}'
  const pdMatch = pdText.match(/\{[\s\S]*\}/)
  if (!pdMatch) return

  const extracted = JSON.parse(pdMatch[0]) as Record<string, unknown>
  if (Object.keys(extracted).length === 0) return

  // Merge with existing property_details so manual edits are not overwritten
  const { data: jobRow } = await service
    .from('jobs')
    .select('property_details')
    .eq('id', jobId)
    .eq('tenant_id', tenantId)
    .single()
  const existing = (jobRow?.property_details as Record<string, unknown>) ?? {}
  await service
    .from('jobs')
    .update({ property_details: { ...existing, ...extracted } as any })
    .eq('id', jobId)
    .eq('tenant_id', tenantId)
}

async function generateRoofReport(opts: {
  service: ServiceClient
  tenantId: string
  inspectionId: string
  jobId: string
  roofRawNotes: string | undefined
  assessorName: string
  now: string
}): Promise<void> {
  const { service, tenantId, inspectionId, jobId, roofRawNotes, assessorName, now } = opts
  if (!roofRawNotes || !roofRawNotes.trim()) return

  const { data: existingRoofReport } = await service
    .from('reports')
    .select('id')
    .eq('inspection_id', inspectionId)
    .eq('report_type', 'roof')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  let roofReportId: string | null = null

  if (existingRoofReport) {
    roofReportId = existingRoofReport.id
  } else {
    const { data: newRoofReport } = await service
      .from('reports')
      .insert({
        tenant_id: tenantId,
        job_id: jobId,
        inspection_id: inspectionId,
        report_type: 'roof',
        status: 'draft',
        raw_report_notes: roofRawNotes,
        attendance_date: now.split('T')[0],
        attendance_time: now.split('T')[1]?.split('.')[0] || null,
        assessor_name: assessorName,
      })
      .select('id')
      .single()
    if (newRoofReport) roofReportId = newRoofReport.id
  }

  if (!roofReportId) throw new Error('Roof report: could not find or create a reports row')

  await service.from('reports').update({ raw_report_notes: roofRawNotes })
    .eq('id', roofReportId).eq('tenant_id', tenantId)

  let roofSystemPrompt = 'You are an expert building insurance roof assessor writing professional roof inspection reports.'
  try {
    const { data: pd } = await service
      .from('prompts')
      .select('system_prompt')
      .eq('tenant_id', tenantId)
      .eq('key', 'report_roof')
      .single()
    if (pd?.system_prompt) roofSystemPrompt = pd.system_prompt
  } catch { /* use default */ }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const roofMsg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: roofSystemPrompt,
    messages: [{
      role: 'user',
      content: `Generate a structured roof inspection report from the following notes.

Raw Notes:
${roofRawNotes}

Return ONLY a JSON object with these exact keys (empty string or null if unknown):
{
  "roof_type": "",
  "roof_general_condition": "",
  "pitch_degrees": null,
  "number_of_penetrations": null,
  "number_of_storeys": "",
  "ridge_hip_condition": "",
  "gutter_condition": "",
  "gutter_overflows": "",
  "roof_insulation": "",
  "specific_cause_of_damage": "",
  "internal_damage": "",
  "roof_damage": "",
  "damage_caused_by_maintenance": "",
  "non_claim_maintenance_issues": "",
  "maintenance_repairs_required": "",
  "conditions_preventing_repairs": "",
  "prior_repairs": "",
  "conclusion": ""
}`,
    }],
  })

  const roofText = roofMsg.content[0]?.type === 'text' ? roofMsg.content[0].text : '{}'
  const roofMatch = roofText.match(/\{[\s\S]*\}/)
  if (!roofMatch) throw new Error('Roof report generation: AI response had no parseable JSON')

  const ai = JSON.parse(roofMatch[0]) as Record<string, unknown>
  const tsFields: Record<string, unknown> = {}
  const roofFields = ['roof_type', 'roof_general_condition', 'pitch_degrees', 'number_of_penetrations',
    'number_of_storeys', 'ridge_hip_condition', 'gutter_condition', 'gutter_overflows', 'roof_insulation',
    'specific_cause_of_damage', 'internal_damage', 'roof_damage', 'damage_caused_by_maintenance',
    'non_claim_maintenance_issues', 'maintenance_repairs_required', 'conditions_preventing_repairs',
    'prior_repairs', 'conclusion']
  for (const f of roofFields) {
    if (ai[f] !== undefined && ai[f] !== null && ai[f] !== '') tsFields[f] = ai[f]
  }
  if (Object.keys(tsFields).length > 0) {
    await service.from('reports')
      .update({ type_specific_fields: tsFields } as any)
      .eq('id', roofReportId).eq('tenant_id', tenantId)
  }
}

async function parseAndInsertScope(opts: {
  service: ServiceClient
  tenantId: string
  resolvedQuoteId: string | null
  scopeRooms: ScopeRoom[]
  insurer: string
  lossType: string
}): Promise<void> {
  const { service, tenantId, resolvedQuoteId, scopeRooms, insurer, lossType } = opts
  if (!resolvedQuoteId || !scopeRooms || scopeRooms.length === 0) return

  const validRooms = scopeRooms.filter(r => r.items && r.items.some(i => i.trim()))
  if (validRooms.length === 0) return

  let itemsToInsert: ScopeItem[] = await parseScopeWithAI(validRooms, { insurer, lossType }, tenantId, service)

  // Fallback: if AI returned nothing, create basic items directly from scope rooms
  if (itemsToInsert.length === 0) {
    itemsToInsert = validRooms.flatMap(room =>
      room.items.filter(i => i.trim()).map(item => ({
        room: room.room || 'General',
        trade: '',
        keyword: '',
        item_description: item,
        qty: null,
        unit: 'item',
      }))
    )
  }

  if (itemsToInsert.length === 0) return

  const { data: maxSort } = await service
    .from('scope_items')
    .select('sort_order')
    .eq('quote_id', resolvedQuoteId)
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  let sortOrder = (maxSort?.sort_order ?? 0) + 1

  // Fetch scope library for auto-matching
  const { data: libData } = await service
    .from('scope_library')
    .select('id, trade, keyword, item_description, unit, labour_per_unit, materials_per_unit, total_per_unit, trade_rate_total, estimated_hours')
    .eq('tenant_id', tenantId)
    .neq('approval_status', 'archived')
  const library: LibraryItem[] = libData ?? []

  const inserts = itemsToInsert.map(item => {
    const match = library.length > 0 ? findBestLibraryMatch(item, library) : null
    return {
      tenant_id: tenantId,
      quote_id: resolvedQuoteId as string,
      room: item.room || null,
      trade: item.trade || null,
      keyword: item.keyword || null,
      item_description: item.item_description || null,
      qty: item.qty ?? null,
      unit: match?.unit || item.unit || null,
      is_custom: !match,
      approval_status: 'pending',
      sort_order: sortOrder++,
      ...(match ? {
        scope_library_id: match.id,
        rate_labour: match.labour_per_unit,
        rate_materials: match.materials_per_unit,
        rate_total: match.total_per_unit,
        trade_rate_total: match.trade_rate_total,
        estimated_hours: match.estimated_hours,
      } : {}),
    }
  })

  const { error: insertErr } = await service.from('scope_items').insert(inserts)
  if (insertErr) throw new Error(`Scope items insert failed: ${insertErr.message}`)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ inspectionId: string }> }
) {
  const { inspectionId } = await params
  const body = await req.json()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient()
  const { data: userRow } = await service
    .from('users')
    .select('tenant_id, name')
    .eq('id', user.id)
    .single()
  if (!userRow) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const tenantId = userRow.tenant_id

  const { data: insp } = await service
    .from('inspections')
    .select('id, job_id, quote_id, report_id, status')
    .eq('id', inspectionId)
    .eq('tenant_id', tenantId)
    .single()
  if (!insp) return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })

  // Resolve quote_id — inspection may not have it set (e.g. non-lodge flow), fall back to job's active quote
  let resolvedQuoteId: string | null = insp.quote_id ?? null
  if (!resolvedQuoteId && insp.job_id) {
    const { data: activeQuote } = await service
      .from('quotes')
      .select('id')
      .eq('job_id', insp.job_id)
      .eq('tenant_id', tenantId)
      .eq('is_active_version', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    resolvedQuoteId = activeQuote?.id ?? null
  }

  // Resolve report_id — fall back to the job's latest BAR/storm_wind report
  let resolvedReportId: string | null = insp.report_id ?? null
  if (!resolvedReportId && insp.job_id) {
    const { data: activeReport } = await service
      .from('reports')
      .select('id')
      .eq('job_id', insp.job_id)
      .eq('tenant_id', tenantId)
      .in('report_type', ['BAR', 'storm_wind'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    resolvedReportId = activeReport?.id ?? null
  }

  const {
    personMet,
    safetyData,
    scopeRooms,
    rawReportDump,
    insurer,
    lossType,
    roofRawNotes,
  }: {
    personMet: string
    safetyData: {
      general: boolean
      ppe: boolean
      asbestos: boolean
      structural: boolean
      roofPower: boolean
      weather: boolean
      customNotes: string
      hospitalName: string
      signedBy: string
    }
    scopeRooms: ScopeRoom[]
    rawReportDump: string
    propDesc: string
    photoContext: string
    insurer: string
    lossType: string
    roofRawNotes?: string
    roofPhotoContext?: string
  } = body

  const now = new Date().toISOString()

  // 1. Save safety record
  await service.from('safety_records').insert({
    tenant_id: tenantId,
    job_id: insp.job_id,
    inspection_id: inspectionId,
    inspector_id: user.id,
    date: now.split('T')[0],
    confirmed_at: now,
    structural_ok: safetyData?.structural ?? false,
    ppe_confirmed: safetyData?.ppe ?? false,
    asbestos_risk: !(safetyData?.asbestos ?? false),
    roof_access: safetyData?.roofPower ?? false,
    nearest_hospital: safetyData?.hospitalName ?? null,
    custom_notes: safetyData?.customNotes ?? null,
    signed_by: safetyData?.signedBy ?? personMet ?? null,
    status: 'confirmed',
    type: 'field_inspection',
  })

  // 2. Update inspection record — keep field_draft as the submitted snapshot (cleared just before this by the client).
  // submission_status starts 'processing': the AI/report pipeline below finishes in the background after this
  // request already responded, so the office/inspector aren't stuck waiting on it.
  await service.from('inspections').update({
    status: 'submitted',
    form_submitted_at: now,
    safety_confirmed_at: safetyData ? now : null,
    person_met: personMet ?? null,
    raw_report_notes: rawReportDump ?? null,
    submission_status: 'processing',
    submission_error: null,
  }).eq('id', inspectionId).eq('tenant_id', tenantId)

  // Everything below is independent per-block (each reads only from the request body/DB and writes to its
  // own table), so it runs in parallel after the response has already been sent to the client.
  after(async () => {
    const results = await Promise.allSettled([
      generateBarReport({ service, tenantId, inspectionId, resolvedReportId, rawReportDump, now }),
      extractPropertyDetails({ service, tenantId, jobId: insp.job_id, rawReportDump }),
      generateRoofReport({ service, tenantId, inspectionId, jobId: insp.job_id, roofRawNotes, assessorName: userRow.name, now }),
      parseAndInsertScope({ service, tenantId, resolvedQuoteId, scopeRooms, insurer, lossType }),
    ])

    const errors: string[] = []
    const labels = ['BAR report generation', 'Property details extraction', 'Roof report generation', 'Scope parsing']
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason)
        console.error(`[submit ${inspectionId}] ${labels[i]} failed:`, r.reason)
        errors.push(`${labels[i]}: ${msg}`)
      }
    })

    await service.from('inspections').update({
      submission_status: errors.length > 0 ? 'failed' : 'completed',
      submission_error: errors.length > 0 ? errors.join('; ') : null,
    }).eq('id', inspectionId).eq('tenant_id', tenantId)

    if (errors.length > 0) {
      await notifySubmissionFailure({ inspectionId, inspectorId: user.id, jobId: insp.job_id, errors })
    }
  })

  return NextResponse.json({
    ok: true,
    submittedAt: now,
    processing: true,
  })
}
