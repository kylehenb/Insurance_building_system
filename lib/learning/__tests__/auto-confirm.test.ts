import { describe, it, expect, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from '@/lib/mcp/__tests__/fake-supabase'
import { autoConfirmFor, dismissAutoConfirm, pendingAutoConfirm, readiness, refreshAutoConfirmSuggestions, setAutoConfirm } from '../auto-confirm'

// Auto-confirm is off until someone turns it on; the office is asked once a
// kind has been confirmed untouched for 98% of its last 20 decisions.

const tables: Record<string, Row[]> = {}
const db = fakeSupabase(tables)
const NOW = new Date('2026-10-29T00:00:00Z')

/** n decisions on a kind, newest first; `edited` of them changed */
function decisions(n: number, kind = 'invoice', edited = 0, extra: Row = {}) {
  for (let i = 0; i < n; i++) {
    tables.learning_events.push({ tenant_id: 't1', feature: 'action_card', kind, outcome: i < edited ? 'edited' : 'accepted', created_at: new Date(NOW.getTime() - (i + 1) * 3_600_000).toISOString(), ...extra })
  }
}

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  tables.learning_events = []
})

describe('readiness', () => {
  it('needs 20 decisions, at least 98% untouched — instructions don\'t count', async () => {
    decisions(20)
    tables.learning_events.push({ tenant_id: 't1', feature: 'action_card', kind: 'invoice', outcome: 'instructed', created_at: NOW.toISOString() })
    expect(await readiness(db as never, 't1', 'action_card', 'invoice')).toEqual({ decided: 20, accepted: 20, pct: 100, ready: true })
  })

  it('isn\'t ready with one of the last 20 changed, or with fewer than 20', async () => {
    decisions(25, 'invoice', 1)
    expect(await readiness(db as never, 't1', 'action_card', 'invoice')).toMatchObject({ decided: 20, accepted: 19, pct: 95, ready: false })
    decisions(19, 'other')
    expect((await readiness(db as never, 't1', 'action_card', 'other')).ready).toBe(false)
  })
})

describe('asking the office', () => {
  it('asks once a kind is ready, and only once while the question is open', async () => {
    decisions(20)
    expect(await refreshAutoConfirmSuggestions(db as never, 't1', 'action_card', ['invoice', 'other'], NOW)).toEqual(['invoice'])
    expect(await refreshAutoConfirmSuggestions(db as never, 't1', 'action_card', ['invoice', 'other'], NOW)).toEqual([])
    const pending = await pendingAutoConfirm(db as never, 't1')
    expect(pending).toEqual([{ feature: 'action_card', kind: 'invoice', readiness: { decided: 20, accepted: 20, pct: 100, ready: true } }])
    // Asking doesn't turn it on
    expect(await autoConfirmFor(db as never, 't1', 'action_card', 'invoice')).toBeNull()
  })

  it('"Not now" stops asking for 30 days', async () => {
    decisions(20)
    await refreshAutoConfirmSuggestions(db as never, 't1', 'action_card', ['invoice'], NOW)
    await dismissAutoConfirm(db as never, 't1', 'action_card', 'invoice', new Date(NOW.getTime() + 1000))
    expect(await pendingAutoConfirm(db as never, 't1')).toEqual([])
    const later = (days: number) => new Date(NOW.getTime() + days * 86_400_000)
    expect(await refreshAutoConfirmSuggestions(db as never, 't1', 'action_card', ['invoice'], later(10))).toEqual([])
    expect(await refreshAutoConfirmSuggestions(db as never, 't1', 'action_card', ['invoice'], later(31))).toEqual(['invoice'])
  })

  it('stops asking when a kind is no longer good enough, and never asks about one that\'s on', async () => {
    decisions(20)
    await refreshAutoConfirmSuggestions(db as never, 't1', 'action_card', ['invoice'], NOW)
    tables.learning_events.push({ tenant_id: 't1', feature: 'action_card', kind: 'invoice', outcome: 'edited', created_at: NOW.toISOString() })
    await refreshAutoConfirmSuggestions(db as never, 't1', 'action_card', ['invoice'], NOW)
    expect(await pendingAutoConfirm(db as never, 't1')).toEqual([])
    decisions(20, 'other')
    await setAutoConfirm(db as never, 't1', 'action_card', 'other', true, 'u1')
    expect(await refreshAutoConfirmSuggestions(db as never, 't1', 'action_card', ['other'], NOW)).toEqual([])
  })
})

describe('the switch', () => {
  it('runs as whoever turned it on, until it\'s turned off', async () => {
    await setAutoConfirm(db as never, 't1', 'action_card', 'invoice', true, 'u1')
    expect(await autoConfirmFor(db as never, 't1', 'action_card', 'invoice')).toEqual({ userId: 'u1' })
    expect(await autoConfirmFor(db as never, 't2', 'action_card', 'invoice')).toBeNull()
    await setAutoConfirm(db as never, 't1', 'action_card', 'invoice', false, 'u2')
    expect(await autoConfirmFor(db as never, 't1', 'action_card', 'invoice')).toBeNull()
    expect(tables.learning_auto_confirm).toHaveLength(1)
  })
})
