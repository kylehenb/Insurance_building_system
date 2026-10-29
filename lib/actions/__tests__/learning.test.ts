import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from '@/lib/mcp/__tests__/fake-supabase'

// Action cards learning from the office: what was done with the AI's
// proposal is recorded (confirmed, edited, skipped, sent back with
// instructions), and the next card in a like situation reads those cases.

const tables: Record<string, Row[]> = {}
const db = fakeSupabase(tables)

const tool = (name: string, readOnly = false) => ({
  name, title: name.replace(/_/g, ' '), description: name, inputSchema: { type: 'object', properties: {} },
  annotations: { readOnlyHint: readOnly }, run: vi.fn(async () => ({ text: 'ok' })),
})
vi.mock('@/lib/mcp/tools', () => ({ MCP_TOOLS: [tool('add_job_note'), tool('send_email'), tool('set_follow_up')] }))
vi.mock('@/lib/mcp/tools/jobs', () => ({ getJobSummary: { run: async () => ({ text: 'IRC1042 job file' }) } }))
vi.mock('@/lib/mcp/tools/mailbox', () => ({ readConversation: { run: async () => ({ text: 'The conversation' }) } }))
vi.mock('@/lib/mail/list', () => ({
  getThreadDetail: async () => ({
    subject: 'Make safe access', label_ids: ['INBOX'],
    messages: [
      { labelIds: ['INBOX'], from: { name: 'Jane Lee', email: 'Jane@Allianz.com.au' } },
      { labelIds: ['SENT'], from: { name: 'IRC', email: 'office@insurancerepairco.com.au' } },
      { labelIds: ['INBOX'], from: { name: 'Jane Lee', email: 'jane@allianz.com.au' } },
    ],
    job: { id: 'j1', job_number: 'IRC1042' }, candidates: [], orderId: null,
  }),
}))
vi.mock('@/lib/mail/sync', () => ({ getMailbox: async () => ({ id: 'mb1' }), mailDb: () => db }))
vi.mock('../steps', () => ({ discardStepDrafts: async () => {} }))

let answer: { name: string; input: Row }[] = []
const create = vi.fn()
vi.mock('@anthropic-ai/sdk', () => ({ default: class { beta = { messages: { create } } } }))

const { compareCard, htmlText, situationText, recordCardDecision } = await import('../learning')
const { generateCard, resuggestCard } = await import('../propose')
const { skipCard } = await import('../cards')

type Step = { id: string; tool: string; args: Row; summary: string; kind: string; status?: string; draft?: Row }
const AI: Step[] = [
  { id: 's1', tool: 'send_email', args: { mode: 'reply', body: 'Hi Jane, Thursday works.', cc: '' }, summary: 'Reply', kind: 'email' },
  { id: 's2', tool: 'add_job_note', args: { note: 'Access Thursday' }, summary: 'Add job note — Access Thursday', kind: 'change' },
]
const done = (s: Step, extra: Partial<Step> = {}): Step => ({ ...structuredClone(s), status: 'done', ...extra })

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  create.mockReset()
  create.mockImplementation(async () => {
    const blocks = [...answer.map((a, i) => ({ type: 'tool_use', id: `t${i}`, name: a.name, input: a.input })), { type: 'tool_use', id: 'fin', name: 'finish_card', input: { needs_action: true, title: 'Reply to Jane', summary: 'Access', priority: 'normal', category: 'other' } }]
    return { content: blocks, stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } }
  })
  tables.users = [{ id: 'u1', tenant_id: 't1', role: 'admin', created_at: '2026-01-01' }]
  tables.jobs = [{ id: 'j1', tenant_id: 't1', insurer: 'Allianz', job_type: 'make_safe', current_stage: 'Booked', loss_type: 'Storm' }]
})

describe('compareCard', () => {
  it('is accepted when everything ran as proposed', () => {
    expect(compareCard(AI as never, AI.map(s => done(s)) as never, 'confirmed')).toEqual({ changes: [], outcome: 'accepted' })
  })

  it('sees an email rewritten in the composer, a dropped step and an added one', () => {
    const steps = [
      done(AI[0], { draft: { id: 'd1', to: 'jane@allianz.com.au', cc: 'assessor@allianz.com.au', bcc: '', subject: 'Re: access', html: '<p>Hi Jane,</p><p>Thursday 9am &amp; the key&nbsp;is at the shed.</p>' } }),
      { ...AI[1], status: 'skipped' },
      { id: 'x1', tool: 'set_follow_up', args: { note: 'chase the roofer' }, summary: 'Remind me in 3 days: chase the roofer', kind: 'change', status: 'done' },
    ]
    const { changes, outcome } = compareCard(AI as never, steps as never, 'confirmed')
    expect(outcome).toBe('edited')
    expect(changes).toContain('Reply: cc changed from (nothing) to assessor@allianz.com.au')
    expect(changes).toContain('Reply: the office rewrote the email. What went: "Hi Jane,\nThursday 9am & the key is at the shed."')
    expect(changes).toContain('Dropped: Add job note — Access Thursday')
    expect(changes).toContain('Added: Remind me in 3 days: chase the roofer. What went: "chase the roofer"')
  })

  it('is skipped when nothing ran, edited when part was done first', () => {
    expect(compareCard(AI as never, AI as never, 'skipped').outcome).toBe('skipped')
    expect(compareCard(AI as never, [done(AI[0]), AI[1]] as never, 'skipped')).toEqual({ changes: ['Dropped: Add job note — Access Thursday'], outcome: 'edited' })
  })
})

describe('htmlText and situationText', () => {
  it('turns a draft into plain text', () => {
    expect(htmlText('<div>Hi<br>there</div><style>p{}</style><p>Bye</p>')).toBe('Hi\nthere\nBye')
  })

  it('says what a card was about in one line', () => {
    expect(situationText({ kind: 'email', sender_name: 'Jane Lee', sender_email: 'jane@allianz.com.au', subject: 'Access', on_job: 'yes', insurer: 'Allianz', job_type: 'make_safe', loss_type: null, stage: 'Booked' }))
      .toBe('Email from Jane Lee <jane@allianz.com.au> — "Access" — Allianz, make_safe, stage: Booked')
    expect(situationText({ kind: 'followup', sender_name: 'the roofer', subject: 'chase quote', on_job: 'no' }))
      .toBe('Follow-up the office set (with the roofer) — "chase quote" — not on a job')
  })
})

describe('making a card', () => {
  it('keeps the situation and the AI\'s own steps, and reads alike past cases first', async () => {
    tables.learning_events = [
      { id: 'e1', tenant_id: 't1', feature: 'action_card', source_id: 'old', situation: { sender_email: 'jane@allianz.com.au', insurer: 'Allianz', subject: 'Make safe access' }, situation_text: 'Email from Jane', outcome: 'edited', changes: ['Reply: cc changed from (nothing) to assessor@allianz.com.au'], instruction: null, created_at: '2026-10-20T00:00:00Z' },
      { id: 'e2', tenant_id: 't1', feature: 'action_card', source_id: 'other', situation: { sender_email: 'bob@gmail.com', insurer: 'Suncorp', subject: 'Invoice' }, situation_text: 'Email from Bob', outcome: 'accepted', changes: [], instruction: null, created_at: '2026-10-21T00:00:00Z' },
    ]
    tables.learning_lessons = [{ id: 'l1', tenant_id: 't1', feature: 'action_card', status: 'active', applies_when: 'Scope of works under $7500', lesson: 'Send it for signing', support_count: 0, contradict_count: 0 }]
    tables.action_queue = [{ id: 'k1', tenant_id: 't1', source: 'email', source_ref: 'th1', status: 'generating', steps: [], attempts: 1, created_at: '2026-10-28' }]
    answer = [{ name: 'send_email', input: { mode: 'reply', conversation_id: 'th1', body: 'Hi Jane' } }]

    await generateCard(tables.action_queue[0] as never, { db: db as never })

    const first = create.mock.calls[0][0].messages[0].content as string
    expect(first).toContain('LESSONS FROM THE OFFICE\'S PAST DECISIONS')
    expect(first).toContain('When: Scope of works under $7500')
    expect(first).toContain('WHAT THE OFFICE DID IN SIMILAR PAST CASES')
    expect(first).toContain('cc changed from (nothing) to assessor@allianz.com.au')
    expect(first).not.toContain('Email from Bob')
    const card = tables.action_queue[0]
    expect(card.situation).toMatchObject({ kind: 'email', sender_email: 'jane@allianz.com.au', sender_domain: 'allianz.com.au', insurer: 'Allianz', stage: 'Booked', on_job: 'yes' })
    expect(card.ai_steps).toEqual(card.steps)
    expect((card.ai_steps as Row[])[0]).toMatchObject({ tool: 'send_email', args: { body: 'Hi Jane' } })
  })
})

describe('recording decisions', () => {
  const card = (extra: Row = {}): Row => ({
    id: 'k1', tenant_id: 't1', source: 'email', source_ref: 'th1', status: 'pending', attempts: 0, category: 'other',
    steps: structuredClone(AI), ai_steps: structuredClone(AI), situation: { kind: 'email', sender_email: 'jane@allianz.com.au', subject: 'Access', on_job: 'no' }, ...extra,
  })

  it('records a skipped card, as the person who skipped it', async () => {
    tables.action_queue = [card()]
    expect(await skipCard(db as never, 't1', 'k1', 'u1')).toBe(true)
    expect(tables.learning_events).toHaveLength(1)
    expect(tables.learning_events[0]).toMatchObject({ feature: 'action_card', source_id: 'k1', outcome: 'skipped', kind: 'other', user_id: 'u1', situation_text: 'Email from jane@allianz.com.au — "Access" — not on a job' })
  })

  it('doesn\'t record cards made before the learning module', async () => {
    await recordCardDecision(db as never, card({ ai_steps: null }) as never, 'u1', 'confirmed')
    expect(tables.learning_events ?? []).toHaveLength(0)
  })

  it('records the office\'s instructions when they send a card back', async () => {
    tables.action_queue = [card()]
    answer = []
    await resuggestCard(db as never, 't1', { cardId: 'k1' }, 'Copy in the assessor', 'u1')
    expect(tables.learning_events[0]).toMatchObject({ outcome: 'instructed', instruction: 'Copy in the assessor', user_id: 'u1', changes: ['Sent back the whole card: Reply; Add job note — Access Thursday'] })
  })

  it('records nothing for a plain re-suggest', async () => {
    tables.action_queue = [card()]
    answer = []
    await resuggestCard(db as never, 't1', { cardId: 'k1' }, '', 'u1')
    expect(tables.learning_events ?? []).toHaveLength(0)
  })
})
