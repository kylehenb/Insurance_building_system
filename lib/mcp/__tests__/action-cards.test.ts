import { describe, it, expect, vi, beforeEach } from 'vitest'

// Action card tools: they use the Action cards view's own functions
// (lib/actions), say what each card will do, pass edits through, and log
// voice-run steps as voice.

const CARD_ID = '11111111-2222-3333-4444-555555555555'
const card = (o: Record<string, unknown> = {}) => ({
  id: CARD_ID, tenant_id: 't1', job_id: 'j1', source: 'email', source_ref: 'abc1', trigger_ref: 'm1',
  title: 'Reply to Casey — confirm Thursday access', description: 'Casey asks about Thursday.', reasoning: 'Inspection is booked Thursday.',
  status: 'pending', priority: 90, snoozed_until: null, outcome: null, error_log: null, attempts: 1,
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
const snoozeCard = vi.fn(async () => stored?.status === 'pending')
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
  snoozeCard: (...a: unknown[]) => (snoozeCard as (...x: unknown[]) => unknown)(...a),
}))
vi.mock('@/lib/actions/confirm', () => {
  class CardError extends Error {}
  return { CardError, confirmCard: (...a: unknown[]) => (confirmCard as (...x: unknown[]) => unknown)(...a) }
})

const ctx = { supabase: {} as never, tenantId: 't1', userId: 'u1', voiceKeyId: 'k9' }
const { listActionCards, readActionCard, confirmActionCard, dismissActionCard } = await import('../tools/action-cards')

beforeEach(() => {
  stored = card()
  for (const f of [listCards, skipCard, snoozeCard, confirmCard]) f.mockClear()
})

describe('list_action_cards', () => {
  it('lists what needs doing, with the job, sender and steps', async () => {
    const out = await listActionCards.run({}, ctx)
    expect(listCards).toHaveBeenCalledWith(ctx.supabase, 't1', 'pending')
    expect(out.text).toBe('1 action card needs you:\n1. Reply to Casey — confirm Thursday access (IRC1001, Casey Smith: "Access Thursday?") [urgent]. Steps: Reply to casey@gmail.com; Add job note — Access Thursday.')
    expect((out.data!.cards as { card_id: string }[])[0].card_id).toBe(CARD_ID)
  })

  it('says when nothing needs doing', async () => {
    stored = null
    expect((await listActionCards.run({ view: 'snoozed' }, ctx)).text).toBe('No snoozed action cards.')
  })
})

describe('read_action_card', () => {
  it('reads the steps exactly, including the draft email', async () => {
    const out = await readActionCard.run({ card_id: CARD_ID }, ctx)
    expect(out.text).toContain('Why: Inspection is booked Thursday.')
    expect(out.text).toContain('Step 1: Reply to casey@gmail.com.\nTo: casey@gmail.com\nSubject: Re: Access\nBody:\nHi Casey, Thursday works.')
    expect(out.text).toContain('Step 2: Add job note — Access Thursday.\nNote: Access Thursday')
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

describe('dismiss_action_card', () => {
  it('skips, or snoozes until a Perth time', async () => {
    expect((await dismissActionCard.run({ card_id: CARD_ID, action: 'skip' }, ctx)).text).toBe('Skipped "Reply to Casey — confirm Thursday access".')
    expect(skipCard).toHaveBeenCalledWith(ctx.supabase, 't1', CARD_ID, 'u1')
    const out = await dismissActionCard.run({ card_id: CARD_ID, action: 'snooze', snooze_until: '2099-10-26T08:00' }, ctx)
    expect(snoozeCard).toHaveBeenCalledWith(ctx.supabase, 't1', CARD_ID, '2099-10-26T00:00:00.000Z')
    expect(out.text).toMatch(/^Snoozed ".*" until /)
  })

  it('needs a future time to snooze, and a card that can still change', async () => {
    expect((await dismissActionCard.run({ card_id: CARD_ID, action: 'snooze' }, ctx)).isError).toBe(true)
    stored = card({ status: 'done' })
    expect(await dismissActionCard.run({ card_id: CARD_ID, action: 'skip' }, ctx)).toMatchObject({ isError: true, text: "That card is done — it can't be skipped now." })
  })
})
