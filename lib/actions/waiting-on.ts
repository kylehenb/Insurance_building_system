import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import type { McpContext } from '@/lib/mcp/server'
import { getJobSummary } from '@/lib/mcp/tools/jobs'
import { readConversation } from '@/lib/mcp/tools/mailbox'
import { getThreadDetail } from '@/lib/mail/list'
import { getMailbox, mailDb } from '@/lib/mail/sync'
import { cardActor, CARD_COLUMNS, type ActionCard, type WaitingOn } from './cards'
import { chaseDue, createFollowUp, spokenDue } from './followups'
import { days, openWaits, sentOn, waitLearning, waitLine, waitSituation } from './waits'

// Waiting on (tech spec §23.12): what the office has asked of other people.
// Every email the office sends is read once (sent_emails, filled by the send
// itself and by the mailbox sync). When it asks someone outside the office
// for something — a trade for photos, an insurer for approval — the AI sets
// a follow-up for whoever sent it: when to chase comes from what the office
// did in the most alike past waits (the learning module, §24) and from the
// job itself (an escalated homeowner, an insurer already chasing). A reply in
// the conversation closes it; a later email on the job that makes it more
// urgent brings it forward (the card AI, lib/actions/propose.ts). If nothing
// comes, it comes onto the action cards like any follow-up, with the chase
// drafted. Nothing is sent by itself. This file reads the sent emails; the
// database side (learning, replies, the list) is lib/actions/waits.ts.

export const WAIT_MODEL = process.env.AI_WAIT_MODEL || 'claude-haiku-5-5'

const OWN_DOMAIN = 'insurancerepairco.com.au'
const MAX_ATTEMPTS = 3
const STUCK_MS = 10 * 60_000
/** A send recorded by the mailbox sync waits this long, so a send from IRC can say who sent it first */
const SETTLE_MS = 45_000
const MAX_DAYS = 20

export const ROLES = ['trade', 'insurer', 'assessor', 'insured', 'supplier', 'other'] as const
export const ASK_KINDS = ['information', 'photos', 'quote', 'invoice', 'report', 'booking', 'approval', 'documents', 'other'] as const

const now = () => new Date().toISOString()
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const isOwn = (email: string | null | undefined) => !!email && email.toLowerCase().endsWith(`@${OWN_DOMAIN}`)

// ── Reading sent emails ──

type SentRow = { id: string; tenant_id: string; gmail_message_id: string; thread_id: string | null; sent_by: string | null; status: string; attempts: number; created_at: string }

const RECORD: Anthropic.Beta.BetaTool = {
  name: 'record_wait',
  description: 'Record what this email asks for. Call it once.',
  input_schema: {
    type: 'object',
    properties: {
      asks: { type: 'boolean', description: 'true when the email asks someone outside the office for something the office needs back.' },
      waiting_on_name: { type: 'string', description: 'Who the office is waiting on: the business for a trade or supplier ("Sparky Bros Electrical"), else the person ("Jo Smith").' },
      waiting_on_email: { type: 'string', description: 'Their email address, from the recipients.' },
      role: { type: 'string', enum: [...ROLES], description: 'trade (incl. subcontractors), insurer (claims staff), assessor (loss adjuster), insured (the homeowner or tenant), supplier, other.' },
      asked: { type: 'string', description: 'What they were asked for, in a few words: "the switchboard photos", "a quote for the roof", "a time to inspect".' },
      ask_kind: { type: 'string', enum: [...ASK_KINDS] },
      on_behalf_of: { type: 'string', description: 'Who is waiting on the office for this, if anyone, briefly: "Suncorp asked for it on 28 Oct". Empty if no one.' },
      chase_after_working_days: { type: 'integer', minimum: 0, maximum: MAX_DAYS, description: 'Working days after this email to chase if nothing comes back. 0 = later today.' },
      urgent: { type: 'boolean', description: 'Urgent: safety, a make safe, an escalation, an insurer deadline.' },
      reason: { type: 'string', description: 'One plain sentence on why the chase is then, naming what decided it.' },
    },
    required: ['asks'],
  },
}

export const WAIT_SYSTEM_PROMPT = `You keep track of what Insurance Repair Co (building insurance repairs in Perth: storm and water damage, make safes, quotes, reports, trades) is waiting on from other people. Someone in the office has just sent the email marked THE EMAIL JUST SENT. Decide whether it asks someone outside the office for something the office needs back — information, photos, a quote, an invoice, a report, a booking or a time, an approval, documents — and if so, who, what, and when to chase it if nothing comes back. Call record_wait once.

- Asks for nothing (asks false): answers, confirmations, thank-yous, FYIs, sending a report, quote or documents without asking anything back, booking confirmations, automatic notices and acknowledgements, emails only to the office itself. A work order sent to a trade counts only if it asks them to reply (a booking date, a quote, to confirm).
- One wait per email: if it asks several people, pick the one the office most needs to hear from.
- If the office was already waiting on something in this conversation and this email asks again or chases, it's the same wait: answer for this email (it replaces the earlier reminder).
- When to chase, in working days after this email (0 = later today):
  1. Start from the office's own habits in WHAT THE OFFICE DID IN SIMILAR PAST CASES and the LESSONS (most alike first: the same person beats the same company, which beats the same kind of trade or the same kind of ask). When the office moved a chase, the day they moved it to is the habit; when someone replied before the chase, that shows how long they take.
  2. Then read the job and the conversation, and let anything that makes this one more or less urgent win: an insurer or homeowner already waiting on the office for it (say so in on_behalf_of), an insurer that has chased before, a homeowner who has complained or escalated, things gone wrong on the job, a make safe or anything unsafe, a deadline or SLA, or the person saying when they'll reply ("I'll have it to you Thursday" — chase the working day after).
  3. With no past cases: 2 working days for most asks, 1 when someone is waiting on the office for it, 0 for urgent safety work, about 5 for a full quote or report.
- reason: one plain sentence the office reads on the reminder, naming what decided it — e.g. "You usually give Sparky Bros a week, but the homeowner complained on Monday and Suncorp is waiting, so tomorrow."

Today is given in the first message. Times are Perth time (AWST).`

/** Who sent it, by name, for the AI and the card */
async function senderName(db: SupabaseClient, sentBy: string | null): Promise<string | null> {
  if (!sentBy) return null
  const { data } = await db.from('users').select('name').eq('id', sentBy).maybeSingle()
  return (data as { name: string } | null)?.name ?? null
}

const today = () => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Perth', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date())

/** done: read; new: failed, to try again; failed: given up */
type Read = { status: 'done' | 'new' | 'failed'; outcome: string; follow_up_id?: string | null }

/**
 * Reads one sent email and sets its wait, if it asks for something. Never
 * throws — a failure is kept on the row (and retried, up to 3 times).
 */
export async function readSentEmail(row: SentRow, opts: { db?: SupabaseClient; client?: Pick<Anthropic, 'beta'>; at?: Date } = {}): Promise<Read> {
  const db = opts.db ?? mailDb()
  const at = opts.at ?? new Date()
  const save = async (r: Read) => {
    await db.from('sent_emails').update({ status: r.status, outcome: r.outcome, follow_up_id: r.follow_up_id ?? null, updated_at: now() }).eq('id', row.id)
    return r
  }
  try {
    if (!row.thread_id) return save({ status: 'done', outcome: 'No conversation' })
    const detail = await getThreadDetail(await getMailbox(row.tenant_id, db), row.thread_id, db)
    if (!detail) return save({ status: 'done', outcome: 'The conversation no longer exists' })
    const message = detail.messages.find(m => m.id === row.gmail_message_id)
    if (!message) return save({ status: 'done', outcome: 'The email is no longer in the conversation' })
    const outside = [...message.to, ...message.cc].filter(a => !isOwn(a.email))
    if (!outside.length) return save({ status: 'done', outcome: 'Only to the office' })

    const ctx: McpContext = { supabase: db as unknown as SupabaseClient<Database>, tenantId: row.tenant_id, userId: await cardActor(db, row.tenant_id), via: 'chat' }
    const jobId = detail.job?.id ?? null
    const [conversation, jobFile, sender, earlier, others] = await Promise.all([
      readConversation.run({ conversation_id: row.thread_id }, ctx).then(r => r.text),
      detail.job ? getJobSummary.run({ job_number: detail.job.job_number }, ctx).then(r => r.text) : Promise.resolve('This conversation is not on a job.'),
      senderName(db, row.sent_by),
      waitsInThread(db, row.tenant_id, row.thread_id),
      jobId ? openWaits(db, row.tenant_id, jobId, row.thread_id) : Promise.resolve([]),
    ])
    const dated = message.date ? new Date(message.date) : null
    const sentAt = dated && !Number.isNaN(dated.getTime()) ? dated.toISOString() : row.created_at
    const just = `From ${message.from?.email ?? 'the office'}${sender ? ` (sent by ${sender})` : ''}, ${sentOn(sentAt)}. To ${message.to.map(a => a.name ? `${a.name} <${a.email}>` : a.email).join(', ') || 'no one'}${message.cc.length ? `, cc ${message.cc.map(a => a.email).join(', ')}` : ''}.\nSubject: ${message.subject || detail.subject}\n${clip(message.text.trim(), 6000) || '(no text)'}`

    // The learning goes in once the AI says who it's waiting on: a first pass
    // would cost a second call, so the likely person — the first outside
    // recipient — stands in for them
    const guess = outside[0]
    const situation = await waitSituation(db, row.tenant_id, { email: guess.email, name: guess.name || guess.email, role: '', ask_kind: '' }, jobId, row.sent_by)
    const learning = await waitLearning(db, row.tenant_id, situation)

    const intro = [
      `Today: ${today()}.`,
      `THE EMAIL JUST SENT\n${just}`,
      `THE CONVERSATION (oldest first; the email just sent is in it)\n${conversation}`,
      `THE JOB FILE\n${jobFile}`,
      earlier.length ? `ALREADY WAITING IN THIS CONVERSATION\n${earlier.map(c => `- ${waitLine(c)}`).join('\n')}` : '',
      others.length ? `ALSO WAITING ON THIS JOB\n${others.map(c => `- ${waitLine(c)}`).join('\n')}` : '',
      learning,
    ].filter(Boolean).join('\n\n')

    const client = opts.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await client.beta.messages.create({
      model: WAIT_MODEL,
      max_tokens: 2000,
      system: WAIT_SYSTEM_PROMPT,
      tools: [RECORD],
      tool_choice: { type: 'tool', name: RECORD.name },
      messages: [{ role: 'user', content: intro }],
    } as Anthropic.Beta.MessageCreateParamsNonStreaming)
    const call = response.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && b.name === RECORD.name)
    if (!call) throw new Error('The AI didn\'t say what the email asks for')
    const out = (call.input ?? {}) as Record<string, unknown>
    if (out.asks !== true) return save({ status: 'done', outcome: 'Asks for nothing' })

    const email = str(out.waiting_on_email).toLowerCase() || null
    const name = str(out.waiting_on_name) || outside.find(a => a.email.toLowerCase() === email)?.name || email || 'them'
    const asked = clip(str(out.asked) || 'a reply', 200)
    const role = (ROLES as readonly string[]).includes(str(out.role)) ? str(out.role) : 'other'
    const askKind = (ASK_KINDS as readonly string[]).includes(str(out.ask_kind)) ? str(out.ask_kind) : 'other'
    const n = Number(out.chase_after_working_days)
    const aiDays = Number.isFinite(n) ? Math.min(MAX_DAYS, Math.max(0, Math.round(n))) : 2
    const due = chaseDue(aiDays, at)
    const reason = clip(str(out.reason) || `Chasing after ${days(aiDays)}.`, 400)
    const onBehalf = str(out.on_behalf_of) || null

    const waiting: WaitingOn = {
      name: clip(name, 120), email, role, asked, ask_kind: askKind, on_behalf_of: onBehalf ? clip(onBehalf, 200) : null,
      message_id: row.gmail_message_id, sent_at: sentAt, ai_days: aiDays, ai_due_at: due, reason,
      situation: await waitSituation(db, row.tenant_id, { email, name, role, ask_kind: askKind }, jobId, row.sent_by),
    }
    // This email asks again: it replaces the earlier reminder
    for (const c of earlier) {
      await db.from('action_queue').update({ status: 'skipped', outcome: 'Replaced by a later email', updated_at: now() })
        .eq('id', c.id).eq('status', 'scheduled')
    }
    const card = await createFollowUp(db, row.tenant_id, row.sent_by, {
      jobId,
      note: `Chase ${name} for ${asked}${onBehalf ? ` — ${onBehalf}` : ''}. ${reason}`,
      who: name,
      dueAt: due,
      threadId: row.thread_id,
      waiting,
      urgent: out.urgent === true,
    })
    return save({ status: 'done', outcome: `Asked ${name} for ${asked} — chase ${spokenDue(due)}`, follow_up_id: card.id })
  } catch (err) {
    console.error(`[waiting-on] sent email ${row.id} failed:`, err)
    const message = err instanceof Error ? err.message : String(err)
    // Not given up yet: back in the queue for the next run
    return save({ status: row.attempts >= MAX_ATTEMPTS ? 'failed' : 'new', outcome: `Couldn't read it: ${clip(message, 300)}` })
  }
}

/** The waits still waiting in one conversation */
async function waitsInThread(db: SupabaseClient, tenantId: string, threadId: string): Promise<ActionCard[]> {
  const { data } = await db.from('action_queue').select(CARD_COLUMNS)
    .eq('tenant_id', tenantId).eq('source', 'followup').eq('rule_key', 'waiting_on').eq('status', 'scheduled')
  return ((data as ActionCard[] | null) ?? []).filter(c => c.follow_up?.thread_id === threadId)
}

/** Takes up to `limit` sent emails to read (status → reading), re-queueing reads that were cut off */
export async function claimSent(db: SupabaseClient, limit: number, at = new Date()): Promise<SentRow[]> {
  const stuck = new Date(at.getTime() - STUCK_MS).toISOString()
  await db.from('sent_emails').update({ status: 'new', updated_at: now() }).eq('status', 'reading').lte('updated_at', stuck)
  const { data } = await db.from('sent_emails').select('id, tenant_id, gmail_message_id, thread_id, sent_by, status, attempts, created_at')
    .eq('status', 'new').lte('created_at', new Date(at.getTime() - SETTLE_MS).toISOString())
    .order('created_at', { ascending: true }).limit(limit)
  const claimed: SentRow[] = []
  for (const row of (data as SentRow[] | null) ?? []) {
    const { data: won } = await db.from('sent_emails').update({ status: 'reading', attempts: row.attempts + 1, updated_at: now() })
      .eq('id', row.id).eq('status', 'new').select('id').maybeSingle()
    if (won) claimed.push({ ...row, attempts: row.attempts + 1 })
  }
  return claimed
}

/** Reads sent emails until the time budget runs out (the minute cron and the webhook) */
export async function drainSentQueue({ budgetMs = 60_000, db = mailDb() }: { budgetMs?: number; db?: SupabaseClient } = {}): Promise<{ read: number }> {
  if (!process.env.ANTHROPIC_API_KEY) return { read: 0 }
  const started = Date.now()
  let read = 0
  while (Date.now() - started < budgetMs) {
    const [row] = await claimSent(db, 1)
    if (!row) break
    await readSentEmail(row, { db })
    read++
  }
  return { read }
}
