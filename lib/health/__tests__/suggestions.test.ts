import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fakeSupabase, type Row } from '@/lib/mcp/__tests__/fake-supabase'
import { setHealthDbForTests } from '../db'
import { repeatedSequences } from '../patterns'
import { alike, saveSuggestions, decideSuggestion, suggestionContext, followUpFacts, SuggestionError } from '../suggestions'
import { writeReview, type SuggestionKind } from '../review'

// Suggestions and repeated steps (tech spec §25.5): each suggestion can be
// accepted, dismissed or marked done; decisions go to the learning module; a
// repeat is counted, not added; one like a recent dismissal is dropped; the
// next review is told what was decided and follows up what was accepted.

const tables: Record<string, Row[]> = {}
const db = fakeSupabase(tables) as never
const NOW = new Date('2026-11-03T18:00:00Z')

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  setHealthDbForTests(fakeSupabase(tables) as never)
})

describe('repeated manual steps', () => {
  const at = (min: number) => new Date(Date.UTC(2026, 9, 27, 0, min)).toISOString()
  const run = (user: string, job: string, start: number, actions: string[]) =>
    actions.map((action, i) => ({ user_id: user, job_id: job, action, created_at: at(start + i * 5), outcome: 'done' }))

  it('counts the same steps done one after another on a job, by person and job', () => {
    const rows = [
      ...run('u1', 'j1', 0, ['jobs.notes', 'mail.send', 'jobs.change_stage']),
      ...run('u1', 'j2', 100, ['jobs.notes', 'mail.view', 'mail.send', 'jobs.change_stage']), // opening mail isn't a step
      ...run('u2', 'j3', 200, ['jobs.notes', 'jobs.notes', 'mail.send', 'jobs.change_stage']), // two notes are one step
      ...run('u2', 'j4', 300, ['send.documents', 'invoices.manage']),
    ]
    expect(repeatedSequences(rows)).toEqual([{ steps: ['jobs.notes', 'mail.send', 'jobs.change_stage'], times: 3, people: 2, jobs: 3 }])
  })

  it('splits at gaps over 30 minutes, and ignores failed or queued actions', () => {
    const rows = [
      { user_id: 'u1', job_id: 'j1', action: 'jobs.notes', created_at: at(0) },
      { user_id: 'u1', job_id: 'j1', action: 'mail.send', created_at: at(45) },
      { user_id: 'u1', job_id: 'j2', action: 'jobs.notes', created_at: at(0) },
      { user_id: 'u1', job_id: 'j2', action: 'mail.send', created_at: at(5), outcome: 'requested' },
      { user_id: 'u1', job_id: 'j3', action: 'jobs.notes', created_at: at(0) },
      { user_id: 'u1', job_id: 'j3', action: 'mail.send', created_at: at(5) },
    ]
    expect(repeatedSequences(rows, { minTimes: 1 })).toEqual([{ steps: ['jobs.notes', 'mail.send'], times: 1, people: 1, jobs: 1 }])
  })
})

const S = (title: string, kind: SuggestionKind = 'automation') => ({ title, why: 'because', kind, effort: 'small' as const, facts: ['F2'] })
const FACTS = [{ id: 'F1', text: 'The period' }, { id: 'F2', text: 'Castle report deadlines: 1 met, 4 missed.' }]

describe('saving suggestions', () => {
  it('tells alike titles apart', () => {
    expect(alike('Chase Castle report deadlines a day early', 'Chase report deadlines for Castle one day early')).toBeGreaterThanOrEqual(0.5)
    expect(alike('Chase Castle report deadlines a day early', 'Change the work order email wording')).toBeLessThan(0.2)
  })

  it('adds new ones with their cited facts, counts repeats, and drops ones like a recent dismissal', async () => {
    expect(await saveSuggestions(db, 't1', 'r1', [S('Chase Castle report deadlines a day early')], FACTS, NOW)).toEqual({ added: 1, repeated: 0, dropped: 0 })
    expect(tables.health_suggestions[0]).toMatchObject({ status: 'open', review_id: 'r1', times_raised: 1, evidence: [FACTS[1]] })

    expect(await saveSuggestions(db, 't1', 'r2', [S('Chase report deadlines for Castle one day early')], FACTS, NOW)).toEqual({ added: 0, repeated: 1, dropped: 0 })
    expect(tables.health_suggestions[0]).toMatchObject({ times_raised: 2, last_review_id: 'r2' })

    tables.health_suggestions[0].status = 'dismissed'
    tables.health_suggestions[0].decided_at = '2026-10-01T00:00:00Z'
    expect(await saveSuggestions(db, 't1', 'r3', [S('Chase Castle report deadlines one day early'), S('Template the work order email', 'wording')], FACTS, NOW))
      .toEqual({ added: 1, repeated: 0, dropped: 1 })
  })
})

describe('deciding', () => {
  beforeEach(async () => { await saveSuggestions(db, 't1', 'r1', [S('Chase Castle report deadlines a day early')], FACTS, NOW) })
  const id = () => String(tables.health_suggestions[0].id)

  it('accepts, then marks done, recording each decision for the learning module', async () => {
    await decideSuggestion(db, 't1', id(), 'accepted', { userId: 'u1', now: NOW })
    const done = await decideSuggestion(db, 't1', id(), 'done', { userId: 'u1', note: 'Added a reminder rule', now: new Date('2026-11-10T00:00:00Z') })
    expect(done).toMatchObject({ status: 'done', decided_at: NOW.toISOString(), done_at: '2026-11-10T00:00:00.000Z', note: 'Added a reminder rule' })
    expect(tables.learning_events).toHaveLength(2)
    expect(tables.learning_events[0]).toMatchObject({
      tenant_id: 't1', feature: 'health_suggestion', source_table: 'health_suggestions', source_id: id(), outcome: 'accepted', kind: 'automation',
      situation: { kind: 'automation', effort: 'small', title: 'Chase Castle report deadlines a day early' },
      proposed: { title: 'Chase Castle report deadlines a day early', why: 'because', kind: 'automation', effort: 'small' },
    })
  })

  it('a dismissal with a reason is recorded as an instruction', async () => {
    await decideSuggestion(db, 't1', id(), 'dismissed', { userId: 'u1', note: 'Castle deadlines are set by their portal, not us', now: NOW })
    expect(tables.learning_events[0]).toMatchObject({ outcome: 'instructed', instruction: 'Castle deadlines are set by their portal, not us' })
    // Reopening clears the decision, and isn't a learning decision itself
    expect(await decideSuggestion(db, 't1', id(), 'open', { now: NOW })).toMatchObject({ status: 'open', decided_at: null, note: null })
    expect(tables.learning_events).toHaveLength(1)
  })

  it("won't decide another office's suggestion", async () => {
    await expect(decideSuggestion(db, 't2', id(), 'accepted')).rejects.toBeInstanceOf(SuggestionError)
  })

  it('tells the next review what was decided, and gives facts to follow up accepted changes', async () => {
    await decideSuggestion(db, 't1', id(), 'dismissed', { note: 'Set by their portal', now: new Date() })
    await saveSuggestions(db, 't1', 'r2', [S('Template the work order email', 'wording')], FACTS, NOW)
    const second = String(tables.health_suggestions.find(r => r.title === 'Template the work order email')!.id)
    await decideSuggestion(db, 't1', second, 'accepted', { now: NOW })
    const context = await suggestionContext(db, 't1')
    expect(context).toContain('[dismissed] Chase Castle report deadlines a day early — owner\'s note: "Set by their portal"')
    expect(context).toContain('[accepted] Template the work order email')
    expect(context).toContain('Set by their portal') // the learning case too
    expect(await followUpFacts(db, 't1')).toEqual(['A change the owner accepted but hasn\'t marked done: "Template the work order email" — accepted 2026-11-04. It was suggested because: because'])
  })
})

describe('in the written review', () => {
  it('saves its suggestions, follows up accepted changes, and gives repeated steps as facts', async () => {
    tables.tenants = [{ id: 't1' }]
    tables.health_daily = [{ tenant_id: 't1', day: '2026-11-01', version: 1, metrics: { jobs_created: 1 } }]
    tables.health_suggestions = [{ id: 's0', tenant_id: 't1', title: 'Turn on auto-confirm for invoices', why: 'All 20 accepted untouched', kind: 'system', effort: 'small', evidence: [], times_raised: 1, status: 'done', decided_at: '2026-10-20T00:00:00Z', done_at: '2026-10-22T00:00:00Z', created_at: '2026-10-19T00:00:00Z' }]
    const at = (d: number, m: number) => new Date(Date.UTC(2026, 9, d, 1, m)).toISOString()
    tables.activity_log = [27, 28, 29].flatMap(d => [
      { tenant_id: 't1', user_id: 'u1', job_id: `j${d}`, action: 'jobs.notes', via: 'app', outcome: 'done', created_at: at(d, 0) },
      { tenant_id: 't1', user_id: 'u1', job_id: `j${d}`, action: 'send.replies', via: 'app', outcome: 'done', created_at: at(d, 4) },
    ])
    const create = vi.fn<(p: unknown) => Promise<unknown>>(async () => ({
      stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: 'text', text: JSON.stringify({ headline: 'h', worked: [], didnt: [], busy: [], systems: [], followup: [{ text: 'Auto-confirm is saving time.', facts: ['F2'] }], suggestions: [{ title: 'Reply automatically after adding a note', why: 'Done 3 times', kind: 'automation', effort: 'small', facts: ['F2'] }] }) }],
    }))
    const review = await writeReview(db, 't1', 'week', 1, { now: NOW, client: { beta: { messages: { create } } } as never })
    const prompt = JSON.stringify(create.mock.calls[0][0])
    expect(prompt).toContain('Repeated manual steps: \\"Add job notes\\" then \\"Reply to emails\\" on the same job within 30 minutes, 3 times, by 1 person on 3 jobs.')
    expect(prompt).toContain('A change the owner made: \\"Turn on auto-confirm for invoices\\"')
    expect(prompt).toContain('[done] Turn on auto-confirm for invoices')
    expect(review.sections.find(s => s.key === 'followup')?.points).toHaveLength(1)
    expect(tables.health_suggestions.find(r => r.title === 'Reply automatically after adding a note')).toMatchObject({ status: 'open', review_id: review.id })
  })
})
