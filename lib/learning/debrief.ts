import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { trackAi } from '@/lib/health/ai-usage'
import { recordLearning, type Situation } from './events'
import { OFFICE } from './lessons'

// The debrief (tech spec §24.8): when the office says something about what
// the AI did — while confirming, editing, skipping or sending a card back, or
// "remember this" by voice — a small model turns it into a few takeaways,
// each saying when it applies, and they work from the next proposal on (no
// waiting for the nightly review). The office sees them straight away and
// can reword or delete one. Takeaways about people and the office's house
// style (tone, who to copy in, what never to send) go into the shared office
// memory that everything IRC writes reads; ones about a task stay with it.
// The nightly review (review.ts) keeps them tidy but treats them as the
// office's own words. Nothing said, nothing to debrief: no model call.

export const DEBRIEF_MODEL = process.env.AI_DEBRIEF_MODEL || 'claude-haiku-5-5'
export { OFFICE }
/** Up to ~10 minutes of talking */
export const MAX_SAID = 12000
const MAX_POINTS = 4

export type DebriefPoint = { id: string; lesson: string; applies_when: string; shared: boolean; tone: 'positive' | 'neutral' | 'negative'; replaced?: boolean }

const TAKEAWAYS: Anthropic.Beta.BetaTool = {
  name: 'record_takeaways',
  description: 'Record what to do differently (or keep doing) from now on. Call it once; an empty list when nothing general was said.',
  input_schema: {
    type: 'object',
    properties: {
      points: {
        type: 'array',
        maxItems: MAX_POINTS,
        items: {
          type: 'object',
          properties: {
            lesson: { type: 'string', description: 'A plain instruction to follow next time, in the office\'s spirit: "Keep emails to Dave at Brush Bros casual — first name, no formalities."' },
            applies_when: { type: 'string', description: 'The situation it applies to, as narrow as what was said: "Emails to Dave (Brush Bros)", "Suncorp jobs at the report stage", "Any reply to a homeowner".' },
            shared: { type: 'boolean', description: 'true: about a person, a company or how the office writes and works — it should apply wherever IRC writes or acts (cards, emails by voice, the chat). false: only about this kind of task.' },
            tone: { type: 'string', enum: ['positive', 'neutral', 'negative'], description: 'positive: keep doing this; negative: stop or change; neutral: background to know.' },
            replaces: { type: 'string', description: 'L1, L2… when this updates or corrects one of the CURRENT LESSONS instead of adding a new one.' },
          },
          required: ['lesson', 'applies_when', 'shared', 'tone'],
        },
      },
    },
    required: ['points'],
  },
}

export const DEBRIEF_SYSTEM_PROMPT = `You are the office assistant of Insurance Repair Co (building insurance repairs in Perth), learning how the owner works. The owner has just said something about what IRC did — a proposal it made, a step, an email it drafted — or asked you to remember something. Like a good new employee sitting beside them, take away what to do next time.

- Turn what they said into at most ${MAX_POINTS} short takeaways, each a plain instruction with the situation it applies to. Use their meaning and their words; don't add your own ideas.
- Scope each as narrowly as they said: a person ("Dave at Brush Bros"), a company, an insurer, a kind of job or email, a stage — or everything, if they said "always" or "never" or it's plainly how they work.
- Workflows count: "every time X, also do Y" is a takeaway.
- Praise counts: "that's exactly right because…" is a positive takeaway when it says why.
- shared: true for anything about a person, a company or the office's way of writing and working, so it applies wherever IRC writes or acts; false when it's only about this kind of task.
- If a takeaway updates or corrects one of the CURRENT LESSONS, give its reference in replaces rather than adding a near-duplicate.
- Nothing general (a one-off detail for this job only, chit-chat, thinking aloud): an empty list.`

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/**
 * Turns what the office said into takeaways and saves them as lessons that
 * work at once. Returns what was saved (for the office to see). Never throws:
 * the learning must not get in the way of the work.
 */
export async function debrief(db: SupabaseClient, params: {
  tenantId: string
  userId: string | null
  /** The feature it was said about (action_card…), or OFFICE for "remember this" */
  feature: string
  /** What the AI did and what the office did with it, in plain lines */
  happened: string
  said: string
  situation: Situation
  situationText: string
  /** Record the words as a learning event (false when the caller already has, e.g. a card sent back) */
  recordEvent?: { sourceTable?: string; sourceId?: string; kind?: string | null } | false
  client?: Pick<Anthropic, 'beta'>
}): Promise<DebriefPoint[]> {
  const said = params.said.trim().slice(0, MAX_SAID)
  if (!said) return []
  try {
    if (params.recordEvent !== false) {
      await recordLearning(db, {
        tenantId: params.tenantId, feature: params.feature, sourceTable: params.recordEvent?.sourceTable, sourceId: params.recordEvent?.sourceId,
        situation: params.situation, situationText: params.situationText, changes: [params.happened], outcome: 'instructed', instruction: said,
        kind: params.recordEvent?.kind ?? null, userId: params.userId,
      })
    }
    // What it already knows here, so a correction updates rather than duplicates
    const { data: lessonRows } = await db.from('learning_lessons').select('id, feature, applies_when, lesson')
      .eq('tenant_id', params.tenantId).eq('status', 'active').in('feature', [...new Set([params.feature, OFFICE])])
      .order('updated_at', { ascending: false }).limit(40)
    const lessons = (lessonRows as { id: string; feature: string; applies_when: string; lesson: string }[] | null) ?? []
    const refs = new Map(lessons.map((l, i) => [`L${i + 1}`, l]))

    const prompt = [
      `WHAT IT WAS ABOUT\n${params.situationText}`,
      `WHAT HAPPENED\n${params.happened}`,
      `WHAT THE OWNER SAID\n"${said}"`,
      `CURRENT LESSONS\n${lessons.length ? [...refs].map(([r, l]) => `${r} When: ${l.applies_when} — ${l.lesson}`).join('\n') : '(none)'}`,
    ].join('\n\n')
    const client = params.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await trackAi({ feature: 'learning-debrief', provider: 'anthropic', model: DEBRIEF_MODEL, tenantId: params.tenantId }, () => client.beta.messages.create({
      model: DEBRIEF_MODEL,
      max_tokens: 1500,
      system: DEBRIEF_SYSTEM_PROMPT,
      tools: [TAKEAWAYS],
      tool_choice: { type: 'tool', name: TAKEAWAYS.name },
      messages: [{ role: 'user', content: prompt }],
    } as Anthropic.Beta.MessageCreateParamsNonStreaming))
    const call = response.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && b.name === TAKEAWAYS.name)
    const points = Array.isArray((call?.input as { points?: unknown } | undefined)?.points) ? (call!.input as { points: Record<string, unknown>[] }).points : []

    const saved: DebriefPoint[] = []
    const now = new Date().toISOString()
    for (const p of points.slice(0, MAX_POINTS)) {
      const lesson = str(p.lesson).slice(0, 600)
      const applies = str(p.applies_when).slice(0, 300)
      if (!lesson || !applies) continue
      const shared = p.shared === true
      const tone = (['positive', 'neutral', 'negative'] as const).find(t => t === p.tone) ?? 'neutral'
      const old = refs.get(str(p.replaces))
      if (old) {
        await db.from('learning_lessons').update({ lesson, applies_when: applies, feature: shared ? OFFICE : old.feature, source: 'taught', updated_at: now }).eq('id', old.id).eq('tenant_id', params.tenantId)
        saved.push({ id: old.id, lesson, applies_when: applies, shared, tone, replaced: true })
      } else {
        const { data } = await db.from('learning_lessons').insert({
          tenant_id: params.tenantId, feature: shared ? OFFICE : params.feature, applies_when: applies, lesson, status: 'active', source: 'taught', support_count: 1,
        }).select('id').single()
        if (data) saved.push({ id: (data as { id: string }).id, lesson, applies_when: applies, shared, tone })
      }
    }
    return saved
  } catch (err) {
    console.error('[learning] debrief failed:', err)
    return []
  }
}

/** "Got it: • … • …" for a voice reply; '' when nothing was taken away */
export function spokenTakeaways(points: DebriefPoint[]): string {
  if (!points.length) return ''
  return `Got it — from now on:\n${points.map(p => `• ${p.lesson} (when: ${p.applies_when})${p.replaced ? ' — updated' : ''}`).join('\n')}`
}

/** Rewords a lesson the office taught (or any lesson) — the Got it list's edit */
export async function rewordLesson(db: SupabaseClient, tenantId: string, id: string, edit: { lesson?: string; applies_when?: string }): Promise<boolean> {
  const lesson = str(edit.lesson).slice(0, 600)
  const applies = str(edit.applies_when).slice(0, 300)
  if (!lesson && !applies) return false
  const { data } = await db.from('learning_lessons').update({ ...(lesson ? { lesson } : {}), ...(applies ? { applies_when: applies } : {}), source: 'taught', updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('id', id).select('id').maybeSingle()
  return !!data
}

/** The office memory relevant to a person, company or job, for anything IRC writes outside a feature with its own lessons */
export async function officeMemory(db: SupabaseClient, tenantId: string, limit = 40): Promise<{ id: string; applies_when: string; lesson: string }[]> {
  const { data } = await db.from('learning_lessons').select('id, applies_when, lesson')
    .eq('tenant_id', tenantId).eq('feature', OFFICE).eq('status', 'active').order('updated_at', { ascending: false }).limit(limit)
  return (data as { id: string; applies_when: string; lesson: string }[] | null) ?? []
}

/** Office memory as the AI reads it; '' when empty */
export function formatOfficeMemory(rows: { applies_when: string; lesson: string }[]): string {
  if (!rows.length) return ''
  return `THE OFFICE'S MEMORY (what the owner has taught — follow each where its situation matches)\n${rows.map(r => `- When: ${r.applies_when}\n  ${r.lesson}`).join('\n')}`
}
