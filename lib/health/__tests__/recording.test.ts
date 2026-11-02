import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { fakeSupabase, type Row } from '@/lib/mcp/__tests__/fake-supabase'
import { setHealthDbForTests } from '../db'
import { costUsd, priceFor } from '../pricing'
import { trackAi, usageOf } from '../ai-usage'
import { logError } from '../errors'
import { judgeRun, withCronRun } from '../cron'

// Health monitoring, part 1 (tech spec §25): every AI call, scheduled job run
// and carried-on-past failure leaves a row, and recording never changes or
// fails the thing it records.

const tables: Record<string, Row[]> = {}

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  setHealthDbForTests(fakeSupabase(tables) as never)
  process.env.CRON_SECRET = 'secret'
})
afterEach(() => {
  setHealthDbForTests(undefined)
  delete process.env.AI_PRICES
})

describe('pricing', () => {
  it('prices a call from its tokens', () => {
    // Haiku 5.5: $0.10 in, $0.50 out per million
    expect(costUsd('claude-haiku-5-5', { input: 1_000_000, output: 200_000, cacheRead: 0, cacheWrite: 0 })).toBeCloseTo(0.2)
    // Opus 5.5 cache reads at $0.20, writes at 1.25 × $4
    expect(costUsd('claude-opus-5-5', { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 1_000_000 })).toBeCloseTo(5.2)
  })

  it('knows a served model by its prefix, and has no price for an unknown one', () => {
    expect(priceFor('models/gemini-3.5-flash-001')?.input).toBe(1.5)
    expect(costUsd('some-new-model', { input: 1000, output: 1000, cacheRead: 0, cacheWrite: 0 })).toBeNull()
  })

  it('takes prices from AI_PRICES without a deploy', () => {
    process.env.AI_PRICES = JSON.stringify({ 'some-new-model': { input: 1, output: 2 } })
    expect(costUsd('some-new-model', { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 })).toBe(3)
  })
})

describe('reading token counts off a reply', () => {
  it('Anthropic', () => {
    expect(usageOf({ usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 } }))
      .toEqual({ input: 10, output: 5, cacheRead: 100, cacheWrite: 20 })
  })
  it('Google (@google/genai), counting thinking as output and cached input apart', () => {
    expect(usageOf({ usageMetadata: { promptTokenCount: 120, cachedContentTokenCount: 20, candidatesTokenCount: 30, thoughtsTokenCount: 10 } }))
      .toEqual({ input: 100, output: 40, cacheRead: 20, cacheWrite: 0 })
  })
  it('Google (@google/generative-ai)', () => {
    expect(usageOf({ response: { usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 7 } } }).input).toBe(50)
  })
  it('OpenAI embeddings', () => {
    expect(usageOf({ usage: { prompt_tokens: 42, total_tokens: 42 } })).toEqual({ input: 42, output: 0, cacheRead: 0, cacheWrite: 0 })
  })
  it('anything else counts as nothing', () => {
    expect(usageOf(undefined)).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
  })
})

describe('trackAi', () => {
  it('passes the reply on and records what it cost, under the model that answered', async () => {
    const reply = { model: 'claude-haiku-5-5', usage: { input_tokens: 1_000_000, output_tokens: 0 } }
    const got = await trackAi({ feature: 'job-review', provider: 'anthropic', model: 'claude-haiku-5-5', tenantId: 't1', jobId: 'j1' }, async () => reply)
    expect(got).toBe(reply)
    expect(tables.ai_calls).toHaveLength(1)
    expect(tables.ai_calls[0]).toMatchObject({ feature: 'job-review', provider: 'anthropic', model: 'claude-haiku-5-5', tenant_id: 't1', job_id: 'j1', input_tokens: 1_000_000, cost_usd: 0.1, ok: true })
  })

  it('records a failed call and passes the error on', async () => {
    await expect(trackAi({ feature: 'order-parser', provider: 'google', model: 'gemini-3.5-flash' }, async () => { throw new Error('503 overloaded') }))
      .rejects.toThrow('503 overloaded')
    expect(tables.ai_calls[0]).toMatchObject({ ok: false, error: '503 overloaded', input_tokens: 0 })
  })

  it('still answers when recording fails, or with no database', async () => {
    setHealthDbForTests({ from: () => { throw new Error('db down') } } as never)
    expect(await trackAi({ feature: 'x', provider: 'openai', model: 'text-embedding-3-small' }, async () => 'ok')).toBe('ok')
    setHealthDbForTests(null)
    expect(await trackAi({ feature: 'x', provider: 'openai', model: 'text-embedding-3-small' }, async () => 'ok')).toBe('ok')
  })
})

describe('logError', () => {
  it('records where it came from and what happened', async () => {
    await logError('ai-parse:photo-labels', new Error('Unexpected token'), { tenantId: 't1', detail: { reply: 'Sorry, I…' } })
    expect(tables.system_errors[0]).toMatchObject({ source: 'ai-parse:photo-labels', message: 'Unexpected token', tenant_id: 't1', detail: { reply: 'Sorry, I…' } })
  })
})

describe('judging a scheduled job run', () => {
  it.each([
    [200, { status: 'success' }, 'ok'],
    [200, { ok: true, skipped: 'No ANTHROPIC_API_KEY' }, 'ok'],
    [200, { reviewed: 4, errors: [] }, 'ok'],
    [200, { reviewed: 4, errors: ['IRC1001: timeout'] }, 'partial'],
    [207, { errors: [] }, 'partial'],
    [200, { error: 'Gmail quota' }, 'partial'],
    [404, { error: 'No sync state found' }, 'failed'],
    [500, { error: 'Internal server error' }, 'failed'],
    [502, null, 'failed'],
  ])('HTTP %i %j → %s', (http, body, status) => {
    expect(judgeRun(http, body).status).toBe(status)
  })
})

describe('withCronRun', () => {
  const req = (auth?: string) => new NextRequest('https://irc.test/api/x', { headers: auth ? { authorization: auth } : {} })

  it('opens a run and closes it with how it went', async () => {
    const GET = withCronRun('/api/x', async () => NextResponse.json({ reviewed: 2, errors: ['IRC1: failed'] }))
    const res = await GET(req('Bearer secret'))
    expect(res.status).toBe(200)
    expect(tables.cron_runs).toHaveLength(1)
    expect(tables.cron_runs[0]).toMatchObject({ route: '/api/x', status: 'partial', http_status: 200, error: 'IRC1: failed', summary: { reviewed: 2 } })
    expect(tables.cron_runs[0].finished_at).toBeTruthy()
  })

  it('records a throw as failed, logs it, and answers 500', async () => {
    const GET = withCronRun('/api/x', async () => { throw new Error('boom') })
    const res = await GET(req('Bearer secret'))
    expect(res.status).toBe(500)
    expect(tables.cron_runs[0]).toMatchObject({ status: 'failed', error: 'boom' })
    expect(tables.system_errors[0]).toMatchObject({ source: 'cron:/api/x', message: 'boom' })
  })

  it("doesn't record calls without the cron secret", async () => {
    const GET = withCronRun('/api/x', async () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await GET(req())).status).toBe(401)
    expect(tables.cron_runs ?? []).toHaveLength(0)
  })
})
