import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { refreshAutoConfirmSuggestions } from './auto-confirm'
import type { LearningEvent } from './events'

// The nightly review (tech spec §24.5): a stronger model reads a feature's
// new decisions — the untouched ones too — beside the earlier ones and the
// current lessons, and keeps the lessons: new ones only for patterns seen
// more than once (or an instruction it judges general), scoped as narrowly
// as the evidence shows; a track record for each; a narrower situation when
// one is contradicted; retired when it stops holding up. The code below
// enforces those rules whatever the model says. Nobody approves anything.

export const REVIEW_MODEL = process.env.LEARNING_REVIEW_MODEL || 'claude-opus-5-5'

/** How far back earlier cases are read, and how many at most */
const LOOK_BACK_DAYS = 90
const MAX_EARLIER = 150
/** New decisions read in one review (the rest wait for the next) */
const MAX_NEW = 150
/** A lesson goes when it's been contradicted at least this often, and more often than borne out */
const RETIRE_AFTER = 2

export type ReviewResult = {
  feature: string
  reviewed: number
  added: number
  supported: number
  contradicted: number
  refined: number
  retired: number
  skipped?: string
}

type LessonRow = {
  id: string
  applies_when: string
  lesson: string
  status: 'active' | 'retired'
  source: string
  support_count: number
  contradict_count: number
  evidence_ids: string[]
  retired_reason: string | null
}

type Ref = { lesson: string; cases: string[] }
type Decisions = {
  support: Ref[]
  contradict: Ref[]
  refine: { lesson: string; applies_when: string; lesson_text: string; cases: string[] }[]
  add: { applies_when: string; lesson: string; cases: string[] }[]
  retire: { lesson: string; why: string }[]
}

const refs = { type: 'array', items: { type: 'string' } }
const DECISIONS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['support', 'contradict', 'refine', 'add', 'retire'],
  properties: {
    support: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['lesson', 'cases'], properties: { lesson: { type: 'string' }, cases: refs } } },
    contradict: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['lesson', 'cases'], properties: { lesson: { type: 'string' }, cases: refs } } },
    refine: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['lesson', 'applies_when', 'lesson_text', 'cases'], properties: { lesson: { type: 'string' }, applies_when: { type: 'string' }, lesson_text: { type: 'string' }, cases: refs } },
    },
    add: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['applies_when', 'lesson', 'cases'], properties: { applies_when: { type: 'string' }, lesson: { type: 'string' }, cases: refs } } },
    retire: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['lesson', 'why'], properties: { lesson: { type: 'string' }, why: { type: 'string' } } } },
  },
}

export const REVIEW_SYSTEM_PROMPT = `You keep the lessons an AI feature in IRC Master learns from the office of Insurance Repair Co (building insurance repairs in Perth). The feature proposes things — action_card: the next steps for an email (replies, filing, notes, follow-ups); order_parse: the fields read from an insurer's order email; report: the written sections of an assessment report; photo_labels: the captions on a report's photos; waiting_on: when to chase someone the office emailed asking for something (a move, a cancel, or a reply before the chase is the signal) — and a person then confirms the proposal as it was, changes it, skips it, or sends it back with instructions. Each of those decisions is a case, with the situation it was in.

You get the current lessons (L1, L2…), the NEW cases since the last review (N1, N2…) and EARLIER cases for context (E1, E2…). Decide:
- support: a lesson that a NEW case bore out (the situation matched and the office did what it says, or confirmed a proposal that followed it).
- contradict: a lesson that a NEW case went against (the situation matched, but the office did otherwise).
- refine: a lesson whose situation is too broad or too narrow, given the cases (e.g. it says "Allianz emails" but the office only copies the assessor in on Allianz make safes). Give the new applies_when and lesson text, and the cases that show it. When a contradiction is explained by a narrower situation, refine rather than leave it contradicted.
- add: a new lesson, only for a pattern the cases show more than once (cite at least two cases, NEW or EARLIER), or for an instruction the office gave that is plainly general ("always…", "never…", "for X, do Y"), not a one-off. Scope applies_when as narrowly as the cases show — sender, insurer, kind of email, job stage — and broaden only when cases across those differences agree. Don't add what an existing lesson already says (support or refine it instead), and don't re-add a retired lesson unless new cases clearly show it again. A lesson a person turned off ("Turned off by …") stays off: don't add it back in any wording unless several new cases plainly show the office doing it.
- retire: a lesson that is wrong or no longer followed.

A case confirmed as proposed is evidence the proposal was right: it supports lessons the proposal followed. One edit on its own is not a pattern. Write lessons as plain instructions the feature can follow ("Copy in the assessor on the job"); applies_when names the situation ("Replies to Allianz on make safe jobs with an assessor named"). Leave every list empty when nothing calls for a change — that's the usual outcome.`

const day = (iso: string) => iso.slice(0, 10)

function caseLine(ref: string, e: LearningEvent): string {
  return [
    `${ref} (${day(e.created_at)}, ${e.outcome}) ${e.situation_text ?? JSON.stringify(e.situation)}`,
    ...(e.changes ?? []).map(c => `   - ${c}`),
    ...(e.instruction ? [`   Instruction: "${e.instruction}"`] : []),
  ].join('\n')
}

function lessonLine(ref: string, l: LessonRow): string {
  const record = `${l.support_count} for, ${l.contradict_count} against`
  return l.status === 'active'
    ? `${ref} [${record}] When: ${l.applies_when}\n   ${l.lesson.replace(/\n/g, '\n   ')}`
    : `${ref} [RETIRED: ${l.retired_reason ?? 'no reason'}] When: ${l.applies_when}\n   ${l.lesson.replace(/\n/g, '\n   ')}`
}

const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const asList = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : [])
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** The model's answer, read defensively: anything malformed is dropped, not trusted */
export function parseDecisions(text: string): Decisions {
  let raw: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object') raw = parsed as Record<string, unknown>
  } catch {
    throw new Error('The review didn\'t answer in the expected form')
  }
  const refList = (v: unknown) => asList(v).map(r => ({ lesson: str(r.lesson), cases: asStrings(r.cases) })).filter(r => r.lesson)
  return {
    support: refList(raw.support),
    contradict: refList(raw.contradict),
    refine: asList(raw.refine).map(r => ({ lesson: str(r.lesson), applies_when: str(r.applies_when), lesson_text: str(r.lesson_text), cases: asStrings(r.cases) })).filter(r => r.lesson && r.applies_when && r.lesson_text),
    add: asList(raw.add).map(r => ({ applies_when: str(r.applies_when), lesson: str(r.lesson), cases: asStrings(r.cases) })).filter(r => r.applies_when && r.lesson),
    retire: asList(raw.retire).map(r => ({ lesson: str(r.lesson), why: str(r.why) })).filter(r => r.lesson),
  }
}

const EVENT_COLUMNS = 'id, tenant_id, feature, source_table, source_id, situation, situation_text, proposed, final, changes, outcome, instruction, kind, user_id, created_at'

/**
 * Reviews one feature's new decisions for one company and updates its
 * lessons. Nothing new since the last review: no model call. A failure
 * leaves the watermark where it was, so the next run reviews them again.
 */
export async function reviewFeature(
  db: SupabaseClient,
  opts: { tenantId: string; feature: string; client?: Pick<Anthropic, 'beta'>; now?: Date },
): Promise<ReviewResult> {
  const { tenantId, feature } = opts
  const result: ReviewResult = { feature, reviewed: 0, added: 0, supported: 0, contradicted: 0, refined: 0, retired: 0 }
  const now = opts.now ?? new Date()
  const since = new Date(now.getTime() - LOOK_BACK_DAYS * 86_400_000).toISOString()

  const { data: mark } = await db.from('learning_reviews').select('reviewed_to').eq('tenant_id', tenantId).eq('feature', feature).maybeSingle()
  const reviewedTo = (mark as { reviewed_to: string } | null)?.reviewed_to ?? null

  // New: after the watermark (or the whole look-back the first time), oldest first
  let q = db.from('learning_events').select(EVENT_COLUMNS).eq('tenant_id', tenantId).eq('feature', feature)
    .gte('created_at', since).order('created_at', { ascending: true }).limit(MAX_NEW + 1)
  if (reviewedTo) q = q.gt('created_at', reviewedTo)
  const { data: newRows, error: newErr } = await q
  if (newErr) throw new Error(newErr.message)
  const fresh = ((newRows ?? []) as LearningEvent[]).filter(e => !reviewedTo || e.created_at > reviewedTo).slice(0, MAX_NEW)
  if (!fresh.length) return { ...result, skipped: 'Nothing new' }

  // Earlier: the look-back up to the watermark, newest first
  let earlier: LearningEvent[] = []
  if (reviewedTo) {
    const { data } = await db.from('learning_events').select(EVENT_COLUMNS).eq('tenant_id', tenantId).eq('feature', feature)
      .gte('created_at', since).lte('created_at', reviewedTo).order('created_at', { ascending: false }).limit(MAX_EARLIER)
    earlier = ((data ?? []) as LearningEvent[]).filter(e => e.created_at <= reviewedTo).reverse()
  }

  const { data: lessonRows, error: lessonErr } = await db.from('learning_lessons')
    .select('id, applies_when, lesson, status, source, support_count, contradict_count, evidence_ids, retired_reason')
    .eq('tenant_id', tenantId).eq('feature', feature).order('created_at', { ascending: true })
  if (lessonErr) throw new Error(lessonErr.message)
  const lessons = ((lessonRows ?? []) as LessonRow[]).map(l => ({ ...l, evidence_ids: l.evidence_ids ?? [] }))

  // Short references for the model, mapped back here
  const lessonRef = new Map(lessons.map((l, i) => [`L${i + 1}`, l]))
  const caseRef = new Map<string, LearningEvent>([
    ...fresh.map((e, i) => [`N${i + 1}`, e] as const),
    ...earlier.map((e, i) => [`E${i + 1}`, e] as const),
  ])
  const freshIds = new Set(fresh.map(e => e.id))

  const prompt = [
    `Feature: ${feature}`,
    `CURRENT LESSONS\n${lessons.length ? [...lessonRef].map(([r, l]) => lessonLine(r, l)).join('\n') : '(none yet)'}`,
    `NEW CASES (since the last review)\n${fresh.map((e, i) => caseLine(`N${i + 1}`, e)).join('\n')}`,
    `EARLIER CASES (for context)\n${earlier.length ? earlier.map((e, i) => caseLine(`E${i + 1}`, e)).join('\n') : '(none)'}`,
  ].join('\n\n')

  const client = opts.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  // Server-side fallback when a safety check declines (not offered on Haiku)
  const fallback = REVIEW_MODEL.startsWith('claude-haiku') ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }
  const response = await client.beta.messages.create({
    model: REVIEW_MODEL,
    max_tokens: 16000,
    system: REVIEW_SYSTEM_PROMPT,
    output_config: { effort: 'high', format: { type: 'json_schema', schema: DECISIONS_SCHEMA } },
    messages: [{ role: 'user', content: prompt }],
    ...fallback,
  } as Anthropic.Beta.MessageCreateParamsNonStreaming)
  if (response.stop_reason === 'refusal') throw new Error('The review model declined')
  if (response.stop_reason === 'max_tokens') throw new Error('The review was cut short')
  const text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map(b => b.text).join('')
  const decisions = parseDecisions(text)

  const cases = (list: string[]) => [...new Set(list.map(r => caseRef.get(r)).filter((e): e is LearningEvent => !!e))]
  const active = (ref: string) => {
    const l = lessonRef.get(ref)
    return l && l.status === 'active' ? l : undefined
  }
  const changed = new Set<LessonRow>()
  const addEvidence = (l: LessonRow, events: LearningEvent[]) => {
    l.evidence_ids = [...new Set([...l.evidence_ids, ...events.map(e => e.id)])]
  }

  // Track records count NEW cases only, once each
  for (const s of decisions.support) {
    const l = active(s.lesson)
    const evidence = cases(s.cases).filter(e => freshIds.has(e.id) && !l?.evidence_ids.includes(e.id))
    if (!l || !evidence.length) continue
    l.support_count += evidence.length
    addEvidence(l, evidence)
    changed.add(l)
    result.supported++
  }
  for (const c of decisions.contradict) {
    const l = active(c.lesson)
    const evidence = cases(c.cases).filter(e => freshIds.has(e.id) && !l?.evidence_ids.includes(e.id))
    if (!l || !evidence.length) continue
    l.contradict_count += evidence.length
    addEvidence(l, evidence)
    changed.add(l)
    result.contradicted++
  }
  for (const r of decisions.refine) {
    const l = active(r.lesson)
    if (!l || !cases(r.cases).length) continue
    // A narrower (or truer) situation starts its record again from the cases that show it
    const shown = cases(r.cases)
    l.applies_when = r.applies_when
    l.lesson = r.lesson_text
    l.support_count = shown.length
    l.contradict_count = 0
    addEvidence(l, shown)
    changed.add(l)
    result.refined++
  }
  for (const r of decisions.retire) {
    const l = active(r.lesson)
    if (!l) continue
    l.status = 'retired'
    l.retired_reason = r.why || 'No longer followed'
    changed.add(l)
    result.retired++
  }
  // Contradicted more often than borne out: it goes, whatever the model said
  for (const l of lessons) {
    if (l.status === 'active' && l.contradict_count >= RETIRE_AFTER && l.contradict_count > l.support_count) {
      l.status = 'retired'
      l.retired_reason = `Contradicted more often than borne out (${l.contradict_count} against, ${l.support_count} for)`
      changed.add(l)
      result.retired++
    }
  }

  const stamp = now.toISOString()
  for (const l of changed) {
    await db.from('learning_lessons').update({
      applies_when: l.applies_when, lesson: l.lesson, status: l.status, retired_reason: l.retired_reason,
      support_count: l.support_count, contradict_count: l.contradict_count, evidence_ids: l.evidence_ids, updated_at: stamp,
    }).eq('id', l.id).eq('tenant_id', tenantId)
  }

  // New lessons need a pattern: two cases, or one general instruction
  const known = new Set(lessons.filter(l => l.status === 'active').map(l => `${l.applies_when}\n${l.lesson}`.toLowerCase()))
  for (const a of decisions.add) {
    const evidence = cases(a.cases)
    const enough = evidence.length >= 2 || evidence.some(e => e.outcome === 'instructed' && e.instruction)
    const key = `${a.applies_when}\n${a.lesson}`.toLowerCase()
    if (!enough || known.has(key)) continue
    known.add(key)
    await db.from('learning_lessons').insert({
      tenant_id: tenantId, feature, applies_when: a.applies_when, lesson: a.lesson, status: 'active', source: 'learned',
      support_count: evidence.length, contradict_count: 0, evidence_ids: evidence.map(e => e.id),
    })
    result.added++
  }

  result.reviewed = fresh.length
  const usage = { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens }
  const summary = { ...result }
  const reviewed_to = fresh[fresh.length - 1].created_at
  if (mark) {
    await db.from('learning_reviews').update({ reviewed_to, ran_at: stamp, model: response.model, usage, summary }).eq('tenant_id', tenantId).eq('feature', feature)
  } else {
    await db.from('learning_reviews').insert({ tenant_id: tenantId, feature, reviewed_to, ran_at: stamp, model: response.model, usage, summary })
  }
  return result
}

/** Days back the nightly run looks for companies and features with new decisions */
const ACTIVE_DAYS = 14

/** Reviews every company's features that have new decisions (the nightly cron). One failing doesn't stop the rest */
export async function reviewAll(db: SupabaseClient, opts: { client?: Pick<Anthropic, 'beta'>; now?: Date } = {}): Promise<(ReviewResult & { tenantId: string; error?: string; askAutoConfirm?: string[] })[]> {
  const now = opts.now ?? new Date()
  const { data, error } = await db.from('learning_events').select('tenant_id, feature, kind')
    .gte('created_at', new Date(now.getTime() - ACTIVE_DAYS * 86_400_000).toISOString()).limit(10_000)
  if (error) throw new Error(error.message)
  // Each company's features, with the kinds decided on lately
  const pairs = new Map<string, { tenant_id: string; feature: string; kinds: Set<string> }>()
  for (const r of (data ?? []) as { tenant_id: string; feature: string; kind: string | null }[]) {
    const key = `${r.tenant_id}:${r.feature}`
    if (!pairs.has(key)) pairs.set(key, { tenant_id: r.tenant_id, feature: r.feature, kinds: new Set() })
    if (r.kind) pairs.get(key)!.kinds.add(r.kind)
  }
  const out: (ReviewResult & { tenantId: string; error?: string; askAutoConfirm?: string[] })[] = []
  for (const p of pairs.values()) {
    let result: ReviewResult & { tenantId: string; error?: string; askAutoConfirm?: string[] }
    try {
      result = { tenantId: p.tenant_id, ...(await reviewFeature(db, { tenantId: p.tenant_id, feature: p.feature, client: opts.client, now })) }
    } catch (err) {
      console.error(`[learning] review of ${p.feature} for ${p.tenant_id} failed:`, err)
      result = { tenantId: p.tenant_id, feature: p.feature, reviewed: 0, added: 0, supported: 0, contradicted: 0, refined: 0, retired: 0, error: err instanceof Error ? err.message : String(err) }
    }
    // Kinds now confirmed untouched almost every time: ask whether to auto-confirm them
    try {
      const asked = await refreshAutoConfirmSuggestions(db, p.tenant_id, p.feature, [...p.kinds], now)
      if (asked.length) result.askAutoConfirm = asked
    } catch (err) {
      console.error(`[learning] auto-confirm check of ${p.feature} for ${p.tenant_id} failed:`, err)
    }
    out.push(result)
  }
  return out
}

/** When each feature was last reviewed, and what the run did (the "What the AI has learned" page) */
export async function lastReviews(db: SupabaseClient, tenantId: string): Promise<{ feature: string; ran_at: string; summary: ReviewResult | null }[]> {
  const { data } = await db.from('learning_reviews').select('feature, ran_at, summary').eq('tenant_id', tenantId)
  return (data ?? []) as { feature: string; ran_at: string; summary: ReviewResult | null }[]
}
