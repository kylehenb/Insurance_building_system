import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from '@/lib/mcp/__tests__/fake-supabase'

// Out-of-date cards (tech spec §23.17): what lands in a job's feed after a
// card was written is weighed by free rules; the AI looks only when it could
// have done or changed what a card asks, once the job has gone quiet and
// nobody has it open; a card closed that way can be put back, and that's
// learned from; and a card's steps don't run without asking once the job has
// moved on.

const tables: Record<string, Row[]> = {}
const db = fakeSupabase(tables)

vi.mock('@/lib/mail/sync', () => ({ mailDb: () => db, getMailbox: async () => ({ id: 'mb1' }) }))
vi.mock('@/lib/mcp/tools/jobs', async importOriginal => ({ ...(await importOriginal<object>()), getJobSummary: { run: async () => ({ text: 'IRC1079 — Belmont. BAR sent 6 Nov.' }) } }))
vi.mock('@/lib/health/errors', () => ({ logError: vi.fn(async () => {}) }))
const generateCard = vi.fn(async () => ({}))
vi.mock('../propose', () => ({ generateCard }))
vi.mock('../steps', () => ({ discardStepDrafts: vi.fn(async () => {}) }))
const aiCalls: Row[] = []
vi.mock('@/lib/health/ai-usage', () => ({ trackAi: async (meta: Row, call: () => Promise<unknown>) => { aiCalls.push(meta); return call() } }))

const {
  judgeChange, changesFor, readyToCheck, recheckChangedJobs, recheckJob, cardChanges, recordRecheckUndone,
  LOOKS_DONE, QUIET_MS, PRESENT_MS, MAX_WAIT_MS,
} = await import('../recheck')
const { reopenCard } = await import('../cards')
const { confirmCard } = await import('../confirm')

const WRITTEN = '2026-11-02T02:00:00.000Z'
const LATER = '2026-11-06T06:00:00.000Z'

const card = (extra: Row = {}): Row => ({
  id: 'k1', tenant_id: 't1', job_id: 'j1', source: 'email', source_ref: 'th1', status: 'pending', category: 'attend_submit',
  title: 'Finish and send the Belmont BAR', description: 'The BAR is drafted.', steps: [{ id: 's1', tool: 'send_documents', args: {}, summary: 'Send the BAR to Castle', kind: 'change' }],
  starred_by: null, follow_up: null, situation: { kind: 'email', insurer: 'Castle' }, checked_at: WRITTEN, updated_at: WRITTEN, created_at: WRITTEN, attempts: 1, ...extra,
})

/** A model that answers decide_cards with these decisions */
function client(decisions: Row[]) {
  const create = vi.fn(async () => ({ content: [{ type: 'tool_use', id: 'x', name: 'decide_cards', input: { decisions } }], usage: { input_tokens: 10, output_tokens: 5 }, model: 'claude-haiku-5-5' }))
  return { beta: { messages: { create } }, create }
}

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  generateCard.mockClear()
  aiCalls.length = 0
  tables.jobs = [{ id: 'j1', tenant_id: 't1', job_number: 'IRC1079', insurer: 'Castle' }]
  tables.users = [{ id: 'u1', tenant_id: 't1', name: 'Kyle', role: 'admin', created_at: WRITTEN }]
})

const change = (extra: Row) => ({ id: 'x', at: LATER, kind: 'activity', action: null, summary: 'x', thread_id: null, who: null, ...extra }) as never

describe('judgeChange', () => {
  const c = card() as never
  it('reviews sends, stage changes and payments; flags edits; ignores the cards\' own doing', () => {
    expect(judgeChange(c, change({ action: 'send.documents' }))).toBe('review')
    expect(judgeChange(c, change({ action: 'invoice.paid' }))).toBe('review')
    expect(judgeChange(c, change({ action: 'jobs.edit' }))).toBe('flag')
    expect(judgeChange(c, change({ action: 'actions.review' }))).toBe('ignore')
    expect(judgeChange(c, change({ action: 'mail.send' }))).toBe('ignore')
  })
  it('always reviews a note, and emails except on the card\'s own conversation', () => {
    expect(judgeChange(c, change({ kind: 'note' }))).toBe('review')
    expect(judgeChange(c, change({ kind: 'email_in', thread_id: 'other' }))).toBe('review')
    expect(judgeChange(c, change({ kind: 'email_in', thread_id: 'th1' }))).toBe('ignore')
    expect(judgeChange(c, change({ kind: 'email_out', thread_id: 'th1' }))).toBe('ignore')
  })
  it('only counts what happened after the card last saw the job', () => {
    const out = changesFor(card() as never, [change({ kind: 'note', at: '2026-11-01T00:00:00.000Z' }), change({ kind: 'note' }), change({ action: 'jobs.edit' })])
    expect(out.review).toHaveLength(1)
    expect(out.flag).toHaveLength(1)
  })
})

describe('readyToCheck', () => {
  const at = new Date('2026-11-06T08:00:00.000Z')
  const ago = (ms: number) => new Date(at.getTime() - ms).toISOString()
  it('waits for the job to go quiet, and for nobody to have it open', () => {
    expect(readyToCheck({ first_change_at: ago(QUIET_MS * 2), last_change_at: ago(QUIET_MS / 2) }, null, at)).toBe(false)
    expect(readyToCheck({ first_change_at: ago(QUIET_MS * 2), last_change_at: ago(QUIET_MS + 1000) }, null, at)).toBe(true)
    expect(readyToCheck({ first_change_at: ago(QUIET_MS * 2), last_change_at: ago(QUIET_MS + 1000) }, ago(PRESENT_MS / 3), at)).toBe(false)
  })
  it('checks anyway once it has waited long enough', () => {
    expect(readyToCheck({ first_change_at: ago(MAX_WAIT_MS), last_change_at: ago(60_000) }, ago(1000), at)).toBe(true)
  })
})

describe('recheckJob', () => {
  it('leaves the AI out when nothing could have done the card, but shows what happened', async () => {
    tables.action_queue = [card()]
    tables.activity_log = [{ id: 'a1', tenant_id: 't1', job_id: 'j1', user_id: 'u1', action: 'jobs.edit', summary: 'Changed the contact', via: 'app', outcome: 'done', created_at: LATER }]
    const ai = client([])
    const out = await recheckJob(db as never, 't1', 'j1', { client: ai })
    expect(out.aiCall).toBe(false)
    expect(ai.create).not.toHaveBeenCalled()
    const shown = await cardChanges(db as never, 't1', tables.action_queue as never)
    expect(shown.get('k1')?.[0]).toMatchObject({ summary: 'Changed the contact', who: 'Kyle' })
  })

  it('closes a card whose work was done another way, saying what happened', async () => {
    tables.action_queue = [card()]
    tables.activity_log = [{ id: 'a1', tenant_id: 't1', job_id: 'j1', user_id: 'u1', action: 'send.documents', summary: 'Sent the BAR and quote to Castle', via: 'app', outcome: 'done', created_at: LATER }]
    const ai = client([{ card_id: 'k1', verdict: 'done', reason: 'The BAR and quote were sent to Castle on Thu 6 Nov.' }])
    const out = await recheckJob(db as never, 't1', 'j1', { client: ai })
    expect(out).toMatchObject({ aiCall: true, reviewed: 1, closed: 1 })
    expect(tables.action_queue[0]).toMatchObject({ status: 'done', outcome: `${LOOKS_DONE}The BAR and quote were sent to Castle on Thu 6 Nov.` })
    expect(aiCalls[0]).toMatchObject({ feature: 'card-recheck', tenantId: 't1', jobId: 'j1' })
    const prompt = (ai.create.mock.calls[0] as unknown as [{ messages: { content: string }[] }])[0].messages[0].content
    expect(prompt).toContain('Sent the BAR and quote to Castle')
    expect(prompt).toContain('card_id: k1')
  })

  it('never closes a card the user starred — it just says it may be done', async () => {
    tables.action_queue = [card({ starred_by: 'u1' })]
    tables.communications = [{ id: 'n1', tenant_id: 't1', job_id: 'j1', type: 'note', content: 'Sent the BAR by hand', created_at: LATER, created_by: 'u1' }]
    await recheckJob(db as never, 't1', 'j1', { client: client([{ card_id: 'k1', verdict: 'done', reason: 'A note says the BAR was sent.' }]) })
    expect(tables.action_queue[0].status).toBe('pending')
    expect(tables.action_queue[0].description).toMatch(/^IRC thinks this may be done: A note says the BAR was sent\./)
  })

  it('closes a duplicate in favour of the other card, and remakes a card whose steps are out of date', async () => {
    tables.action_queue = [card(), card({ id: 'k2', source_ref: 'th2', title: 'Send the BAR' }), card({ id: 'k3', source_ref: 'th3', title: 'Quote the gutters' })]
    tables.communications = [{ id: 'e1', tenant_id: 't1', job_id: 'j1', type: 'email', direction: 'inbound', subject: 'Re: gutters', thread_id: 'th9', created_at: LATER }]
    await recheckJob(db as never, 't1', 'j1', {
      client: client([
        { card_id: 'k1', verdict: 'still_needed', reason: 'Not sent yet.' },
        { card_id: 'k2', verdict: 'duplicate', reason: 'Same as k1.', duplicate_of: 'k1' },
        { card_id: 'k3', verdict: 'update', reason: 'Castle now wants the gutters quoted with the fascia.' },
      ]),
    })
    const [k1, k2, k3] = tables.action_queue
    expect(k1.status).toBe('pending')
    expect(k2).toMatchObject({ status: 'no_action', outcome: 'Same as another card: "Finish and send the Belmont BAR"' })
    expect(k3.status).toBe('generating')
    expect(generateCard).toHaveBeenCalledWith(expect.objectContaining({ id: 'k3' }), expect.objectContaining({ since: 'Castle now wants the gutters quoted with the fascia.' }))
  })

  it('leaves Midcity\'s jobs alone', async () => {
    tables.jobs[0].insurer = 'Midcity'
    tables.action_queue = [card()]
    tables.communications = [{ id: 'n1', tenant_id: 't1', job_id: 'j1', type: 'note', content: 'x', created_at: LATER }]
    const ai = client([{ card_id: 'k1', verdict: 'done', reason: 'x' }])
    expect((await recheckJob(db as never, 't1', 'j1', { client: ai })).aiCall).toBe(false)
  })
})

describe('recheckChangedJobs', () => {
  const at = new Date('2026-11-06T08:00:00.000Z')
  it('takes only jobs gone quiet with nobody on them, once each', async () => {
    const quiet = new Date(at.getTime() - QUIET_MS - 60_000).toISOString()
    tables.jobs.push({ id: 'j2', tenant_id: 't1', job_number: 'IRC1080', insurer: 'Castle' }, { id: 'j3', tenant_id: 't1', job_number: 'IRC1081', insurer: 'Castle' })
    tables.job_card_rechecks = [
      { job_id: 'j1', tenant_id: 't1', first_change_at: quiet, last_change_at: quiet },
      { job_id: 'j2', tenant_id: 't1', first_change_at: quiet, last_change_at: new Date(at.getTime() - 60_000).toISOString() },
      { job_id: 'j3', tenant_id: 't1', first_change_at: quiet, last_change_at: quiet },
    ]
    tables.job_presence = [{ job_id: 'j3', user_id: 'u1', tenant_id: 't1', seen_at: new Date(at.getTime() - 30_000).toISOString() }]
    tables.action_queue = []
    const out = await recheckChangedJobs({ db: db as never, at, client: client([]) })
    expect(out.map(r => r.jobId)).toEqual(['j1'])
    expect(tables.job_card_rechecks.map(r => r.job_id)).toEqual(['j2', 'j3'])
  })
})

describe('putting a closed card back', () => {
  it('is learned from when IRC closed it', async () => {
    tables.action_queue = [card({ status: 'done', outcome: `${LOOKS_DONE}The BAR was sent.` })]
    const back = await reopenCard(db as never, 't1', 'k1', 'u1')
    expect(back.status).toBe('pending')
    expect(tables.learning_events?.[0]).toMatchObject({ feature: 'card_recheck', source_id: 'k1', outcome: 'edited', user_id: 'u1' })
  })
  it('isn\'t when a person closed it', async () => {
    await recordRecheckUndone(db as never, card({ status: 'skipped', outcome: 'Skipped' }) as never, 'u1')
    expect(tables.learning_events ?? []).toHaveLength(0)
  })
})

describe('confirming a card after the job moved on', () => {
  const tool = { name: 'send_documents', title: 'Send documents', description: '', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: false }, run: vi.fn(async () => ({ text: 'Sent.' })) }
  it('asks first, then does it when told to', async () => {
    tables.action_queue = [card()]
    tables.activity_log = [{ id: 'a1', tenant_id: 't1', job_id: 'j1', user_id: 'u1', action: 'send.documents', summary: 'Sent the BAR to Castle', via: 'app', outcome: 'done', created_at: LATER }]
    await expect(confirmCard('t1', 'u1', 'k1', [{ id: 's1' }], { db: db as never, tools: [tool as never] }))
      .rejects.toMatchObject({ status: 409, code: 'changed_since', changes: [expect.stringContaining('Sent the BAR to Castle')] })
    expect(tool.run).not.toHaveBeenCalled()
    expect(tables.action_queue[0].status).toBe('pending')
  })
})
