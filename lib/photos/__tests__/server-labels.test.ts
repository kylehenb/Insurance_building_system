import { describe, it, expect, vi, beforeEach } from 'vitest'

// Submit finishes the field photos: labels from the text pass, one View of
// Property, the rest grouped by room in walk order, attached to the report.
// The inspector's labels and order always win.

const relabelWithNotes = vi.fn()
vi.mock('../ai-label', () => ({ labelPhotos: vi.fn(), relabelWithNotes }))
vi.mock('@/lib/images/downscale', () => ({ downscaleImage: vi.fn() }))

const { finaliseFieldPhotos, scopeFromRooms, loadCorrections } = await import('../server-labels')

type Row = Record<string, unknown>

/** Just enough of the Supabase client for these functions: reads come from `tables`, updates are recorded. */
function fakeService(tables: Record<string, Row[]>) {
  const updates: { table: string; patch: Row; filters: [string, unknown][] }[] = []
  const from = (table: string) => {
    const filters: [string, unknown][] = []
    let patch: Row | null = null
    let head = false
    const builder: Record<string, unknown> = {}
    const chain = (fn?: (...a: unknown[]) => void) => (...a: unknown[]) => { fn?.(...a); return builder }
    Object.assign(builder, {
      select: chain((_c, opts) => { head = !!(opts as { head?: boolean })?.head }),
      update: chain(p => { patch = p as Row }),
      eq: chain((k, v) => filters.push([k as string, v])),
      in: chain(), not: chain(), is: chain(), or: chain(), order: chain(), limit: chain(),
      maybeSingle: () => Promise.resolve({ data: (tables[table] ?? [])[0] ?? null }),
      then: (resolve: (v: unknown) => void) => {
        if (patch) { updates.push({ table, patch, filters }); return resolve({ error: null }) }
        const rows = tables[table] ?? []
        return resolve(head ? { count: table === 'photos' ? 0 : rows.length } : { data: rows })
      },
    })
    return builder
  }
  return { service: { from, rpc: vi.fn().mockResolvedValue({ data: [] }) } as never, updates }
}

const photo = (id: string, over: Row = {}): Row => ({
  id, client_id: id, tenant_id: 't1', storage_path: `${id}.jpg`, label: null, report_id: null,
  ai_status: 'done', ai_seen: `seen ${id}`, ai_kind: 'other', ai_label: `${id} label`, ai_room: '', ai_confidence: 0.9, ai_room_confidence: 0.9,
  ...over,
})

beforeEach(() => { relabelWithNotes.mockReset() })

describe('finaliseFieldPhotos', () => {
  it('labels, picks the view, groups rooms in walk order and attaches to the report', async () => {
    const rows = [
      photo('k1', { ai_room: 'Kitchen', ai_label: 'Internal - ceiling stain' }),
      photo('b1', { ai_room: 'Bathroom', ai_label: 'Bathroom - vanity' }),
      photo('front', { ai_kind: 'view_of_property', ai_room: 'External', ai_label: 'Front elevation - street' }),
      photo('k2', { ai_room: 'Kitchen', ai_label: 'Kitchen - cabinet' }),
      photo('mine', { ai_room: 'Laundry', ai_label: 'Laundry - tub' }),
    ]
    const { service, updates } = fakeService({ photos: rows, inspections: [{ job_id: 'j1', field_draft: {} }], jobs: [], prompts: [] })
    relabelWithNotes.mockResolvedValue([{ room: 'Kitchen', label: 'Kitchen - water-stained ceiling' }, null, null, null, null])

    await finaliseFieldPhotos({
      service, tenantId: 't1', inspectionId: 'i1', reportId: 'r1', notes: 'notes', scopeRooms: [],
      manifest: ['k1', 'b1', 'front', 'k2', 'mine'].map(id => ({ clientId: id, label: id === 'mine' ? 'Laundry - my words' : '', labelSource: id === 'mine' ? 'inspector' as const : 'ai' as const })),
    })

    const photoUpdates = updates.filter(u => u.table === 'photos' && 'sequence_number' in u.patch)
    const byId: Record<string, Row> = Object.fromEntries(photoUpdates.map(u => [String(u.filters.find(f => f[0] === 'id')![1]), u.patch]))
    expect(Object.entries(byId).sort((a, b) => (a[1].sequence_number as number) - (b[1].sequence_number as number)).map(e => e[0]))
      .toEqual(['front', 'k1', 'k2', 'b1', 'mine'])
    expect(byId.front).toMatchObject({ label: 'View of Property', report_id: 'r1' })
    expect(byId.k1).toMatchObject({ label: 'Kitchen - water-stained ceiling', ai_label: 'Kitchen - water-stained ceiling' })
    // The inspector's label stays; the AI's suggestion is kept to learn from
    expect(byId.mine).toMatchObject({ label: 'Laundry - my words', ai_label: 'Laundry - tub' })
    // The inspector's photo went to the text pass as context only
    expect(relabelWithNotes.mock.calls[0][0][4]).toMatchObject({ locked: true, label: 'Laundry - my words' })
  })

  it('keeps the photo-only labels when the text pass fails', async () => {
    const { service, updates } = fakeService({ photos: [photo('a', { ai_label: 'Kitchen - oven' })], inspections: [{}], jobs: [], prompts: [] })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    relabelWithNotes.mockRejectedValue(new Error('down'))
    await finaliseFieldPhotos({ service, tenantId: 't1', inspectionId: 'i1', reportId: 'r1', notes: '', scopeRooms: [], manifest: [] })
    expect(updates.find(u => 'sequence_number' in u.patch)?.patch).toMatchObject({ label: 'Kitchen - oven', sequence_number: 1, report_id: 'r1' })
  })
})

describe('scopeFromRooms', () => {
  it('reads the field app’s scope rooms in either shape', () => {
    expect(scopeFromRooms([{ name: 'Kitchen', items: ['ceiling', ''] }, { room: 'Bed 2', items: [{ text: 'carpet' }] }, { name: '', items: [] }]))
      .toEqual({ scopeRooms: ['Kitchen', 'Bed 2'], scopeText: 'Kitchen: ceiling\nBed 2: carpet' })
    expect(scopeFromRooms(undefined)).toEqual({ scopeRooms: [], scopeText: '' })
  })
})

describe('loadCorrections', () => {
  it('keeps real changes to descriptive labels only', async () => {
    const { service } = fakeService({ photos: [
      { ai_seen: 's', ai_label: 'Lounge - stain', ai_kind: 'other', label: 'Family Room - water stain' },
      { ai_seen: 's', ai_label: 'Kitchen - oven', ai_kind: 'other', label: 'kitchen -  oven' },
      { ai_seen: 's', ai_label: 'Front - street', ai_kind: 'view_of_property', label: 'View of Property' },
      { ai_seen: 's', ai_label: 'Hall - wall', ai_kind: 'other', label: null },
    ] })
    expect(await loadCorrections(service, 't1')).toEqual([{ seen: 's', aiLabel: 'Lounge - stain', finalLabel: 'Family Room - water stain' }])
  })
})
