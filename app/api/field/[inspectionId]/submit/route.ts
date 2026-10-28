import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import Anthropic from '@anthropic-ai/sdk'
import { notifySubmissionFailure } from '@/lib/email/notify-submission-failure'
import { getSimilarReportsBlock } from '@/lib/reports/similar-reports'
import { getResponseText } from '@/lib/ai/response-text'
import { attachPendingFieldPhotos, finaliseFieldPhotos, type FieldPhotoManifestEntry } from '@/lib/photos/server-labels'
import { scopeItemTotals } from '@/lib/quotes/service'
import { loadJobInsurer, loadScopeCatalogue } from '@/lib/scope-library/catalogue'
import { buildFieldScopeLines, libraryText, normaliseFieldRooms, notesText, readParsedNotes, type ParsedNote, type ScopeNote } from '@/lib/scope-library/field-scope'
import type { CatalogueItem } from '@/lib/scope-library/pricing'

type ServiceClient = SupabaseClient<Database>

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Model used for every AI step in field submission
const FIELD_AI_MODEL = 'claude-haiku-5-5'

// The field app's scope rooms (items: { text, qty, libraryId }, or plain strings from older clients)
type ScopeRoom = { room: string; l: string; w: string; h: string; items: unknown[] }

const DEFAULT_SCOPE_PARSE_PROMPT = `You are an assistant for an Australian building inspector writing insurance repair scopes.

Turn the inspector's scope notes into quote line items.

INSPECTOR SHORTHAND:
- "rr" = remove and replace (remove, dispose, supply and install); "r/r" or "back" after a fitting = disconnect / reconnect or reinstate
- "strip" = restoration strip-out
- A number at the end of a note is the quantity, unless the inspector entered one separately

SCOPE LIBRARY:
{library}

RULES:
1. If a library item is clearly the same work, match it (its # as libId). Only match the same work — painting is not plastering, a downlight is not an exhaust fan.
2. Otherwise write a new line in the same style and wording as the library items (e.g. "Remove, dispose, supply and install …", "Prepare and paint … in a similar colour and finish to existing.") and use one of the library's trade names.
3. Keep any extra detail the inspector gave (location, size, material) in the new line's wording.`

/**
 * Custom field notes → quote lines with the AI: it sees the scope library
 * (the tenant's scope_field_parse prompt, with {library} / ${libraryText}
 * replaced) and matches a library item or writes a new line in its style.
 */
async function parseScopeNotesWithAI(opts: {
  service: ServiceClient
  tenantId: string
  notes: ScopeNote[]
  catalogue: CatalogueItem[]
  insurer: string
  lossType: string
}): Promise<ParsedNote[]> {
  const { service, tenantId, notes, catalogue, insurer, lossType } = opts
  const { data: promptRow } = await service
    .from('prompts').select('system_prompt').eq('tenant_id', tenantId).eq('key', 'scope_field_parse').maybeSingle()
  const template = promptRow?.system_prompt?.trim() || DEFAULT_SCOPE_PARSE_PROMPT
  const library = libraryText(catalogue)
  const notesBlock = notesText(notes)
  // Function replacements: a "$" in the library's wording stays as written
  let system = template
    .replaceAll('${libraryText}', () => library)
    .replaceAll('{library}', () => library)
    .replaceAll('{insurer}', () => insurer || 'Unknown')
    .replaceAll('{loss_type}', () => lossType || 'Unknown')
    .replaceAll('{scope_notes}', () => notesBlock)
  // A prompt without a library placeholder still gets the library
  if (!template.includes('${libraryText}') && !template.includes('{library}')) system += `\n\nSCOPE LIBRARY:\n${library}`

  const trades = [...new Set(catalogue.map(c => c.trade).filter(Boolean))].sort().join(', ')
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const message = await anthropic.messages.create({
    model: FIELD_AI_MODEL,
    max_tokens: 16000,
    output_config: { effort: 'medium' },
    system,
    messages: [{
      role: 'user',
      content: `Insurer: ${insurer || 'Unknown'}
Loss type: ${lossType || 'Unknown'}
Trade names used in the library: ${trades || 'none yet'}

Scope notes:
${notesBlock}

Return ONLY a JSON array, one object per note, in the same order:
{"note": the note's number, "room": string, "trade": string, "keyword": short camelCase keyword, "qty": number or null, "unit": "m2", "lm", "ea", "hr" or "set", "itemDescription": the line's wording, "confidence": "MATCHED" or "NEW", "libId": the library item's # when MATCHED, else null}
For MATCHED, itemDescription is the library item's wording.`,
    }],
  })

  // A refusal adds the notes as typed, like an unparseable reply
  let text: string
  try { text = getResponseText(message) } catch { return [] }
  return readParsedNotes(text)
}

async function generateBarReport(opts: {
  service: ServiceClient
  tenantId: string
  inspectionId: string
  resolvedReportId: string | null
  rawReportDump: string
  insurer: string
  lossType: string
  now: string
}): Promise<void> {
  const { service, tenantId, inspectionId, resolvedReportId, rawReportDump, insurer, lossType, now } = opts
  if (!resolvedReportId) return

  const { data: reportRow } = await service.from('reports').update({
    ...(rawReportDump ? { raw_report_notes: rawReportDump } : {}),
    attendance_date: now.split('T')[0],
  }).eq('id', resolvedReportId).eq('tenant_id', tenantId).select('report_type').maybeSingle()

  if (!rawReportDump || !rawReportDump.trim()) return

  let barSystemPrompt = 'You are an expert building insurance assessor writing professional BAR reports.'
  const [promptResult, similarReports] = await Promise.all([
    service
      .from('prompts')
      .select('system_prompt')
      .eq('tenant_id', tenantId)
      .eq('key', 'report_bar')
      .maybeSingle(),
    getSimilarReportsBlock({
      service, tenantId, reportType: reportRow?.report_type ?? 'BAR', notes: rawReportDump, lossType, insurer, excludeReportId: resolvedReportId,
    }),
  ])
  if (promptResult.data?.system_prompt) barSystemPrompt = promptResult.data.system_prompt

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const barMsg = await anthropic.messages.create({
    model: FIELD_AI_MODEL,
    max_tokens: 16000,
    output_config: { effort: 'medium' },
    system: [barSystemPrompt, similarReports].filter(Boolean).join('\n\n'),
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

  const barText = getResponseText(barMsg)
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
    model: FIELD_AI_MODEL,
    max_tokens: 4000,
    output_config: { effort: 'low' },
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
  const pdText = getResponseText(pdMsg)
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
  insurer: string
  lossType: string
  now: string
}): Promise<void> {
  const { service, tenantId, inspectionId, jobId, roofRawNotes, assessorName, insurer, lossType, now } = opts
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
  const [promptResult, similarReports] = await Promise.all([
    service
      .from('prompts')
      .select('system_prompt')
      .eq('tenant_id', tenantId)
      .eq('key', 'report_roof')
      .maybeSingle(),
    getSimilarReportsBlock({
      service, tenantId, reportType: 'roof', notes: roofRawNotes, lossType, insurer, excludeReportId: roofReportId,
    }),
  ])
  if (promptResult.data?.system_prompt) roofSystemPrompt = promptResult.data.system_prompt

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const roofMsg = await anthropic.messages.create({
    model: FIELD_AI_MODEL,
    max_tokens: 16000,
    output_config: { effort: 'medium' },
    system: [roofSystemPrompt, similarReports].filter(Boolean).join('\n\n'),
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

  const roofText = getResponseText(roofMsg)
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
  jobId: string | null
  resolvedQuoteId: string | null
  scopeRooms: ScopeRoom[]
  insurer: string
  lossType: string
}): Promise<void> {
  const { service, tenantId, jobId, resolvedQuoteId, insurer, lossType } = opts
  const rooms = normaliseFieldRooms(opts.scopeRooms)
  if (!resolvedQuoteId || rooms.length === 0) return

  // The library this job picks from, at its insurer's prices — the same list the field app searched
  const catalogue = await loadScopeCatalogue(service, tenantId, await loadJobInsurer(service, tenantId, jobId))
  const lines = await buildFieldScopeLines(rooms, catalogue, notes =>
    parseScopeNotesWithAI({ service, tenantId, notes, catalogue, insurer, lossType }))
  if (lines.length === 0) return

  const { data: maxSort } = await service
    .from('scope_items')
    .select('sort_order')
    .eq('quote_id', resolvedQuoteId)
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  let sortOrder = (maxSort?.sort_order ?? 0) + 1
  const inserts = lines.map(line => ({
    ...line,
    tenant_id: tenantId,
    quote_id: resolvedQuoteId,
    approval_status: 'pending',
    sort_order: sortOrder++,
    ...scopeItemTotals(line.qty, line.rate_labour, line.rate_materials),
  }))

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
    photoManifest,
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
      signedBy: string
      /** When the inspector tapped to sign (ISO) */
      signedAt?: string | null
    }
    scopeRooms: ScopeRoom[]
    rawReportDump: string
    propDesc: string
    insurer: string
    lossType: string
    roofRawNotes?: string
    roofPhotoContext?: string
    /** Field photos (already uploaded) in the phone's order, with the inspector's labels */
    photoManifest?: FieldPhotoManifestEntry[]
  } = body

  const now = new Date().toISOString()

  // Signature stamp: signed by the signed-in user (from the session), at the time they tapped to sign.
  // A missing, unreadable or future time falls back to now.
  const signedAtMs = safetyData?.signedAt ? Date.parse(safetyData.signedAt) : NaN
  const signedAt = Number.isFinite(signedAtMs) && signedAtMs <= Date.now() ? new Date(signedAtMs).toISOString() : now
  const signedBy = userRow.name ?? safetyData?.signedBy ?? personMet ?? null

  // 1. Save safety record
  await service.from('safety_records').insert({
    tenant_id: tenantId,
    job_id: insp.job_id,
    inspection_id: inspectionId,
    inspector_id: user.id,
    date: now.split('T')[0],
    confirmed_at: signedAt,
    structural_ok: safetyData?.structural ?? false,
    ppe_confirmed: safetyData?.ppe ?? false,
    asbestos_risk: !(safetyData?.asbestos ?? false),
    roof_access: safetyData?.roofPower ?? false,
    nearest_hospital: null,
    custom_notes: safetyData?.customNotes ?? null,
    signed_by: signedBy,
    signature_data: `Signed electronically by ${signedBy ?? 'inspector'} (user ${user.id}) at ${signedAt}`,
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
      generateBarReport({ service, tenantId, inspectionId, resolvedReportId, rawReportDump, insurer, lossType, now }),
      extractPropertyDetails({ service, tenantId, jobId: insp.job_id, rawReportDump }),
      generateRoofReport({ service, tenantId, inspectionId, jobId: insp.job_id, roofRawNotes, assessorName: userRow.name, insurer, lossType, now }),
      parseAndInsertScope({ service, tenantId, jobId: insp.job_id, resolvedQuoteId, scopeRooms, insurer, lossType }),
      finaliseFieldPhotos({
        service, tenantId, inspectionId, reportId: resolvedReportId,
        manifest: Array.isArray(photoManifest) ? photoManifest : [],
        notes: rawReportDump ?? '', scopeRooms,
      }).catch(async err => {
        await attachPendingFieldPhotos(service, tenantId, inspectionId, resolvedReportId)
        throw err
      }),
    ])

    const errors: string[] = []
    const labels = ['BAR report generation', 'Property details extraction', 'Roof report generation', 'Scope parsing', 'Photo labelling']
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
