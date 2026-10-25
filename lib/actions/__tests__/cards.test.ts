import { describe, it, expect, vi, beforeEach } from 'vitest'

// Action cards: queued once per conversation as email arrives, made by the
// model with write tools recorded (never run), starred and re-starred by the
// user, and confirmed by running only the chosen steps — as the user, through
// callTool.

type Row = Record<string, unknown>
const tables: Record<string, Row[]> = {}
let nextId = 1

const LIVE = ['queued', 'generating', 'pending', 'failed']

/** Just enough of supabase-js over in-memory rows */
function table(name: string) {
  const rows = (tables[name] ??= [])
  const preds: ((r: Row) => boolean)[] = []
  let patch: Row | null = null
  let insert: Row | null = null
  let limit = Infinity
  let head = false
  const run = (): { data: unknown; error: unknown; count?: number } => {
    if (insert) {
      const row: Row = { id: `c${nextId++}`, attempts: 0, steps: [], updated_at: new Date().toISOString(), ...insert }
      // The unique index: one live card per conversation
      if (name === 'action_queue' && rows.some(r => r.source === row.source && r.source_ref === row.source_ref && LIVE.includes(r.status as string))) {
        return { data: null, error: { message: 'duplicate key' } }
      }
      rows.push(row)
      return { data: [row], error: null }
    }
    const hit = rows.filter(r => preds.every(p => p(r))).slice(0, limit)
    if (patch) for (const r of hit) Object.assign(r, patch)
    return head ? { data: null, error: null, count: hit.length } : { data: hit.map(r => ({ ...r })), error: null }
  }
  const one = async () => {
    const out = run()
    return { data: (out.data as Row[] | null)?.[0] ?? null, error: out.error }
  }
  const b: Record<string, unknown> = {
    select: (_c?: string, o?: { head?: boolean }) => { head = !!o?.head; return b },
    insert: (r: Row) => { insert = r; return b },
    update: (p: Row) => { patch = p; return b },
    eq: (c: string, v: unknown) => { preds.push(r => r[c] === v); return b },
    in: (c: string, v: unknown[]) => { preds.push(r => v.includes(r[c])); return b },
    is: (c: string, v: unknown) => { preds.push(r => (r[c] ?? null) === v); return b },
    lt: (c: string, v: unknown) => { preds.push(r => String(r[c]) < String(v)); return b },
    lte: (c: string, v: unknown) => { preds.push(r => String(r[c]) <= String(v)); return b },
    gte: (c: string, v: unknown) => { preds.push(r => Number(r[c]) >= Number(v)); return b },
    ilike: (c: string, v: string) => { preds.push(r => String(r[c]).toLowerCase() === v.toLowerCase()); return b },
    order: () => b,
    limit: (n: number) => { limit = n; return b },
    single: one,
    maybeSingle: one,
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  }
  return b
}
const db = { from: table }

// ── The conversation and tools the card reads ──

let detail: Row | null
const tool = (name: string, readOnly: boolean, run: (args: Row) => { text: string; data?: unknown; isError?: boolean }, props: string[] = []) => ({
  name, title: name.replace(/_/g, ' '), description: name,
  inputSchema: { type: 'object', properties: Object.fromEntries(props.map(p => [p, { type: 'string' }])) },
  annotations: { readOnlyHint: readOnly }, run: vi.fn(async (args: Row) => run(args)),
})
const TOOLS = [
  tool('list_job_emails', true, () => ({ text: 'Two earlier emails.' })),
  tool('send_email', false, () => ({ text: 'Sent.' }), ['mode', 'conversation_id', 'to', 'cc', 'bcc', 'subject', 'body', 'send_at', 'draft_id']),
  tool('file_conversation', false, () => ({ text: 'Filed on IRC1001.' }), ['conversation_id', 'job_number', 'filing']),
  tool('add_job_note', false, () => ({ text: 'Note added.' }), ['job_number', 'note']),
  tool('list_approvals', true, () => ({ text: 'none' })),
]

vi.mock('@/lib/mail/sync', () => ({ getMailbox: async () => ({ id: 'mb1', tenant_id: 't1' }), mailDb: () => db }))
vi.mock('@/lib/mail/list', () => ({ getThreadDetail: async () => detail }))
vi.mock('@/lib/mcp/tools', () => ({ MCP_TOOLS: TOOLS }))
vi.mock('@/lib/mcp/tools/mailbox', () => ({ readConversation: { run: async () => ({ text: 'Casey: can you come Thursday?' }) } }))
vi.mock('@/lib/mcp/tools/jobs', () => ({ getJobSummary: { run: async () => ({ text: 'IRC1001 — Casey Smith, 3 Elm St. Stage: inspection booked.' }) } }))
const callTool = vi.fn(async (t: { name: string; run(a: Row): unknown }, args: Row, ctx?: unknown) => {
  void ctx
  if (t.name === 'add_job_note' && args.note === 'needs ok') return { text: 'Sent for approval.', data: { pending_approval: true } }
  if (t.name === 'file_conversation' && args.job_number === 'IRC404') return { text: 'No job IRC404 found.', isError: true }
  return t.run(args)
})
vi.mock('@/lib/mcp/server', () => ({ callTool: (t: never, a: never, c: never) => callTool(t, a, c) }))

const { queueEmailCard, onMailArrivals, claimQueued, listCards, cardsForThreads, starThread, setCardCategory, starredThreadIds, nextCategory } = await import('../cards')
const { generateCard, describeStep } = await import('../propose')
const { confirmCard, CardError } = await import('../confirm')
const { historyArrivals } = await import('@/lib/mail/summary')

const thread = (o: Row = {}): Row => ({
  id: 'th1', subject: 'Access Thursday?', label_ids: ['INBOX'], job: { id: 'j1', job_number: 'IRC1001' }, candidates: [], orderId: null,
  messages: [{ id: 'm1', labelIds: ['INBOX'], from: { name: 'Casey', email: 'casey@gmail.com' } }],
  ...o,
})

/** A fake model that plays back a script of tool calls */
function model(script: { name: string; input: Row }[][]) {
  let turn = 0
  const create = vi.fn(async () => {
    const calls = script[turn++] ?? []
    return {
      content: calls.map((c, i) => ({ type: 'tool_use', id: `tu${turn}-${i}`, name: c.name, input: c.input })),
      stop_reason: calls.length ? 'tool_use' : 'end_turn',
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0 },
    }
  })
  return { client: { beta: { messages: { create } } } as never, create }
}

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  tables.users = [{ id: 'admin1', tenant_id: 't1', role: 'admin' }]
  tables.jobs = [{ id: 'j1', tenant_id: 't1', job_number: 'IRC1001' }]
  detail = thread()
  callTool.mockClear()
  for (const t of TOOLS) t.run.mockClear()
})

describe('historyArrivals', () => {
  it('picks out new incoming mail and our own sends', () => {
    const msg = (id: string, threadId: string, labelIds: string[]) => ({ message: { id, threadId, labelIds } })
    const out = historyArrivals([
      { messagesAdded: [msg('a', 't1', ['INBOX', 'UNREAD']), msg('b', 't2', ['SENT']), msg('c', 't3', ['INBOX', 'SPAM']), msg('d', 't4', ['DRAFT'])] },
      { labelsAdded: [msg('e', 't5', ['INBOX'])] },
    ] as never)
    expect(out.received).toEqual([{ messageId: 'a', threadId: 't1' }])
    expect(out.sentThreadIds).toEqual(['t2'])
  })
})

describe('queueing', () => {
  it('keeps one live card per conversation, re-reading it when more mail comes', async () => {
    const id = await queueEmailCard(db as never, 't1', 'th1', 'm1')
    expect(await queueEmailCard(db as never, 't1', 'th1', 'm1')).toBe(id)
    tables.action_queue[0].status = 'pending'
    expect(await queueEmailCard(db as never, 't1', 'th1', 'm2')).toBe(id)
    expect(tables.action_queue).toHaveLength(1)
    expect(tables.action_queue[0]).toMatchObject({ status: 'queued', trigger_ref: 'm2' })
  })

  it('queues the newest email per conversation, and a reply from us closes the card', async () => {
    await queueEmailCard(db as never, 't1', 'th2', 'x1')
    tables.action_queue[0].status = 'pending'
    const n = await onMailArrivals(db as never, 't1', {
      received: [{ threadId: 'th1', messageId: 'm1' }, { threadId: 'th1', messageId: 'm2' }, { threadId: 'th2', messageId: 'x2' }],
      sentThreadIds: ['th2'],
    })
    expect(n).toBe(1)
    expect(tables.action_queue.find(r => r.source_ref === 'th1')).toMatchObject({ status: 'queued', trigger_ref: 'm2' })
    expect(tables.action_queue.find(r => r.source_ref === 'th2')).toMatchObject({ status: 'done', outcome: 'Replied from Mail' })
  })

  it('claims each queued card once, and gives up on stuck ones', async () => {
    const old = new Date(Date.now() - 60 * 60_000).toISOString()
    tables.action_queue = [
      { id: 'a', tenant_id: 't1', status: 'queued', attempts: 0, updated_at: old },
      { id: 'b', tenant_id: 't1', status: 'generating', attempts: 3, updated_at: old },
    ]
    const [first, second] = await Promise.all([claimQueued(db as never, 5), claimQueued(db as never, 5)])
    expect([...first, ...second].map(c => c.id)).toEqual(['a'])
    expect(tables.action_queue.map(r => r.status)).toEqual(['generating', 'failed'])
    expect(tables.action_queue[0].attempts).toBe(1)
    expect(await cardsForThreads(db as never, 't1', [])).toEqual({})
    expect((await listCards(db as never, 't1', 'pending')).map(c => c.id).sort()).toEqual(['a', 'b'])
  })
})

describe('stars', () => {
  it('cycles Invoices to pay → Attend and Submit → Everything else → off', () => {
    expect([nextCategory(null), nextCategory('invoice'), nextCategory('attend_submit'), nextCategory('other')])
      .toEqual(['invoice', 'attend_submit', 'other', null])
  })

  it('stars an email as a new card for the AI to fill in, changes its symbol, and takes it off', async () => {
    tables.mail_threads = [{ tenant_id: 't1', gmail_thread_id: 'th1', subject: 'Plumbing invoice #44' }]
    expect(await starThread(db as never, 't1', 'th1', 'invoice', 'u1')).toMatchObject({ status: 'queued', title: 'Plumbing invoice #44', category: 'invoice' })
    expect(tables.action_queue[0]).toMatchObject({ status: 'queued', starred_by: 'u1', category: 'invoice' })
    await starThread(db as never, 't1', 'th1', 'attend_submit', 'u1')
    expect(tables.action_queue).toHaveLength(1)
    expect(tables.action_queue[0].category).toBe('attend_submit')
    expect(await starredThreadIds(db as never, 't1', 'attend_submit')).toEqual(['th1'])
    expect(await starredThreadIds(db as never, 't1', 'invoice')).toEqual([])
    expect(await starThread(db as never, 't1', 'th1', null, 'u1')).toBeNull()
    expect(tables.action_queue[0]).toMatchObject({ status: 'done', outcome: 'Star taken off' })
    expect(await starredThreadIds(db as never, 't1')).toEqual([])
  })

  it("keeps the user's own stars when we reply; the AI's close", async () => {
    await queueEmailCard(db as never, 't1', 'th1', 'm1')
    await queueEmailCard(db as never, 't1', 'th2', 'x1')
    for (const r of tables.action_queue) r.status = 'pending'
    expect(await setCardCategory(db as never, 't1', tables.action_queue[0].id as string, 'invoice', 'u1')).toBe(true)
    await onMailArrivals(db as never, 't1', { received: [], sentThreadIds: ['th1', 'th2'] })
    expect(tables.action_queue.map(r => r.status)).toEqual(['pending', 'done'])
    expect(await setCardCategory(db as never, 't1', tables.action_queue[1].id as string, 'invoice', 'u1')).toBe(false)
  })
})

describe('generateCard', () => {
  const claimed = async () => {
    await queueEmailCard(db as never, 't1', 'th1', 'm1')
    return (await claimQueued(db as never, 1))[0]
  }

  it('runs read tools, records write tools as steps without running them, and finishes', async () => {
    const card = await claimed()
    const { client, create } = model([
      [{ name: 'list_job_emails', input: { job_number: 'IRC1001' } }],
      [
        { name: 'send_email', input: { mode: 'reply', conversation_id: 'th1', to: 'casey@gmail.com', body: 'Hi Casey, Thursday works.' } },
        { name: 'add_job_note', input: { job_number: 'IRC1001', note: 'Access Thursday' } },
      ],
      [{ name: 'finish_card', input: { needs_action: true, title: 'Reply to Casey', summary: 'Casey asks about Thursday.', priority: 'high', category: 'attend_submit' } }],
    ])
    const out = await generateCard(card, { client, db: db as never, tools: TOOLS as never })
    expect(TOOLS[0].run).toHaveBeenCalledOnce()
    expect(TOOLS[1].run).not.toHaveBeenCalled()
    expect(TOOLS[3].run).not.toHaveBeenCalled()
    expect(out).toMatchObject({ status: 'pending', title: 'Reply to Casey', priority: 90, job_id: 'j1', error_log: null, category: 'attend_submit' })
    expect(out.steps!.map(s => [s.tool, s.summary, s.kind])).toEqual([
      ['send_email', 'Reply to casey@gmail.com', 'email'],
      ['add_job_note', 'add job note — IRC1001', 'change'],
    ])
    expect(tables.action_queue[0]).toMatchObject({ status: 'pending', model: 'claude-haiku-5-5' })
    // Left-out tools aren't offered; the job file and conversation go in up front
    const first = (create.mock.calls[0] as unknown as [{ tools: { name: string }[]; messages: { content: string }[] }])[0]
    expect(first.tools.map(t => t.name)).not.toContain('list_approvals')
    expect(first.messages[0].content).toMatch(/Casey: can you come Thursday\?[\s\S]*IRC1001 — Casey Smith/)
  })

  it("follows the office's instructions over its own view, with the earlier suggestion for context", async () => {
    tables.action_queue = [{ id: 'k1', tenant_id: 't1', source: 'email', source_ref: 'th1', status: 'generating', attempts: 1, title: 'Reply to Casey',
      steps: [{ id: 's1', tool: 'send_email', args: {}, summary: 'Reply to casey@gmail.com', kind: 'email' }] }]
    // Already answered: still remade, as asked
    detail = thread({ messages: [{ id: 'm2', labelIds: ['SENT'], from: { name: 'IRC', email: 'office@insurancerepairco.com.au' } }] })
    const { client, create } = model([[{ name: 'finish_card', input: { needs_action: true, title: 'Add a note', summary: 's', priority: 'normal', category: 'other' } }]])
    const out = await generateCard(tables.action_queue[0] as never, { client, db: db as never, tools: TOOLS as never, feedback: 'Don\'t reply — just note we\'re waiting on the insurer' })
    expect(out.status).toBe('pending')
    const first = (create.mock.calls[0] as unknown as [{ messages: { content: string }[] }])[0].messages[0].content
    expect(first).toContain("THE OFFICE'S INSTRUCTIONS")
    expect(first).toContain('1. Reply to casey@gmail.com')
    expect(first).toContain('"Don\'t reply — just note we\'re waiting on the insurer"')
  })

  it('drafts a due follow-up from the job as it is now, and keeps it on the list even if nothing is needed', async () => {
    tables.action_queue = [{ id: 'f1', tenant_id: 't1', source: 'followup', source_ref: null, job_id: 'j1', status: 'generating', attempts: 1,
      title: 'Follow up with Ace Roofing: Chase the roof quote', steps: [], created_at: '2026-10-18T02:00:00Z',
      follow_up: { note: 'Chase the roof quote', who: 'Ace Roofing', thread_id: 'abc1', from_card_id: null, created_by: 'u1' } }]
    const { client, create } = model([
      [{ name: 'send_email', input: { mode: 'reply', conversation_id: 'abc1', body: 'Hi, just following up on the roof quote.' } }],
      [{ name: 'finish_card', input: { needs_action: false, title: 'Chase Ace Roofing for the quote', summary: 'No quote yet.', priority: 'normal', category: 'other' } }],
    ])
    const out = await generateCard(tables.action_queue[0] as never, { client, db: db as never, tools: TOOLS as never })
    expect(out).toMatchObject({ status: 'pending', title: 'Chase Ace Roofing for the quote', job_id: 'j1' })
    expect(out.steps!.map(s => s.tool)).toEqual(['send_email'])
    const first = (create.mock.calls[0] as unknown as [{ messages: { content: string }[] }])[0].messages[0].content
    expect(first).toMatch(/A FOLLOW-UP THE OFFICE SET \(on Sunday 18 October, for today\)\nWho: Ace Roofing\n"Chase the roof quote"\nJob: IRC1001/)
    expect(first).toMatch(/THE CONVERSATION IT WAS SET FROM \(conversation_id: abc1\)[\s\S]*THE JOB FILE \(as it is now\)/)
  })

  it('marks notifications as no action', async () => {
    const card = await claimed()
    const { client } = model([[{ name: 'finish_card', input: { needs_action: false, title: 'Xero receipt', summary: 'A receipt.', priority: 'low' } }]])
    expect(await generateCard(card, { client, db: db as never, tools: TOOLS as never })).toMatchObject({ status: 'no_action', steps: [], priority: 20 })
  })

  it("keeps a star the user set: their symbol, and on the list even when there's nothing to do or we've replied", async () => {
    tables.mail_threads = [{ tenant_id: 't1', gmail_thread_id: 'th1', subject: 'Invoice' }]
    await starThread(db as never, 't1', 'th1', 'invoice', 'u1')
    const card = (await claimQueued(db as never, 1))[0]
    detail = thread({ messages: [{ id: 'm1', labelIds: ['INBOX'], from: { email: 'casey@gmail.com' } }, { id: 'm2', labelIds: ['SENT'], from: { email: 'office@insurancerepairco.com.au' } }] })
    const { client, create } = model([[{ name: 'finish_card', input: { needs_action: false, title: 'Invoice from Bob', summary: 'An invoice.', priority: 'low', category: 'other' } }]])
    const out = await generateCard(card, { client, db: db as never, tools: TOOLS as never })
    expect(create).toHaveBeenCalledOnce()
    expect((create.mock.calls[0] as unknown as [{ messages: { content: string }[] }])[0].messages[0].content).toContain('starred this email themselves')
    expect(out).toMatchObject({ status: 'pending', title: 'Invoice from Bob' })
    expect(out.category).toBeUndefined()
    expect(tables.action_queue[0]).toMatchObject({ status: 'pending', category: 'invoice' })
  })

  it("skips the model when we've already replied, or the conversation is in the Bin", async () => {
    const { client, create } = model([])
    detail = thread({ messages: [{ id: 'm1', labelIds: ['INBOX'], from: { email: 'casey@gmail.com' } }, { id: 'm2', labelIds: ['SENT'], from: { email: 'office@insurancerepairco.com.au' } }] })
    expect(await generateCard(await claimed(), { client, db: db as never, tools: TOOLS as never })).toMatchObject({ status: 'done', outcome: 'Already replied' })
    tables.action_queue = []
    detail = thread({ label_ids: ['TRASH'] })
    expect(await generateCard(await claimed(), { client, db: db as never, tools: TOOLS as never })).toMatchObject({ status: 'no_action' })
    expect(create).not.toHaveBeenCalled()
  })

  it('keeps a failure on the card', async () => {
    const card = await claimed()
    const client = { beta: { messages: { create: async () => { throw new Error('overloaded') } } } } as never
    expect(await generateCard(card, { client, db: db as never, tools: TOOLS as never })).toEqual({ status: 'failed', error_log: 'overloaded' })
    expect(tables.action_queue[0].status).toBe('failed')
  })
})

describe('confirmCard', () => {
  const step = (id: string, t: string, args: Row) => ({ id, tool: t, args, summary: `${t} ${id}`, kind: 'change' })
  const pendingCard = (steps: Row[]) => {
    tables.action_queue = [{ id: 'k1', tenant_id: 't1', source: 'email', source_ref: 'th1', status: 'pending', attempts: 1, steps }]
  }

  it('runs only the chosen steps as the user, with only editable fields changed', async () => {
    pendingCard([
      step('s1', 'send_email', { mode: 'reply', conversation_id: 'th1', body: 'draft' }),
      step('s2', 'add_job_note', { job_number: 'IRC1001', note: 'n' }),
    ])
    const card = await confirmCard('t1', 'u9', 'k1', [{ id: 's1', args: { body: 'Edited', conversation_id: 'other' } }], { db: db as never, tools: TOOLS as never })
    expect(callTool).toHaveBeenCalledOnce()
    expect(callTool.mock.calls[0][1]).toEqual({ mode: 'reply', conversation_id: 'th1', body: 'Edited' })
    expect(callTool.mock.calls[0][2]).toMatchObject({ tenantId: 't1', userId: 'u9', via: 'chat' })
    expect(card).toMatchObject({ status: 'done', outcome: '1 step done', confirmed_by: 'u9' })
    expect(card.steps.map(s => s.status)).toEqual(['done', 'skipped'])
  })

  it('stops at a failure, leaving later steps to retry, and never re-runs done steps', async () => {
    pendingCard([
      step('s1', 'file_conversation', { job_number: 'IRC404' }),
      step('s2', 'send_email', { body: 'x' }),
    ])
    const all = [{ id: 's1' }, { id: 's2' }]
    const failed = await confirmCard('t1', 'u9', 'k1', all, { db: db as never, tools: TOOLS as never })
    expect(failed).toMatchObject({ status: 'failed', error_log: 'file_conversation s1: No job IRC404 found.' })
    expect(failed.steps.map(s => s.status)).toEqual(['failed', undefined])
    expect(TOOLS[1].run).not.toHaveBeenCalled()

    // Fixed and tried again: the send goes once
    const retry = await confirmCard('t1', 'u9', 'k1', [{ id: 's1', args: { job_number: 'IRC1001' } }, { id: 's2' }], { db: db as never, tools: TOOLS as never })
    expect(retry).toMatchObject({ status: 'done', outcome: '2 steps done' })
    await expect(confirmCard('t1', 'u9', 'k1', all, { db: db as never, tools: TOOLS as never })).rejects.toThrow(/done/)
    expect(TOOLS[1].run).toHaveBeenCalledOnce()
  })

  it('sends an email edited in the composer as its draft — unless a change rewrites it', async () => {
    const draft = { id: 'r-1', to: 'casey@gmail.com', cc: '', bcc: '', subject: 'Re: Access', html: '<p>Edited</p>' }
    pendingCard([{ ...step('s1', 'send_email', { mode: 'reply', conversation_id: 'th1', body: 'AI text' }), draft }])
    await confirmCard('t1', 'u9', 'k1', [{ id: 's1', args: { send_at: '2099-10-26T00:00:00.000Z' } }], { db: db as never, tools: TOOLS as never })
    expect(callTool.mock.calls[0][1]).toEqual({ draft_id: 'r-1', send_at: '2099-10-26T00:00:00.000Z' })

    callTool.mockClear()
    pendingCard([{ ...step('s1', 'send_email', { mode: 'reply', conversation_id: 'th1', body: 'AI text' }), draft }])
    const card = await confirmCard('t1', 'u9', 'k1', [{ id: 's1', args: { body: 'Said by voice' } }], { db: db as never, tools: TOOLS as never })
    expect(callTool.mock.calls[0][1]).toEqual({ mode: 'reply', conversation_id: 'th1', body: 'Said by voice' })
    expect(card.steps[0].draft).toBeUndefined()
  })

  it('with only, runs just the chosen step and leaves the rest on the card', async () => {
    pendingCard([
      step('s1', 'file_conversation', { job_number: 'IRC1001' }),
      step('s2', 'send_email', { mode: 'reply', body: 'x' }),
    ])
    const card = await confirmCard('t1', 'u9', 'k1', [{ id: 's2' }], { db: db as never, tools: TOOLS as never, only: true })
    expect(card.status).toBe('pending')
    expect(card.steps.map(s => s.status)).toEqual([undefined, 'done'])

    // A sync seeing that reply doesn't close the card with the filing still to do
    await onMailArrivals(db as never, 't1', { received: [], sentThreadIds: ['th1'] } as never)
    expect(tables.action_queue[0].status).toBe('pending')

    const rest = await confirmCard('t1', 'u9', 'k1', [{ id: 's1' }], { db: db as never, tools: TOOLS as never })
    expect(rest).toMatchObject({ status: 'done', outcome: '2 steps done' })
  })

  it('counts steps sent for approval as waiting', async () => {
    pendingCard([step('s1', 'add_job_note', { job_number: 'IRC1001', note: 'needs ok' })])
    const card = await confirmCard('t1', 'u9', 'k1', [{ id: 's1' }], { db: db as never, tools: TOOLS as never })
    expect(card).toMatchObject({ status: 'done', outcome: '1 waiting for approval' })
    expect(card.steps[0].status).toBe('waiting')
  })

  it('refuses nothing chosen, a missing card, or one already running', async () => {
    pendingCard([step('s1', 'add_job_note', { note: 'n' })])
    await expect(confirmCard('t1', 'u9', 'k1', [], { db: db as never, tools: TOOLS as never })).rejects.toBeInstanceOf(CardError)
    await expect(confirmCard('t1', 'u9', 'nope', [{ id: 's1' }], { db: db as never, tools: TOOLS as never })).rejects.toMatchObject({ status: 404 })
    tables.action_queue[0].status = 'running'
    await expect(confirmCard('t1', 'u9', 'k1', [{ id: 's1' }], { db: db as never, tools: TOOLS as never })).rejects.toMatchObject({ status: 409 })
    expect(callTool).not.toHaveBeenCalled()
  })
})

describe('describeStep', () => {
  it('says what each step will do', () => {
    const t = (name: string) => ({ name, title: 'Send work order' }) as never
    expect(describeStep(t('send_email'), { mode: 'forward', to: 'bob@trade.com', subject: 'Plans', send_at: 'tomorrow 8am' }).summary)
      .toBe('Forward to bob@trade.com: "Plans" (scheduled tomorrow 8am)')
    expect(describeStep(t('file_conversation'), { filing: 'admin' })).toEqual({ summary: 'File as admin', kind: 'filing' })
    expect(describeStep(t('send_work_order'), { job_number: 'IRC1001' })).toEqual({ summary: 'Send work order — IRC1001', kind: 'change' })
    expect(describeStep(t('set_follow_up'), { when: '7', who: 'Ace Roofing', note: 'Chase the quote' }).summary).toBe('Remind me in 7 days to follow up with Ace Roofing: Chase the quote')
    expect(describeStep(t('set_follow_up'), { when: '2026-11-02', note: 'Call Jo' }).summary).toBe('Remind me on 2026-11-02: Call Jo')
  })
})
