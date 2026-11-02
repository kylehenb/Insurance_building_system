import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fakeSupabase, type Row } from '@/lib/mcp/__tests__/fake-supabase'
import { runLapses } from '../lapse'

// The safety net for insurers who never decide: a warning two weeks before,
// then "no decision" once the insurer's lapse time has passed — but only with
// everything paid; with money owed, a check to invoice or chase it instead.

const tables: Record<string, Row[]> = {}
const db = fakeSupabase(tables) as never
const AT = new Date('2026-11-02T00:00:00Z')
const daysAgo = (n: number) => new Date(AT.getTime() - n * 86_400_000).toISOString()

afterEach(() => { vi.useRealTimers() })

beforeEach(() => {
  // Checks must be in the future: run as if it's AT
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(AT)
  for (const k of Object.keys(tables)) delete tables[k]
  tables.users = [{ id: 'admin1', tenant_id: 't1', role: 'admin' }]
  tables.clients = [{ id: 'castle', decision_lapse_days: 180 }, { id: 'never', decision_lapse_days: 0 }, { id: 'quick', decision_lapse_days: 30 }]
  const job = (id: string, client: string, since: string): Row => ({ id, tenant_id: 't1', job_number: id.toUpperCase(), insurer: 'Castle Insurance', client_id: client, phase: 'awaiting_decision', phase_since: since, lapsed_at: null, closed_by_hand: null, override_stage: null, assigned_to: null })
  tables.jobs = [
    job('irc1', 'castle', daysAgo(200)), // lapsed, all paid → closes
    job('irc2', 'castle', daysAgo(190)), // lapsed, invoice unpaid → check
    job('irc3', 'castle', daysAgo(170)), // two weeks out → warning
    job('irc4', 'castle', daysAgo(30)), // fine
    job('irc5', 'never', daysAgo(900)), // never lapses
    job('irc6', 'quick', daysAgo(40)), // past its insurer's 30 days, nothing invoiced → check
  ]
  tables.invoices = [
    { job_id: 'irc1', direction: 'outbound', invoice_type: 'assessment', status: 'paid' },
    { job_id: 'irc2', direction: 'outbound', invoice_type: 'assessment', status: 'sent' },
  ]
})

describe('the lapse safety net', () => {
  it('closes the paid-up, flags money owed, warns two weeks out, and leaves the rest', async () => {
    const out = await runLapses(db, AT)
    expect(out).toEqual({ lapsed: ['IRC1'], warned: ['IRC3'], blocked: ['IRC2', 'IRC6'] })
    expect(tables.jobs.find(j => j.id === 'irc1')!.lapsed_at).toBe(AT.toISOString())
    const note = (c: Row) => (c.follow_up as { note: string }).note
    expect(tables.action_queue.map(c => [c.job_id, c.rule_key])).toEqual([['irc2', 'lapse_blocked'], ['irc3', 'lapse_warning'], ['irc6', 'lapse_blocked']])
    expect(note(tables.action_queue[0])).toMatch(/^Castle Insurance hasn't decided on IRC2 in over 6 months\. It can close as "no decision" once everything on it is paid/)
    expect(note(tables.action_queue[1])).toMatch(/^Castle Insurance hasn't decided on IRC3 since Sat 16 May 2026\. It closes as "no decision" on Thu 12 Nov 2026/)
    expect(note(tables.action_queue[2])).toMatch(/in over 30 days\./)
    expect((tables.action_queue[0].follow_up as { note: string }).note).toContain('1 invoice is still unpaid')
    expect((tables.action_queue[2].follow_up as { note: string }).note).toContain('nothing has been invoiced on it yet')
    // Once each per wait
    expect(await runLapses(db, AT)).toEqual({ lapsed: [], warned: [], blocked: [] })
  })

  it('raises at most three new checks a day, the longest waits first', async () => {
    tables.jobs = Array.from({ length: 5 }, (_, i) => ({ id: `old${i}`, tenant_id: 't1', job_number: `OLD${i}`, insurer: 'Castle Insurance', client_id: 'castle', phase: 'awaiting_decision', phase_since: daysAgo(400 - i), lapsed_at: null, closed_by_hand: null, override_stage: null }))
    expect((await runLapses(db, AT)).blocked).toEqual(['OLD0', 'OLD1', 'OLD2'])
  })
})
