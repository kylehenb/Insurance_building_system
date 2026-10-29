import { describe, it, expect, vi, beforeEach } from 'vitest'

// generateReportDraft (moved out of app/api/ai/generate-report): which prompt
// it uses, what it does with the loss type, and a reply it can't read.

let reply = ''
const create = vi.fn(async () => ({ content: [{ type: 'text', text: reply }] }))
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create } } }))
vi.mock('@/lib/reports/learning', () => ({ reportLearning: async () => '', reportSituation: () => ({}), saveAiDraft: async () => {} }))
vi.mock('@/lib/reports/similar-reports', () => ({ getSimilarReportsBlock: async () => 'SIMILAR' }))

const { generateReportDraft, ReportGenerateError } = await import('../generate')

const rows: Record<string, Record<string, unknown>[]> = {}
const supabase = {
  from: (table: string) => {
    const preds: [string, unknown][] = []
    const b: Record<string, unknown> = {
      select: () => b, update: () => b,
      eq: (c: string, v: unknown) => { preds.push([c, v]); return b },
      maybeSingle: async () => ({ data: (rows[table] ?? []).find(r => preds.every(([c, v]) => r[c] === v)) ?? null }),
      single: async () => ({ data: (rows[table] ?? []).find(r => preds.every(([c, v]) => r[c] === v)) ?? null }),
    }
    return b
  },
} as never

beforeEach(() => {
  create.mockClear()
  rows.prompts = [{ tenant_id: 't1', key: 'report_roof', system_prompt: 'ROOF PROMPT' }]
  rows.reports = [{ id: 'r1', tenant_id: 't1', loss_type: 'Storm', jobs: { insurer: 'Allianz' } }]
})

describe('generateReportDraft', () => {
  it('uses the tenant’s prompt for the report type, with similar reports', async () => {
    reply = 'Here you go: {"roof_type": "Tile", "conclusion": "Storm damage"}'
    const data = await generateReportDraft({ supabase, tenantId: 't1', reportType: 'Roof', rawReportDump: 'notes' })
    expect(data).toEqual({ roof_type: 'Tile', conclusion: 'Storm damage' })
    const call = (create.mock.calls[0] as unknown as [{ system: string; messages: { content: string }[] }])[0]
    expect(call.system).toBe('ROOF PROMPT\n\nSIMILAR')
    expect(call.messages[0].content).toContain('notes')
  })

  it('keeps the report’s own loss type over the AI’s, and drops one not on the list', async () => {
    reply = '{"loss_type": "Flood"}'
    expect(await generateReportDraft({ supabase, tenantId: 't1', reportType: 'bar', rawReportDump: 'x', reportId: 'r1' })).toEqual({ loss_type: 'Storm' })
    reply = '{"loss_type": "Alien invasion", "conclusion": "c"}'
    expect(await generateReportDraft({ supabase, tenantId: 't1', reportType: 'bar', rawReportDump: 'x' })).toEqual({ conclusion: 'c' })
  })

  it('says so when the reply has no JSON', async () => {
    reply = 'Sorry, I cannot help with that.'
    await expect(generateReportDraft({ supabase, tenantId: 't1', reportType: 'bar', rawReportDump: 'x' })).rejects.toBeInstanceOf(ReportGenerateError)
  })
})
