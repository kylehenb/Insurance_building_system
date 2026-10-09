import { describe, it, expect, vi, beforeEach } from 'vitest'

const embeddingsCreate = vi.fn()
vi.mock('openai', () => ({
  default: class {
    embeddings = { create: embeddingsCreate }
  },
}))

import { getSimilarReportsBlock, indexReports } from '../similar-reports'

type Row = Record<string, unknown>

// Minimal stand-in for the Supabase query builder / rpc used by the helper
function fakeService(opts: { rows: Row[]; matches?: { id: string }[]; rpcError?: string }) {
  const updates: { values: Row; filters: Row }[] = []
  const service = {
    rpc: vi.fn(async () => ({
      data: opts.matches ?? [],
      error: opts.rpcError ? { message: opts.rpcError } : null,
    })),
    from: () => ({
      select: () => ({
        in: async (_col: string, ids: string[]) => ({ data: opts.rows.filter(r => ids.includes(r.id as string)) }),
      }),
      update: (values: Row) => {
        const entry = { values, filters: {} as Row }
        updates.push(entry)
        const chain = {
          eq(col: string, val: unknown) {
            entry.filters[col] = val
            return chain
          },
          then(resolve: (v: { error: null }) => void) {
            resolve({ error: null })
          },
        }
        return chain
      },
    }),
  }
  return { service: service as never, updates, rpc: service.rpc }
}

const lockedBar: Row = {
  id: 'r1',
  report_type: 'BAR',
  loss_type: 'Storm',
  raw_report_notes: 'Tile displaced over bedroom, water through ceiling',
  is_locked: true,
  deleted_at: null,
  incident_description: 'Storm on 3 March',
  cause_of_damage: 'Displaced ridge tile allowed water ingress',
  how_damage_occurred: null,
  resulting_damage: 'Ceiling stain and swelling in bedroom 2',
  pre_existing_conditions: null,
  maintenance_notes: null,
  conclusion: 'Storm related, claim supported',
  type_specific_fields: null,
  // identifying fields that must never reach the prompt
  insured_name: 'Jane Citizen',
  property_address: '1 Example St',
}

beforeEach(() => {
  embeddingsCreate.mockReset()
  process.env.OPENAI_API_KEY = 'test'
})

describe('getSimilarReportsBlock', () => {
  it('formats the matched reports without identifying details', async () => {
    embeddingsCreate.mockResolvedValue({ data: [{ index: 0, embedding: [0.1, 0.2] }] })
    const { service, rpc } = fakeService({ rows: [lockedBar], matches: [{ id: 'r1' }] })

    const block = await getSimilarReportsBlock({
      service, tenantId: 't1', reportType: 'BAR', notes: 'water through ceiling', insurer: 'Suncorp', excludeReportId: 'r9',
    })

    expect(rpc).toHaveBeenCalledWith('match_similar_reports', expect.objectContaining({
      p_tenant_id: 't1', p_report_type: 'BAR', p_query_embedding: '[0.1,0.2]', p_insurer: 'Suncorp', p_exclude_report_id: 'r9',
    }))
    expect(block).toContain('PAST REPORTS FROM SIMILAR JOBS')
    expect(block).toContain('cause_of_damage: Displaced ridge tile allowed water ingress')
    expect(block).toContain('(loss type: Storm)')
    expect(block).not.toContain('Jane Citizen')
    expect(block).not.toContain('Example St')
  })

  it('returns an empty block when nothing is close enough', async () => {
    embeddingsCreate.mockResolvedValue({ data: [{ index: 0, embedding: [0.1] }] })
    const { service } = fakeService({ rows: [], matches: [] })
    expect(await getSimilarReportsBlock({ service, tenantId: 't1', reportType: 'BAR', notes: 'x' })).toBe('')
  })

  it('never throws — falls back to no examples when the lookup fails', async () => {
    embeddingsCreate.mockRejectedValue(new Error('network down'))
    const { service } = fakeService({ rows: [] })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await getSimilarReportsBlock({ service, tenantId: 't1', reportType: 'BAR', notes: 'x' })).toBe('')
  })

  it('skips the lookup entirely without an OpenAI key', async () => {
    delete process.env.OPENAI_API_KEY
    const { service, rpc } = fakeService({ rows: [] })
    expect(await getSimilarReportsBlock({ service, tenantId: 't1', reportType: 'BAR', notes: 'x' })).toBe('')
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('indexReports', () => {
  it('fingerprints locked reports only, guarded on is_locked', async () => {
    embeddingsCreate.mockResolvedValue({ data: [{ index: 0, embedding: [0.5, 0.5] }] })
    const unlocked = { ...lockedBar, id: 'r2', is_locked: false }
    const { service, updates } = fakeService({ rows: [lockedBar, unlocked] })

    const written = await indexReports(service, ['r1', 'r2'])

    expect(written).toBe(1)
    const input = embeddingsCreate.mock.calls[0][0].input as string[]
    expect(input).toHaveLength(1)
    expect(input[0]).toContain('Inspection notes: Tile displaced over bedroom')
    expect(updates[0].values.embedding).toBe('[0.5,0.5]')
    expect(updates[0].filters).toEqual({ id: 'r1', is_locked: true })
  })
})
