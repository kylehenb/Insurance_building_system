// Automatic similar-report lookup for AI report writing.
//
// Each locked report is given a semantic fingerprint (embedding). When a new report is
// written, the inspector's notes are fingerprinted and the closest locked reports of the
// same type are passed to the AI as references for style, structure and detail.
// See supabase/migrations/20261009_report_similarity_search.sql.

import OpenAI from 'openai'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/supabase/database.types'

type ServiceClient = SupabaseClient<Database>

const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_DIMENSIONS = 512 // must match reports.embedding vector(512)
const MAX_FINGERPRINT_CHARS = 8000
const MATCH_COUNT = 3
const MIN_SIMILARITY = 0.3
const MAX_EXAMPLE_FIELD_CHARS = 1200

// Written sections passed to the AI as examples. Identifying details (names, addresses,
// claim numbers, person met, property description) are never included.
const NARRATIVE_FIELDS = [
  'incident_description',
  'cause_of_damage',
  'how_damage_occurred',
  'resulting_damage',
  'pre_existing_conditions',
  'maintenance_notes',
  'conclusion',
] as const

const FINGERPRINT_SELECT =
  'id, tenant_id, report_type, loss_type, raw_report_notes, is_locked, deleted_at, type_specific_fields, ' +
  NARRATIVE_FIELDS.join(', ')

type NarrativeField = (typeof NARRATIVE_FIELDS)[number]

type ReportForFingerprint = {
  id: string
  report_type: string
  loss_type: string | null
  raw_report_notes: string | null
  is_locked: boolean | null
  deleted_at: string | null
  type_specific_fields: Json | null
} & Record<NarrativeField, string | null>

let openaiClient: OpenAI | null = null
function getOpenAI(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null
  // Short timeout so a slow embedding call can never noticeably delay report writing.
  openaiClient ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 8000, maxRetries: 1 })
  return openaiClient
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  const openai = getOpenAI()
  if (!openai) throw new Error('OPENAI_API_KEY is not set')
  const res = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
    dimensions: EMBEDDING_DIMENSIONS,
  })
  return res.data.sort((a, b) => a.index - b.index).map(d => d.embedding)
}

function toVectorLiteral(embedding: number[]): string {
  return JSON.stringify(embedding)
}

function typeSpecificText(fields: Json | null): string[] {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return []
  return Object.entries(fields)
    .filter(([, v]) => v !== null && v !== '' && v !== undefined)
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
}

function buildReportFingerprint(r: ReportForFingerprint): string | null {
  const parts = [
    `Report type: ${r.report_type}`,
    r.loss_type ? `Loss type: ${r.loss_type}` : '',
    r.raw_report_notes?.trim() ? `Inspection notes: ${r.raw_report_notes.trim()}` : '',
    ...NARRATIVE_FIELDS.map(f => (r[f]?.trim() ? `${f.replace(/_/g, ' ')}: ${r[f]!.trim()}` : '')),
    ...typeSpecificText(r.type_specific_fields),
  ].filter(Boolean)
  // Header lines only — nothing worth matching on.
  if (parts.length <= 2) return null
  return parts.join('\n').slice(0, MAX_FINGERPRINT_CHARS)
}

function buildQueryFingerprint(opts: { reportType: string; lossType?: string | null; notes: string }): string {
  return [
    `Report type: ${opts.reportType}`,
    opts.lossType ? `Loss type: ${opts.lossType}` : '',
    `Inspection notes: ${opts.notes.trim()}`,
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_FINGERPRINT_CHARS)
}

/**
 * Fingerprint the given reports (those still locked and not deleted). Embeds in one
 * batched call. Returns how many were written.
 */
export async function indexReports(service: ServiceClient, reportIds: string[]): Promise<number> {
  if (reportIds.length === 0) return 0

  const { data } = await service.from('reports').select(FINGERPRINT_SELECT).in('id', reportIds)
  const reports = ((data ?? []) as unknown as ReportForFingerprint[]).filter(r => r.is_locked && !r.deleted_at)

  const items = reports
    .map(r => ({ id: r.id, text: buildReportFingerprint(r) }))
    .filter((i): i is { id: string; text: string } => !!i.text)
  if (items.length === 0) return 0

  const embeddings = await embedTexts(items.map(i => i.text))
  const now = new Date().toISOString()

  let written = 0
  for (let i = 0; i < items.length; i++) {
    // is_locked guard: skip a report that was unlocked while we were embedding it.
    const { error } = await service
      .from('reports')
      .update({ embedding: toVectorLiteral(embeddings[i]), embedded_at: now })
      .eq('id', items[i].id)
      .eq('is_locked', true)
    if (error) console.error(`[similar-reports] failed to store fingerprint for ${items[i].id}:`, error.message)
    else written++
  }
  return written
}

/** Fingerprint locked reports that don't have one yet (newest first). Used by the cron. */
export async function indexPendingReports(
  service: ServiceClient,
  limit = 100
): Promise<{ pending: number; indexed: number }> {
  const { data } = await service
    .from('reports')
    .select('id')
    .eq('is_locked', true)
    .is('embedding', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)

  const ids = (data ?? []).map(r => r.id)
  const indexed = await indexReports(service, ids)
  return { pending: ids.length, indexed }
}

type ExampleReport = {
  id: string
  report_type: string
  loss_type: string | null
  type_specific_fields: Json | null
} & Record<NarrativeField, string | null>

/**
 * Find the closest locked reports to the given notes and format them as a prompt block.
 * Returns '' when there is nothing close enough, or on any failure — report writing must
 * never fail or stall because of this lookup.
 */
export async function getSimilarReportsBlock(opts: {
  service: ServiceClient
  tenantId: string
  reportType: string
  notes: string
  lossType?: string | null
  insurer?: string | null
  excludeReportId?: string | null
}): Promise<string> {
  const { service, tenantId, reportType, notes, lossType, insurer, excludeReportId } = opts
  if (!notes?.trim() || !getOpenAI()) return ''

  try {
    const [queryEmbedding] = await embedTexts([buildQueryFingerprint({ reportType, lossType, notes })])

    const { data: matches, error } = await service.rpc('match_similar_reports', {
      p_tenant_id: tenantId,
      p_report_type: reportType,
      p_query_embedding: toVectorLiteral(queryEmbedding),
      p_insurer: insurer?.trim() || undefined,
      p_exclude_report_id: excludeReportId || undefined,
      p_match_count: MATCH_COUNT,
      p_min_similarity: MIN_SIMILARITY,
    })
    if (error) throw new Error(error.message)
    if (!matches?.length) return ''

    const { data: rows } = await service
      .from('reports')
      .select('id, report_type, loss_type, type_specific_fields, ' + NARRATIVE_FIELDS.join(', '))
      .in('id', matches.map(m => m.id))
    const byId = new Map(((rows ?? []) as unknown as ExampleReport[]).map(r => [r.id, r]))
    const examples = matches.map(m => byId.get(m.id)).filter((r): r is ExampleReport => !!r)

    return formatExamples(examples)
  } catch (err) {
    console.error('[similar-reports] lookup failed, writing without examples:', err)
    return ''
  }
}

function clip(text: string): string {
  return text.length > MAX_EXAMPLE_FIELD_CHARS ? `${text.slice(0, MAX_EXAMPLE_FIELD_CHARS)}…` : text
}

function formatExamples(examples: ExampleReport[]): string {
  const blocks = examples
    .map((ex, i) => {
      const lines = [
        ...NARRATIVE_FIELDS.filter(f => ex[f]?.trim()).map(f => `- ${f}: ${clip(ex[f]!.trim())}`),
        ...typeSpecificText(ex.type_specific_fields).map(l => `- ${clip(l)}`),
      ]
      if (lines.length === 0) return ''
      return [`Example ${i + 1}${ex.loss_type ? ` (loss type: ${ex.loss_type})` : ''}:`, ...lines].join('\n')
    })
    .filter(Boolean)

  if (blocks.length === 0) return ''

  return [
    'PAST REPORTS FROM SIMILAR JOBS (finalised and locked, most relevant first). Use them only as a reference for writing style, structure, terminology and level of detail:',
    '',
    blocks.join('\n\n'),
    '',
    'Do not copy facts, findings, measurements or wording that is specific to those jobs. Every fact in the new report must come from the current inspection notes.',
  ].join('\n')
}
