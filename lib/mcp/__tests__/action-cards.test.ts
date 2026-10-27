import { describe, it, expect, vi, beforeEach } from 'vitest'

// Action card tools: they use the Action cards view's own functions
// (lib/actions), say what each card will do, pass edits through, and log
// voice-run steps as voice.

const CARD_ID = '11111111-2222-3333-4444-555555555555'
const card = (o: Record<string, unknown> = {}) => ({
  id: CARD_ID, tenant_id: 't1', job_id: 'j1', source: 'email', source_ref: 'abc1', trigger_ref: 'm1',
  title: 'Reply to Casey — confirm Thursday access', description: 'Casey asks about Thursday.', reasoning: 'Inspection is booked Thursday.',
  status: 'pending', category: 'attend_submit', starred_by: null, priority: 90, outcome: null, error_log: null, attempts: 1,
  created_at: '2026-10-23T00:00:00Z', updated_at: '2026-10-23T00:00:00Z',
  steps: [
    { id: 's1', tool: 'send_email', kind: 'email', summary: 'Reply to casey@gmail.com', args: { mode: 'reply', conversation_id: 'abc1', to: 'casey@gmail.com', subject: 'Re: Access', body: 'Hi Casey, Thursday works.' } },
    { id: 's2', tool: 'add_job_note', kind: 'change', summary: 'Add job note — Access Thursday', args: { job_number: 'IRC1001', note: 'Access Thursday' } },
  ],
  job: { id: 'j1', job_number: 'IRC1001', insured_name: 'Casey Smith' },
  conversation: { subject: 'Access Thursday?', from: 'Casey Smith', last_message_at: '2026-10-23T00:00:00Z', unread: true },
  ...o,
})

let stored: ReturnType<typeof card> | null
const listCards = vi.fn(async () => (stored ? [stored] : []))
const skipCard = vi.fn(async () => stored?.status === 'pending')
let starredNow: string[] = []
const starThread = vi.fn(async (_db: unknown, _t: string, id: string, category: string | null) => (category ? { id: 'k', status: 'queued', title: `Email ${id}`, category } : null))
const confirmCard = vi.fn(async (_t: string, _u: string, _id: string, choices: { id: string; args?: Record<string, unknown> }[]) => ({
  ...stored!, status: 'done', outcome: `${choices.length} steps done`,
  steps: stored!.steps.map(s => (choices.some(c => c.id === s.id) ? { ...s, status: 'done', result: 'Done.' } : { ...s, status: 'skipped' })),
}))
vi.mock('@/lib/actions/cards', () => ({
  listCards: (...a: unknown[]) => (listCards as (...x: unknown[]) => unknown)(...a),
  getCard: async (_db: unknown, _t: string, id: string) => (stored && id === stored.id ? stored : null),
  cardForThread: async (_db: unknown, _t: string, id: string) => (stored && id === stored.source_ref ? stored : null),
  withContext: async (_db: unknown, _t: string, cards: unknown[]) => cards,
  skipCard: (...a: unknown[]) => (skipCard as (...x: unknown[]) => unknown)(...a),
  starThread: (...a: unknown[]) => (starThread as (...x: unknown[]) => unknown)(...a),
  cardsForThreads: async (_db: unknown, _t: string, ids: string[]) => Object.fromEntries(ids.filter(id => starredNow.includes(id)).map(id => [id, { id: 'k', status: 'pending', title: `Card ${id}`, category: 'other' }])),
  isCategory: (v: unknown) => ['invoice', 'attend_submit', 'other'].includes(v as string),
  updateCardText: (...a: unknown[]) => (updateCardText as (...x: unknown[]) => unknown)(...a),
  markCardDone: (...a: unknown[]) => (markCardDone as (...x: unknown[]) => unknown)(...a),
  reopenCard: (...a: unknown[]) => (reopenCard as (...x: unknown[]) => unknown)(...a),
  setCardCategory: async () => true,
  CATEGORIES: [{ key: 'invoice', label: 'Invoices to pay' }, { key: 'attend_submit', label: 'Attend and Submit' }, { key: 'other', label: 'Everything else' }],
}))
const updateCardText = vi.fn(async (_db: unknown, _t: string, _id: string, o: { title?: string }) => (stored = { ...stored!, ...(o.title ? { title: o.title } : {}) }))
const markCardDone = vi.fn(async () => stored?.status === 'pending')
const reopenCard = vi.fn(async () => (stored = { ...stored!, status: 'pending' }))
const removeSteps = vi.fn(async (_t: string, _id: string, ids: string[]) => (stored = { ...stored!, steps: stored!.steps.filter(x => !ids.includes(x.id)) }))
const saveStepEdits = vi.fn(async (_t: string, _id: string, stepId: string, edits: Record<string, unknown>) =>
  (stored = { ...stored!, steps: stored!.steps.map(x => (x.id === stepId ? { ...x, args: { ...x.args, ...edits }, summary: `Add job note — ${edits.note}` } : x)) }))
const addStep = vi.fn(async (_t: string, _id: string, tool: string, args: Record<string, unknown>) => {
  if (tool === 'get_job_summary') throw new (await import('@/lib/actions/confirm')).CardError('"get_job_summary" can\'t be a step')
  return (stored = { ...stored!, steps: [...stored!.steps, { id: 's3', tool, kind: 'change', summary: `Add job note — ${args.note}`, args }] })
})
const resuggestCard = vi.fn(async (_db: unknown, _t: string, _target: unknown, feedback: string) => (stored = { ...stored!, title: `Redone: ${feedback}`, steps: [] }))
vi.mock('@/lib/actions/steps', () => ({
  removeSteps: (...a: unknown[]) => (removeSteps as (...x: unknown[]) => unknown)(...a),
  saveStepEdits: (...a: unknown[]) => (saveStepEdits as (...x: unknown[]) => unknown)(...a),
  addStep: (...a: unknown[]) => (addStep as (...x: unknown[]) => unknown)(...a),
}))
vi.mock('@/lib/actions/propose', () => ({ resuggestCard: (...a: unknown[]) => (resuggestCard as (...x: unknown[]) => unknown)(...a) }))
vi.mock('@/lib/actions/confirm', () => {
  class CardError extends Error {}
  return { CardError, confirmCard: (...a: unknown[]) => (confirmCard as (...x: unknown[]) => unknown)(...a) }
})

const ctx = { supabase: {} as never, tenantId: 't1', userId: 'u1', voiceKeyId: 'k9' }
const { listActionCards, readActionCard, confirmActionCard, skipActionCard, starEmail, updateActionCard } = await import('../tools/action-cards')

beforeEach(() => {
  stored = card()
  for (const f of [listCards, skipCard, confirmCard, starThread, updateCardText, markCardDone, reopenCard, removeSteps, saveStepEdits, addStep, resuggestCard]) f.mockClear()
  starredNow = []
})

describe('list_action_cards', () => {
  it('lists what needs doing, with the job, sender and steps', async () => {
    const out = await listActionCards.run({}, ctx)
    expect(listCards).toHaveBeenCalledWith(ctx.supabase, 't1', 'pending', { category: null })
    expect(out.text).toBe('1 action card needs you:\n1. Reply to Casey — confirm Thursday access (IRC1001, Casey Smith: "Access Thursday?") [Attend and Submit, urgent]. Steps: Reply to casey@gmail.com; Add job note — Access Thursday.')
    expect((out.data!.cards as { card_id: string }[])[0].card_id).toBe(CARD_ID)
  })

  it('says when nothing needs doing', async () => {
    stored = null
    expect((await listActionCards.run({ category: 'invoice' }, ctx)).text).toBe('No Invoices to pay cards need you right now.')
    expect(listCards).toHaveBeenCalledWith(ctx.supabase, 't1', 'pending', { category: 'invoice' })
  })
})

describe('read_action_card', () => {
  it('reads the steps exactly, including the draft email', async () => {
    const out = await readActionCard.run({ card_id: CARD_ID }, ctx)
    expect(out.text).toContain('Why: Inspection is booked Thursday.')
    expect(out.text).toContain('Step 1: Reply to casey@gmail.com.\nTo: casey@gmail.com\nSubject: Re: Access\nBody:\nHi Casey, Thursday works.')
    expect(out.text).toContain('Step 2: Add job note — Access Thursday.\nNote: Access Thursday')
  })

  it('reads an email edited in the app as its draft says', async () => {
    stored = card()
    stored.steps[0] = { ...stored.steps[0], draft: { id: 'r-1', to: 'casey@gmail.com', cc: 'jo@insurer.com', bcc: '', subject: 'Re: Access', html: '<p>Hi Casey,</p><p>Friday instead.</p>' } } as never
    const out = await readActionCard.run({ card_id: CARD_ID }, ctx)
    expect(out.text).toContain('Edited in the app. To: casey@gmail.com, cc jo@insurer.com\nSubject: Re: Access\nBody:\nHi Casey,\nFriday instead.')
    expect(out.text).not.toContain('Thursday works')
  })

  it('finds a card by its conversation, and refuses unknown ones', async () => {
    expect((await readActionCard.run({ conversation_id: 'abc1' }, ctx)).isError).toBeUndefined()
    expect(await readActionCard.run({ conversation_id: 'zzz9' }, ctx)).toMatchObject({ isError: true, text: 'That conversation has no action card.' })
    expect((await readActionCard.run({ card_id: 'nope' }, ctx)).isError).toBe(true)
    expect((await readActionCard.run({}, ctx)).isError).toBe(true)
  })
})

describe('confirm_action_card', () => {
  it('does every step not done yet, logged as voice', async () => {
    const out = await confirmActionCard.run({ card_id: CARD_ID }, ctx)
    expect(confirmCard.mock.calls[0].slice(0, 4)).toEqual(['t1', 'u1', CARD_ID, [{ id: 's1', args: undefined }, { id: 's2', args: undefined }]])
    expect((confirmCard.mock.calls[0] as unknown[])[4]).toMatchObject({ via: 'voice', voiceKeyId: 'k9' })
    expect(out.text).toBe('2 steps done.\n- Reply to casey@gmail.com: done\n- Add job note — Access Thursday: done')
  })

  it('does only the chosen steps, with changes, and logs chat as the app', async () => {
    await confirmActionCard.run({ card_id: CARD_ID, step_ids: ['s1'], changes: [{ step_id: 's1', body: 'Hi Casey, 10am instead.', mode: 'forward' }] }, { ...ctx, via: 'chat' })
    expect(confirmCard.mock.calls[0][3]).toEqual([{ id: 's1', args: { body: 'Hi Casey, 10am instead.' } }])
    expect((confirmCard.mock.calls[0] as unknown[])[4]).toMatchObject({ via: 'chat' })
  })

  it('refuses steps that are not on the card, or a card with none', async () => {
    expect((await confirmActionCard.run({ card_id: CARD_ID, step_ids: ['s9'] }, ctx)).isError).toBe(true)
    stored = card({ steps: [] })
    expect((await confirmActionCard.run({ card_id: CARD_ID }, ctx)).isError).toBe(true)
    expect(confirmCard).not.toHaveBeenCalled()
  })
})

describe('skip_action_card', () => {
  it('skips a card that can still change', async () => {
    expect((await skipActionCard.run({ card_id: CARD_ID }, ctx)).text).toBe('Skipped "Reply to Casey — confirm Thursday access".')
    expect(skipCard).toHaveBeenCalledWith(ctx.supabase, 't1', CARD_ID, 'u1')
    stored = card({ status: 'done' })
    expect(await skipActionCard.run({ card_id: CARD_ID }, ctx)).toMatchObject({ isError: true, text: "That card is done — it can't be skipped now." })
  })
})

describe('star_email', () => {
  it('stars conversations under a star, as the user', async () => {
    const out = await starEmail.run({ conversation_ids: ['abc1'], star: 'invoice' }, ctx)
    expect(starThread.mock.calls[0].slice(1)).toEqual(['t1', 'abc1', 'invoice', 'u1'])
    expect(out.text).toBe('Starred 1 email as Invoices to pay ("Email abc1").')
  })

  it('takes stars off only where there is one', async () => {
    starredNow = ['abc1']
    const out = await starEmail.run({ conversation_ids: ['abc1', 'def2'], star: 'none' }, ctx)
    expect(starThread.mock.calls.map(c => c.slice(2, 4))).toEqual([['abc1', null]])
    expect(out.text).toBe('Took the star off 1 email.')
    starredNow = []
    expect((await starEmail.run({ conversation_ids: ['abc1'], star: 'none' }, ctx)).text).toBe('None of those were starred.')
  })

  it('refuses an unknown star or no conversations', async () => {
    expect((await starEmail.run({ conversation_ids: ['abc1'], star: 'gold' }, ctx)).isError).toBe(true)
    expect((await starEmail.run({ conversation_ids: ['not an id'], star: 'other' }, ctx)).isError).toBe(true)
    expect(starThread).not.toHaveBeenCalled()
  })
})

describe('update_action_card', () => {
  it('retitles a card and fixes its steps without doing them', async () => {
    const out = await updateActionCard.run({
      card_id: CARD_ID, title: 'Reply to Casey — Friday instead',
      remove_steps: ['s1'], change_steps: [{ step_id: 's2', args: { note: 'Access Friday' } }],
      add_steps: [{ tool: 'add_job_note', args: { job_number: 'IRC1001', note: 'Key under mat' } }],
    }, ctx)
    expect(out.isError).toBeFalsy()
    expect(removeSteps).toHaveBeenCalledWith('t1', CARD_ID, ['s1'], { db: ctx.supabase })
    expect(saveStepEdits).toHaveBeenCalledWith('t1', CARD_ID, 's2', { note: 'Access Friday' }, { db: ctx.supabase })
    expect(addStep).toHaveBeenCalledWith('t1', CARD_ID, 'add_job_note', { job_number: 'IRC1001', note: 'Key under mat' }, { db: ctx.supabase })
    expect(out.text).toContain('removed "Reply to casey@gmail.com", changed "Add job note — Access Friday", added "Add job note — Key under mat", retitled it "Reply to Casey — Friday instead"')
    expect(out.text).toContain('Steps: Add job note — Access Friday; Add job note — Key under mat.')
    expect(confirmCard).not.toHaveBeenCalled()
  })

  it('has the AI redo the card from what the user says', async () => {
    const before = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'k'
    const out = await updateActionCard.run({ card_id: CARD_ID, redo_with: 'they want a quote' }, ctx)
    process.env.ANTHROPIC_API_KEY = before
    expect(resuggestCard).toHaveBeenCalledWith(ctx.supabase, 't1', { cardId: CARD_ID }, 'they want a quote')
    expect(out.text).toContain('had the AI redo it')
    expect((await updateActionCard.run({ card_id: CARD_ID, redo_with: 'x', remove_steps: ['s1'] }, ctx)).isError).toBe(true)
  })

  it('marks a card done, or puts a done one back on the list', async () => {
    expect((await updateActionCard.run({ card_id: CARD_ID, status: 'done' }, ctx)).text).toContain('marked it done')
    expect(markCardDone).toHaveBeenCalledWith(ctx.supabase, 't1', CARD_ID, 'u1')
    stored = card({ status: 'skipped' })
    expect((await updateActionCard.run({ card_id: CARD_ID, status: 'pending' }, ctx)).text).toContain('put it back on the list')
    expect(reopenCard).toHaveBeenCalled()
  })

  it('says what went wrong, and what was already done', async () => {
    const out = await updateActionCard.run({ card_id: CARD_ID, remove_steps: ['s1'], add_steps: [{ tool: 'get_job_summary', args: {} }] }, ctx)
    expect(out).toMatchObject({ isError: true })
    expect(out.text).toBe('"get_job_summary" can\'t be a step. Before that: removed "Reply to casey@gmail.com".')
    expect((await updateActionCard.run({ card_id: CARD_ID }, ctx)).isError).toBe(true)
  })
})
