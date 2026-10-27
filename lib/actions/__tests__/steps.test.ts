import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from '@/lib/mcp/__tests__/fake-supabase'

// A step opened on an action card: its details as a form from its tool's
// schema, a preview of what it acts on, changes saved on the card (never run
// here), an email step's composer draft, and correcting the order before
// it's lodged — through the correcting tool, as the user.

const tables: Record<string, Row[]> = {}
const db = fakeSupabase(tables)

const tool = (name: string, readOnly: boolean, properties: Record<string, unknown>, run: (args: Row) => { text: string; data?: Record<string, unknown>; isError?: boolean } = () => ({ text: 'ok' })) => ({
  name, title: name.replace(/_/g, ' '), description: name, inputSchema: { type: 'object', properties },
  annotations: { readOnlyHint: readOnly }, run: vi.fn(async (args: Row) => run(args)),
})
const S = { type: 'string' }
const ORDER = { order_id: 'o1', claim_number: 'CLM1', insurer: 'Allianz', property_address: '3 Elm St', insured_name: 'Casey', wo_type: 'BAR', excess_building: 500, warnings: ['No insured email.'] }
const TOOLS = [
  tool('add_job_note', false, { job_number: S, note: S }),
  tool('send_work_order', false, { work_order_id: S, to: S, subject: S, body: S, include_photos: { type: 'boolean' } }),
  tool('get_work_order_email', true, { work_order_id: S }, () => ({ text: 'Roofer — $1,200. Subject: Work order', data: { to: 'roofer@trade.com', subject: 'Work order', body: 'Hi Roofer\n{signature}' } })),
  tool('lodge_order', false, { order_id: S }),
  tool('list_insurer_orders', true, {}, () => ({ text: '1 order', data: { orders: [ORDER] } })),
  tool('update_insurer_order', false, { order_id: S, claim_number: S, insurer: S, excess_building: { type: 'number' }, wo_type: { type: 'string', enum: ['BAR', 'make_safe'] } }, () => ({ text: 'Updated (Claim number: CLM2).' })),
  tool('send_email', false, { mode: S, conversation_id: S, to: S, cc: S, subject: S, body: S, draft_id: S, send_anyway: { type: 'boolean' } }),
]

const callTool = vi.fn(async (t: { run(a: Row): unknown }, args: Row) => t.run(args))
vi.mock('@/lib/mcp/server', () => ({ callTool: (t: never, a: never) => callTool(t, a) }))
vi.mock('@/lib/mcp/tools', () => ({ MCP_TOOLS: TOOLS }))
vi.mock('../propose', () => ({
  describeStep: (t: { title: string }, a: Row) => ({ summary: `${t.title}${a.to ? ` to ${a.to}` : ''}${a.note ? ` — ${a.note}` : ''}`, kind: 'change' }),
  isStepTool: (t: { annotations: { readOnlyHint?: boolean } }) => !t.annotations.readOnlyHint,
}))
vi.mock('@/lib/mail/sync', () => ({ getMailbox: async () => ({ id: 'mb1', tenant_id: 't1' }), mailDb: () => db }))
vi.mock('@/lib/mail/list', () => ({ getThreadDetail: async () => ({ messages: [{ id: 'm1', labelIds: ['INBOX'] }, { id: 'm2', labelIds: ['DRAFT'] }] }) }))
const discarded: string[] = []
vi.mock('@/lib/mail/compose', async () => {
  const { emptyCompose } = await import('@/lib/mail/compose-rules')
  class ComposeError extends Error {}
  return {
    ComposeError,
    startCompose: vi.fn(async (_m: unknown, mode: string, messageId: string, jobId: string) => ({ ...emptyCompose(), mode, quoteMessageId: messageId, jobId, to: 'Casey <casey@gmail.com>', subject: 'Re: Access', quoteHtml: '<p>q</p>' })),
    openDraft: vi.fn(async (_m: unknown, _t: string, id: string) => {
      if (id === 'gone') throw new ComposeError('This draft no longer exists')
      return { ...emptyCompose(), draftId: id, body: '<p>Saved draft</p>', quoteHtml: '' }
    }),
    discardDraft: vi.fn(async (_m: unknown, id: string) => { discarded.push(id) }),
  }
})
vi.mock('@/lib/mcp/tools/job-attachments', () => ({ hasAttachArgs: () => false, loadJobAttachments: async () => [], fitJobAttachments: async () => ({ kept: [], skipped: [] }), storeJobAttachments: async () => [] }))

const { stepDetail, saveStepEdits, saveStepDraft, stepCompose, updateStepRecord, discardStepDrafts, addStep, removeSteps } = await import('../steps')
const { stepFields, cleanEdits } = await import('../step-fields')

const card = (steps: Row[], o: Row = {}) => {
  tables.action_queue = [{ id: 'k1', tenant_id: 't1', job_id: 'j1', source: 'email', source_ref: 'th1', status: 'pending', steps, updated_at: 'then', ...o }]
}
const opts = { db: db as never, tools: TOOLS as never }

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  callTool.mockClear()
  discarded.length = 0
})

describe('step fields', () => {
  it('turns the tool schema into a form, leaving out ids and are-you-sure switches', () => {
    const fields = stepFields(TOOLS[1].inputSchema, { work_order_id: 'w1', include_photos: false })
    expect(fields.map(f => [f.key, f.type, f.value])).toEqual([
      ['to', 'text', null], ['subject', 'text', null], ['body', 'textarea', null], ['include_photos', 'checkbox', false],
    ])
    expect(stepFields(TOOLS[6].inputSchema, {}).map(f => f.key)).toEqual(['mode', 'to', 'cc', 'subject', 'body'])
  })

  it('keeps only changes a person may make, as the tool expects them', () => {
    expect(cleanEdits(TOOLS[5].inputSchema, { order_id: 'x', excess_building: '$1,000', claim_number: '', other: 'y' }))
      .toEqual({ excess_building: 1000, claim_number: null })
  })
})

describe('stepDetail', () => {
  it('previews a work order with its standard email, ready to change', async () => {
    card([{ id: 's1', tool: 'send_work_order', args: { work_order_id: 'w1' }, summary: 'Send work order', kind: 'change' }])
    const d = await stepDetail('t1', 'u1', 'k1', 's1', opts)
    expect(d.preview?.text).toMatch(/Roofer/)
    expect(d.fields.find(f => f.key === 'body')?.value).toBe('Hi Roofer\n{signature}')
    expect(TOOLS[1].run).not.toHaveBeenCalled()
  })

  it('shows the order to lodge, its fields to correct and its warnings', async () => {
    card([{ id: 's1', tool: 'lodge_order', args: { order_id: 'o1' }, summary: 'Lodge order', kind: 'change' }])
    const d = await stepDetail('t1', 'u1', 'k1', 's1', opts)
    expect(d.record?.warnings).toEqual(['No insured email.'])
    expect(d.record?.fields.map(f => [f.key, f.value])).toEqual([['claim_number', 'CLM1'], ['insurer', 'Allianz'], ['excess_building', 500], ['wo_type', 'BAR']])
  })

  it('shows a note in full', async () => {
    card([{ id: 's1', tool: 'add_job_note', args: { job_number: 'IRC1001', note: 'Waiting on the insurer' }, summary: 'Add job note', kind: 'change' }])
    const d = await stepDetail('t1', 'u1', 'k1', 's1', opts)
    expect(d.fields.find(f => f.key === 'note')).toMatchObject({ type: 'textarea', value: 'Waiting on the insurer' })
  })
})

describe('changing a step', () => {
  it('saves allowed changes and a new summary, without running anything or touching updated_at', async () => {
    card([{ id: 's1', tool: 'add_job_note', args: { job_number: 'IRC1001', note: 'old' }, summary: 'x', kind: 'change' }])
    const updated = await saveStepEdits('t1', 'k1', 's1', { note: 'Waiting on approval', job_number: '' }, opts)
    expect(updated.steps[0]).toMatchObject({ args: { note: 'Waiting on approval' }, summary: 'add job note — Waiting on approval' })
    expect(tables.action_queue[0].updated_at).toBe('then')
    expect(TOOLS[0].run).not.toHaveBeenCalled()
  })

  it('refuses a step that has run, or a card not to do', async () => {
    card([{ id: 's1', tool: 'add_job_note', args: {}, summary: 'x', kind: 'change', status: 'done' }])
    await expect(saveStepEdits('t1', 'k1', 's1', { note: 'n' }, opts)).rejects.toMatchObject({ status: 409 })
    card([{ id: 's1', tool: 'add_job_note', args: {}, summary: 'x', kind: 'change' }], { status: 'done' })
    await expect(saveStepEdits('t1', 'k1', 's1', { note: 'n' }, opts)).rejects.toMatchObject({ status: 409 })
  })

  it('keeps and clears an email step\'s composer draft', async () => {
    card([{ id: 's1', tool: 'send_email', args: { mode: 'reply', body: 'AI' }, summary: 'Reply', kind: 'email' }])
    const draft = { id: 'r-1', to: 'casey@gmail.com', cc: '', bcc: '', subject: 'Re: Access', html: '<p>Mine</p>' }
    const kept = await saveStepDraft('t1', 'k1', 's1', draft, opts)
    expect(kept.steps[0]).toMatchObject({ draft, summary: 'send email to casey@gmail.com' })
    const cleared = await saveStepDraft('t1', 'k1', 's1', null, opts)
    expect(cleared.steps[0].draft).toBeUndefined()
  })

  it('corrects the order through its tool, as the user', async () => {
    card([{ id: 's1', tool: 'lodge_order', args: { order_id: 'o1' }, summary: 'Lodge', kind: 'change' }])
    const out = await updateStepRecord('t1', 'u1', 'k1', 's1', { claim_number: 'CLM2', order_id: 'other' }, opts)
    expect(callTool.mock.calls[0][1]).toEqual({ claim_number: 'CLM2', order_id: 'o1' })
    expect(out).toEqual({ text: 'Updated (Claim number: CLM2).', ok: true })
  })
})

describe('an email step in the composer', () => {
  it('starts from the AI\'s reply to the latest message, filed on the card\'s job', async () => {
    card([{ id: 's1', tool: 'send_email', args: { mode: 'reply', conversation_id: 'th1', body: 'Hi Casey\nThursday works' }, summary: 'Reply', kind: 'email' }])
    const start = await stepCompose('t1', 'k1', 's1', db as never)
    expect(start).toMatchObject({ mode: 'reply', quoteMessageId: 'm1', jobId: 'j1', to: 'Casey <casey@gmail.com>', body: '<p>Hi Casey</p><p>Thursday works</p>' })
  })

  it('reopens its draft, or starts again if the draft has gone', async () => {
    card([{ id: 's1', tool: 'send_email', args: { mode: 'reply', body: 'AI' }, summary: 'Reply', kind: 'email', draft: { id: 'r-1' } }])
    expect((await stepCompose('t1', 'k1', 's1', db as never)).body).toBe('<p>Saved draft</p>')
    card([{ id: 's1', tool: 'send_email', args: { mode: 'reply', body: 'AI' }, summary: 'Reply', kind: 'email', draft: { id: 'gone' } }])
    expect((await stepCompose('t1', 'k1', 's1', db as never)).body).toBe('<p>AI</p>')
  })

  it('discards drafts of unsent emails when the card goes', async () => {
    await discardStepDrafts({ tenant_id: 't1', steps: [
      { id: 's1', draft: { id: 'r-1' } }, { id: 's2', draft: { id: 'r-2' }, status: 'done' }, { id: 's3' },
    ] } as never, db as never)
    expect(discarded).toEqual(['r-1'])
  })
})

describe('the step list', () => {
  it('adds a step from an action tool, with only its own arguments and the card\'s conversation', async () => {
    card([{ id: 's1', tool: 'add_job_note', args: { note: 'a' }, summary: 'x', kind: 'change' }])
    const updated = await addStep('t1', 'k1', 'send_email', { mode: 'reply', body: 'Hi Casey', bogus: 1 }, opts)
    expect(updated.steps).toHaveLength(2)
    expect(updated.steps[1]).toMatchObject({ tool: 'send_email', args: { mode: 'reply', body: 'Hi Casey', conversation_id: 'th1' }, kind: 'change' })
    expect(updated.steps[1].args).not.toHaveProperty('bogus')
    expect(updated.steps[1].id).toMatch(/^[0-9a-f-]{36}$/)
    expect(TOOLS.find(t => t.name === 'send_email')!.run).not.toHaveBeenCalled()
  })

  it('refuses read tools, unknown tools and a closed card', async () => {
    card([])
    await expect(addStep('t1', 'k1', 'get_work_order_email', {}, opts)).rejects.toThrow('can\'t be a step')
    await expect(addStep('t1', 'k1', 'nope', {}, opts)).rejects.toThrow('can\'t be a step')
    card([], { status: 'done' })
    await expect(addStep('t1', 'k1', 'add_job_note', { note: 'n' }, opts)).rejects.toMatchObject({ status: 409 })
  })

  it('removes steps not yet done, discarding their email drafts', async () => {
    card([
      { id: 's1', tool: 'send_email', args: {}, summary: 'Reply', kind: 'email', draft: { id: 'r-9', to: '', cc: '', bcc: '', subject: '', html: '' } },
      { id: 's2', tool: 'add_job_note', args: {}, summary: 'Note', kind: 'change' },
      { id: 's3', tool: 'add_job_note', args: {}, summary: 'Done note', kind: 'change', status: 'done' },
    ])
    discarded.length = 0
    const updated = await removeSteps('t1', 'k1', ['s1'], opts)
    expect(updated.steps.map((x: { id: string }) => x.id)).toEqual(['s2', 's3'])
    expect(discarded).toEqual(['r-9'])
    await expect(removeSteps('t1', 'k1', ['s3'], opts)).rejects.toMatchObject({ status: 409 })
    await expect(removeSteps('t1', 'k1', ['zz'], opts)).rejects.toMatchObject({ status: 404 })
  })
})
