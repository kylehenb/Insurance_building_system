import { describe, it, expect, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from './fake-supabase'
import { setHealthDbForTests } from '@/lib/health/db'
import { getHealthCheck, getAiCosts, listHealthSuggestions, decideHealthSuggestion } from '@/lib/mcp/tools/health'
import { loadAiCosts, describeAiCosts, featureInfo } from '@/lib/health/ai-costs'
import { MCP_TOOLS } from '@/lib/mcp/tools'

// The health check by voice (tech spec §25.6, §10b): the same loadSummary,
// getReview, loadAiCosts, listSuggestions and decideSuggestion as the panel.

const tables: Record<string, Row[]> = {}
const ctx = () => ({ supabase: fakeSupabase(tables) as never, tenantId: 't1', userId: 'u1' }) as never
// Wed 4 Nov 2026, 10am Perth
const NOW = new Date('2026-11-04T02:00:00Z')

const sug = (id: string, title: string, status = 'open', extra: Row = {}) => ({
  id, tenant_id: 't1', review_id: 'r1', last_review_id: 'r1', title, why: 'Seen in the figures', kind: 'automation', effort: 'small',
  evidence: [], times_raised: 1, status, note: null, decided_by: null, decided_at: null, done_at: null, created_at: '2026-11-02T00:00:00Z', ...extra,
})

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  setHealthDbForTests(fakeSupabase(tables) as never)
  tables.ai_calls = [
    { tenant_id: 't1', created_at: '2026-11-02T02:00:00Z', feature: 'action-cards', model: 'claude-haiku-5-5', ok: true, cost_usd: 0.6 },
    { tenant_id: 't1', created_at: '2026-11-03T02:00:00Z', feature: 'action-cards', model: 'claude-haiku-5-5', ok: true, cost_usd: 0.4 },
    { tenant_id: null, created_at: '2026-11-03T03:00:00Z', feature: 'order-parser', model: 'gemini-3.5-flash', ok: false, cost_usd: null },
    { tenant_id: 't1', created_at: '2026-11-03T04:00:00Z', feature: 'midcity-photo-labels', model: 'claude-haiku-5-5', ok: true, cost_usd: 1 },
    { tenant_id: 't2', created_at: '2026-11-03T04:00:00Z', feature: 'action-cards', model: 'claude-haiku-5-5', ok: true, cost_usd: 50 },
    // Last Monday–Wednesday, for "vs before"
    { tenant_id: 't1', created_at: '2026-10-27T02:00:00Z', feature: 'action-cards', model: 'claude-haiku-5-5', ok: true, cost_usd: 0.5 },
    // Last Friday: outside the same days, not compared
    { tenant_id: 't1', created_at: '2026-10-30T02:00:00Z', feature: 'action-cards', model: 'claude-haiku-5-5', ok: true, cost_usd: 9 },
  ]
})

describe('AI costs by feature', () => {
  it("breaks this week's spend down by feature and model, against the same days of last week", async () => {
    const c = await loadAiCosts(fakeSupabase(tables) as never, 't1', 'week', 0, NOW)
    expect(c).toMatchObject({ totalUsd: 2, previousTotalUsd: 0.5, calls: 4, failed: 1, daysCounted: 3 })
    expect(c.features.map(f => [f.key, f.costUsd, f.calls])).toEqual([['action-cards', 1, 2], ['midcity-photo-labels', 1, 1], ['order-parser', 0, 1]])
    expect(c.features[0]).toMatchObject({ label: 'Action cards', share: 0.5, costPerCall: 0.5, previousCostUsd: 0.5 })
    expect(c.features[1]).toMatchObject({ label: 'Midcity: Photo labels', midcity: true })
    expect(c.features[2]).toMatchObject({ failed: 1, unpriced: 0, costPerCall: null })
    expect(c.models.map(m => m.key)).toEqual(['claude-haiku-5-5', 'gemini-3.5-flash'])
  })

  it('names a feature it has no description for', () => {
    expect(featureInfo('quote-checker')).toMatchObject({ label: 'Quote checker', midcity: false })
  })

  it('reads out by voice', async () => {
    const res = await getAiCosts.run({ period: 'week' }, ctx())
    expect(res.text).toMatch(/^This week: US\$2\.00 on 4 AI requests over \d+ days?/)
    expect(res.text).toContain('- Action cards: US$1.00 (50%), 2 requests, US$0.50 each — reads each incoming email')
  })

  it('says when nothing has been recorded', () => {
    expect(describeAiCosts({ calls: 0, trackedSince: null } as never)).toContain('only just started')
  })
})

describe('get_health_check', () => {
  it("reads a finished week's figures, review and suggestions", async () => {
    tables.health_daily = [{ tenant_id: 't1', day: '2026-10-27', version: 2, metrics: { orders_received: 4, jobs_created: 3, kpi_met: 5, kpi_missed: 1 } }]
    tables.health_reviews = [{ id: 'r1', tenant_id: 't1', kind: 'week', period_from: '2026-10-26', period_to: '2026-11-02', label: 'Week of 26 Oct', status: 'ready', headline: 'A steady week.', sections: [{ key: 'didnt', title: "What didn't", points: [{ text: 'One Castle report was late.', facts: ['F3'] }] }], suggestions: [], facts: [] }]
    tables.health_suggestions = [sug('s1', 'Chase Castle report deadlines a day early')]
    const res = await getHealthCheck.run({ period: 'week', periods_back: 1 }, ctx())
    expect(res.text).toContain('Week of')
    expect(res.text).toContain('Insurer orders received 4')
    expect(res.text).toContain('Insurer deadlines: 5 met, 1 missed.')
    expect(res.text).toContain('Review: A steady week.')
    expect(res.text).toContain("What didn't: One Castle report was late.")
    expect(res.text).toContain('1. Chase Castle report deadlines a day early — automation, small effort.')
    expect(res.data).toMatchObject({ suggestions: [{ suggestion_id: 's1', status: 'open' }] })
  })

  it('refuses a bad period', async () => {
    expect((await getHealthCheck.run({ period: 'decade' }, ctx())).isError).toBe(true)
    expect((await getHealthCheck.run({ periods_back: 9 }, ctx())).isError).toBe(true)
  })
})

describe('suggestions by voice', () => {
  beforeEach(() => {
    tables.health_suggestions = [
      sug('s1', 'Chase Castle report deadlines a day early'),
      sug('s2', 'Template the work order email', 'accepted'),
      sug('s3', 'Turn on auto-confirm for invoices', 'dismissed'),
    ]
  })

  it('lists open and accepted ones by default', async () => {
    const res = await listHealthSuggestions.run({}, ctx())
    expect(res.text.split('\n')).toHaveLength(2)
    expect(res.text).toContain('Template the work order email — automation, small effort, accepted.')
    expect((await listHealthSuggestions.run({ status: 'dismissed' }, ctx())).text).toContain('Turn on auto-confirm')
  })

  it('accepts by id, recording the decision for the learning module', async () => {
    const res = await decideHealthSuggestion.run({ suggestion_id: 's1', decision: 'accepted' }, ctx())
    expect(res.text).toBe('Accepted: "Chase Castle report deadlines a day early".')
    expect(tables.health_suggestions[0]).toMatchObject({ status: 'accepted', decided_by: 'u1' })
    expect(tables.learning_events[0]).toMatchObject({ feature: 'health_suggestion', outcome: 'accepted', user_id: 'u1' })
  })

  it('finds one from how the person described it, and dismisses it with their reason', async () => {
    const res = await decideHealthSuggestion.run({ title: 'the castle deadlines one', decision: 'dismissed', note: 'Castle set those in their portal' }, ctx())
    expect(res.text).toBe('Dismissed: "Chase Castle report deadlines a day early".')
    expect(tables.health_suggestions[0]).toMatchObject({ status: 'dismissed', note: 'Castle set those in their portal' })
  })

  it('asks which one when the description fits more than one, and says when none fits', async () => {
    tables.health_suggestions.push(sug('s4', 'Chase Castle quote deadlines a day early'))
    const res = await decideHealthSuggestion.run({ title: 'castle deadlines', decision: 'accepted' }, ctx())
    expect(res).toMatchObject({ isError: true })
    expect(res.text).toContain('which did you mean')
    expect((await decideHealthSuggestion.run({ title: 'payroll', decision: 'accepted' }, ctx())).text).toContain('No suggestion matches')
    expect(tables.health_suggestions.every(s => s.status !== 'accepted' || s.id === 's2')).toBe(true)
  })

  it("won't touch another office's suggestion", async () => {
    tables.health_suggestions.push(sug('x1', 'Other office idea', 'open', { tenant_id: 't2' }))
    expect((await decideHealthSuggestion.run({ suggestion_id: 'x1', decision: 'accepted' }, ctx())).isError).toBe(true)
  })
})

describe('the connector', () => {
  it('offers the health tools, each needing health.view', () => {
    const tools = MCP_TOOLS.filter(t => ['get_health_check', 'get_ai_costs', 'list_health_suggestions', 'decide_health_suggestion'].includes(t.name))
    expect(tools).toHaveLength(4)
    expect(tools.every(t => t.permission === 'health.view')).toBe(true)
    expect(tools.find(t => t.name === 'decide_health_suggestion')?.annotations.readOnlyHint).toBe(false)
  })
})
