import type { SupabaseClient } from '@supabase/supabase-js'
import { activeLessons, formatLessons } from '@/lib/learning/lessons'
import { formatCases, recordLearning, similarCases, type Likeness, type LearningOutcome, type Situation } from '@/lib/learning/events'
import { decodeEntities } from '@/lib/mail/summary'
import type { ActionCard, CardStep } from './cards'

// Action cards on the learning module (tech spec §24): the situation a card
// is made in, what the office did with the AI's proposal (recorded when the
// card is confirmed, skipped or sent back with instructions), and the past
// cases and lessons the AI reads when it makes the next one.

export const FEATURE = 'action_card'

/** Free mail: the domain says nothing about who's writing */
const FREE_MAIL = /^(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me|bigpond|iinet|optusnet|westnet|aol|protonmail)\./i

/** Which facts make two cards alike, and how much */
export const CARD_LIKENESS: Likeness = {
  weights: { sender_email: 4, subject: 3, sender_domain: 2, insurer: 2, stage: 1.5, kind: 1, job_type: 1, loss_type: 0.5, on_job: 0.5 },
  text: ['subject'],
  minScore: 3,
}

type JobFacts = { insurer: string | null; job_type: string | null; current_stage: string | null; loss_type: string | null }

async function jobFacts(db: SupabaseClient, tenantId: string, jobId: string | null): Promise<JobFacts | null> {
  if (!jobId) return null
  const { data } = await db.from('jobs').select('insurer, job_type, current_stage, loss_type').eq('tenant_id', tenantId).eq('id', jobId).maybeSingle()
  return (data as JobFacts | null) ?? null
}

/** The situation of a card: who wrote (or who it's to chase), about what, and the job's insurer and stage */
export async function cardSituation(
  db: SupabaseClient,
  tenantId: string,
  about: { kind: 'email' | 'followup'; sender?: { name: string; email: string } | null; subject: string; jobId: string | null; who?: string | null },
): Promise<Situation> {
  const job = await jobFacts(db, tenantId, about.jobId).catch(() => null)
  const email = about.sender?.email.trim().toLowerCase() || null
  const domain = email?.split('@')[1] ?? null
  return {
    kind: about.kind,
    sender_email: email,
    sender_name: about.sender?.name?.trim() || about.who?.trim() || null,
    sender_domain: domain && !FREE_MAIL.test(domain) ? domain : null,
    subject: about.subject.trim() || null,
    on_job: about.jobId ? 'yes' : 'no',
    insurer: job?.insurer ?? null,
    job_type: job?.job_type ?? null,
    stage: job?.current_stage ?? null,
    loss_type: job?.loss_type ?? null,
  }
}

/** One line saying what the card was about */
export function situationText(s: Situation): string {
  const who = s.sender_name && s.sender_email ? `${s.sender_name} <${s.sender_email}>` : s.sender_email ?? s.sender_name
  const head = s.kind === 'followup' ? `Follow-up the office set${who ? ` (with ${who})` : ''}` : `Email${who ? ` from ${who}` : ''}`
  const job = s.on_job === 'yes'
    ? [s.insurer, s.job_type, s.loss_type, s.stage && `stage: ${s.stage}`].filter(Boolean).join(', ') || 'on a job'
    : 'not on a job'
  return `${head}${s.subject ? ` — "${s.subject}"` : ''} — ${job}`
}

/** What the AI reads before proposing: lessons, then the most alike past cards. '' when there's nothing yet */
export async function cardLearning(db: SupabaseClient, tenantId: string, situation: Situation, cardId: string): Promise<string> {
  const [lessons, cases] = await Promise.all([
    activeLessons(db, tenantId, FEATURE),
    similarCases(db, { tenantId, feature: FEATURE, situation, likeness: CARD_LIKENESS, excludeSourceId: cardId }),
  ])
  return [formatLessons(lessons), formatCases(cases)].filter(Boolean).join('\n\n')
}

// ── What changed ──

/** A step as it's remembered: what it does, and its text for an email */
type StepRecord = { tool: string; summary: string; args: Record<string, unknown> }

const MAX_TEXT = 700
const clip = (s: string, n = MAX_TEXT) => (s.length > n ? `${s.slice(0, n)}…` : s)

/** An edited email's text from its draft: tags out, line breaks kept */
export function htmlText(html: string): string {
  return decodeEntities(html
    .replace(/<(style|script)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** The step as it went: an email edited in the composer goes as its draft */
function asDone(step: CardStep): StepRecord {
  if (step.tool !== 'send_email' || !step.draft) return { tool: step.tool, summary: step.summary, args: step.args }
  const d = step.draft
  return { tool: step.tool, summary: step.summary, args: { ...step.args, to: d.to, cc: d.cc, bcc: d.bcc, subject: d.subject, body: htmlText(d.html) } }
}

const asProposed = (step: CardStep): StepRecord => ({ tool: step.tool, summary: step.summary, args: step.args })

const show = (v: unknown) => {
  if (v === undefined || v === null || v === '') return '(nothing)'
  return clip(typeof v === 'string' ? v : JSON.stringify(v), 200)
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Plain lines for what the office changed on one step */
function stepChanges(proposed: StepRecord, done: StepRecord): string[] {
  const out: string[] = []
  const keys = new Set([...Object.keys(proposed.args), ...Object.keys(done.args)])
  for (const key of keys) {
    const before = proposed.args[key]
    const after = done.args[key]
    if (same(before, after) || ((before ?? '') === '' && (after ?? '') === '')) continue
    if (key === 'body' || key === 'note') {
      out.push(`${proposed.summary}: the office rewrote the ${key === 'body' ? 'email' : 'note'}. What went: "${clip(String(after ?? ''))}"`)
    } else {
      out.push(`${proposed.summary}: ${key.replace(/_/g, ' ')} changed from ${show(before)} to ${show(after)}`)
    }
  }
  return out
}

/** Steps that ran (or are waiting for approval) */
const ran = (s: CardStep) => s.status === 'done' || s.status === 'waiting'

/**
 * Compares the AI's proposal with what was done: one line per change, and
 * the outcome. A step that ran unchanged needs no line.
 */
export function compareCard(aiSteps: CardStep[], steps: CardStep[], ended: 'confirmed' | 'skipped'): { changes: string[]; outcome: LearningOutcome } {
  const changes: string[] = []
  const now = new Map(steps.map(s => [s.id, s]))
  const proposedIds = new Set(aiSteps.map(s => s.id))
  for (const p of aiSteps) {
    const s = now.get(p.id)
    if (!s || !ran(s)) {
      changes.push(`Dropped: ${p.summary}`)
      continue
    }
    changes.push(...stepChanges(asProposed(p), asDone(s)))
  }
  for (const s of steps) {
    if (proposedIds.has(s.id) || !ran(s)) continue
    const done = asDone(s)
    const text = typeof done.args.body === 'string' ? done.args.body : typeof done.args.note === 'string' ? done.args.note : ''
    changes.push(`Added: ${s.summary}${text ? `. What went: "${clip(text)}"` : ''}`)
  }
  const anyRan = steps.some(ran)
  const outcome: LearningOutcome = ended === 'skipped' && !anyRan ? 'skipped' : changes.length ? 'edited' : 'accepted'
  return { changes, outcome }
}

/** The steps that went, as they went */
const records = (steps: CardStep[]) => steps.map(s => ({ ...asDone(s), status: s.status ?? null }))

/**
 * Records what the office did with a card's proposal — when it's done
 * (all its steps run or skipped) or skipped. Cards made before the learning
 * module (no ai_steps) aren't recorded. Never throws.
 */
export async function recordCardDecision(db: SupabaseClient, card: ActionCard, userId: string | null, ended: 'confirmed' | 'skipped'): Promise<void> {
  if (!card.ai_steps) return
  const { changes, outcome } = compareCard(card.ai_steps, card.steps, ended)
  const situation = card.situation ?? {}
  await recordLearning(db, {
    tenantId: card.tenant_id,
    feature: FEATURE,
    sourceTable: 'action_queue',
    sourceId: card.id,
    situation,
    situationText: situationText(situation),
    proposed: card.ai_steps.map(asProposed),
    final: records(card.steps.filter(ran)),
    changes,
    outcome,
    kind: card.category,
    userId,
  })
}

/** Records the office sending a card (or one step) back with instructions. Never throws */
export async function recordCardInstruction(
  db: SupabaseClient, card: ActionCard, userId: string | null, instruction: string, stepId?: string,
): Promise<void> {
  if (!instruction.trim()) return
  const situation = card.situation ?? {}
  const step = stepId ? card.steps.find(s => s.id === stepId) : undefined
  await recordLearning(db, {
    tenantId: card.tenant_id,
    feature: FEATURE,
    sourceTable: 'action_queue',
    sourceId: card.id,
    situation,
    situationText: situationText(situation),
    proposed: card.steps.map(asProposed),
    changes: step
      ? [`Sent back one step: ${step.summary}`]
      : [`Sent back the whole card: ${card.steps.length ? card.steps.map(s => s.summary).join('; ') : '(no steps)'}`],
    outcome: 'instructed',
    instruction,
    kind: card.category,
    userId,
  })
}
