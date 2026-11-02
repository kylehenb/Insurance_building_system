import { describe, it, expect, vi } from 'vitest'

// Importing Gmail's stars: every starred conversation (through all of
// Gmail's pages) goes on the list once, for the AI to pick its pile; ones
// already on the list stay as they are.

const pages: Record<string, { threads: { id: string }[]; cursor: string | null }> = {
  first: { threads: [{ id: 'a1' }, { id: 'b2' }], cursor: 'p2' },
  p2: { threads: [{ id: 'c3' }], cursor: null },
}
const searchFolder = vi.fn(async (_m: unknown, _f: string, _t: unknown, _q: string, cursor: string | null) => pages[cursor ?? 'first'])
const starThread = vi.fn(async () => null)
vi.mock('@/lib/mail/list', () => ({ searchFolder: (...a: unknown[]) => (searchFolder as (...x: unknown[]) => unknown)(...a) }))
vi.mock('@/lib/mail/sync', () => ({ mailDb: () => ({}) }))
vi.mock('../cards', () => ({
  cardsForThreads: async () => ({ b2: { id: 'k1', status: 'pending', title: 'x', category: 'money' } }),
  AUTO_PILE: 'auto',
  starThread: (...a: unknown[]) => (starThread as (...x: unknown[]) => unknown)(...a),
}))

const { importGmailStars } = await import('../import-stars')

describe('importGmailStars', () => {
  it("puts every Gmail-starred conversation not already on the list on it, for the AI to pick the pile", async () => {
    const db = {}
    expect(await importGmailStars({ id: 'mb1', tenant_id: 't1' } as never, 'u1', db as never)).toEqual({ found: 3, added: 2 })
    expect(searchFolder.mock.calls.map(c => [c[1], c[3], c[4]])).toEqual([['all', 'is:starred', null], ['all', 'is:starred', 'p2']])
    expect((starThread.mock.calls as unknown[][]).map(c => c.slice(1))).toEqual([['t1', 'a1', 'auto', 'u1'], ['t1', 'c3', 'auto', 'u1']])
  })
})
