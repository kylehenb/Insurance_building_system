import { describe, it, expect, vi } from 'vitest'
import { buildCatalogue, displayWording, fillQuantity, insurerTagMatches, normaliseUnit, parseQty, type LibraryRow } from '../pricing'
import { createScopeSearch, usesByItem } from '../search'
import { buildFieldScopeLines, normaliseFieldRooms, notesText, readParsedNotes, type ParsedNote } from '../field-scope'

// The scope library rule shared by the field app, field submission, the quote
// editor's search and the voice connector: which items a job can pick, at
// what price, and how field notes become quote lines.

const row = (id: string, over: Partial<LibraryRow> = {}): LibraryRow => ({
  id, trade: 'Painter', keyword: null, item_description: `Item ${id}`, unit: 'm2', labour_per_unit: 10, materials_per_unit: 3,
  total_per_unit: 13, trade_rate_total: null, estimated_hours: null, insurer_specific: null, approval_status: 'approved', ...over,
})

const midcity = { id: 'ins-midcity', names: ['Midcity'] }
const allianz = { id: 'ins-allianz', names: ['Allianz', 'Allianz Australia Insurance Limited'] }

// A slice of the real library
const library: LibraryRow[] = [
  row('paintCeiling', { keyword: 'paintCeiling', item_description: 'Prepare and paint ceiling and cornice in a similar colour and finish to existing. [{QTY}.0m2]', unit: 'Each' }),
  row('paintWalls', { keyword: 'paintallWall', item_description: 'Prepare and paint all walls in a similar colour and finish to existing. [{QTY}.0m2]', materials_per_unit: 5, total_per_unit: 15 }),
  row('ceilingRepair', { trade: 'Ceiling Fixer', keyword: 'ceiling', item_description: 'Repair plasterboard ceiling ready for painting. [{QTY}.0m2]', labour_per_unit: 175, materials_per_unit: 25, total_per_unit: 200, insurer_specific: 'Midcity' }),
  row('corniceStd', { trade: 'Ceiling Fixer', keyword: 'replace cornice', item_description: 'Remove, dispose, supply and install plasterboard cornices. (Note: {QTY} walls)', unit: 'lm', labour_per_unit: 20, materials_per_unit: 8, total_per_unit: 28 }),
  row('corniceMidcity', { trade: 'Ceiling Fixer', keyword: 'replace cornice', item_description: 'Remove, dispose, supply and install plasterboard cornice ({QTY} walls). [{QTY}.0lm]', unit: 'lm', labour_per_unit: 22, materials_per_unit: 8, total_per_unit: 30, insurer_specific: 'Midcity' }),
  row('downlightRr', { trade: 'Electrician', keyword: 'downlightrrBULK', item_description: 'Disconnect / reconnect downlights to facilitate ceiling repairs. [{QTY} unit]', unit: 'Each', labour_per_unit: 60, materials_per_unit: 0, total_per_unit: 60 }),
  row('exhaustRr', { trade: 'Electrician', keyword: 'exhaustfanrrBULK', item_description: 'Disconnect / reconnect exhaust fan to facilitate ceiling repairs. [{QTY} unit]', unit: 'Each', labour_per_unit: 120, materials_per_unit: 0, total_per_unit: 120 }),
  row('basinRr', { trade: 'Plumber', keyword: 'basinRr', item_description: 'Disconnect / reconnect basin to facilitate repairs. [{QTY} unit]', unit: null, labour_per_unit: null, materials_per_unit: null, total_per_unit: 400 }),
  row('dustDefault', { trade: 'Removalist', keyword: 'dustMitigation', item_description: 'Install dust mitigation measures.', insurer_specific: 'Default' }),
  row('archived', { approval_status: 'archived', item_description: 'Carpenter Hourly Rate' }),
  row('pending', { approval_status: 'pending', trade: 'Plumber', item_description: 'Disconnect / reconnect toilet suite to facilitate repairs', labour_per_unit: null, materials_per_unit: null, total_per_unit: null }),
]

describe('insurer rows', () => {
  it('reads "Default" and blank as every insurer, and matches names loosely', () => {
    expect(insurerTagMatches('Default', null)).toBe(true)
    expect(insurerTagMatches(null, allianz)).toBe(true)
    expect(insurerTagMatches('Midcity', midcity)).toBe(true)
    expect(insurerTagMatches('Midcity', { id: null, names: ['MidCity Insurance'] })).toBe(true)
    expect(insurerTagMatches('Midcity', allianz)).toBe(false)
    expect(insurerTagMatches('BGC', null)).toBe(false)
  })

  it('offers a Midcity job the Midcity rows in place of the standard ones with the same keyword', () => {
    const ids = buildCatalogue(library, [], midcity).map(i => i.id)
    expect(ids).toContain('ceilingRepair')
    expect(ids).toContain('corniceMidcity')
    expect(ids).not.toContain('corniceStd')
    expect(ids).not.toContain('archived')
    // Insurer's own items first
    expect(ids.slice(0, 2).sort()).toEqual(['ceilingRepair', 'corniceMidcity'])
  })

  it('keeps other insurers\' rows away from an Allianz job (and a job with no insurer)', () => {
    for (const insurer of [allianz, null]) {
      const ids = buildCatalogue(library, [], insurer).map(i => i.id)
      expect(ids).toContain('corniceStd')
      expect(ids).not.toContain('corniceMidcity')
      expect(ids).not.toContain('ceilingRepair')
      expect(ids).toContain('dustDefault')
    }
  })

  it('uses the insurer\'s override rates and wording', () => {
    const overrides = [
      { scope_library_id: 'paintWalls', insurer_id: 'ins-allianz', labour_per_unit: 12, materials_per_unit: 6, total_per_unit: 18, wording_single: 'Paint walls (Allianz wording). [{QTY}.0m2]' },
      { scope_library_id: 'paintCeiling', insurer_id: 'ins-midcity', labour_per_unit: 99, materials_per_unit: 1, total_per_unit: 100, wording_single: null },
    ]
    const walls = buildCatalogue(library, overrides, allianz).find(i => i.id === 'paintWalls')!
    expect(walls).toMatchObject({ rate_labour: 12, rate_materials: 6, item_description: 'Paint walls (Allianz wording). [{QTY}.0m2]', insurer_specific: 'Allianz' })
    // Another insurer's override doesn't apply
    const ceiling = buildCatalogue(library, overrides, allianz).find(i => i.id === 'paintCeiling')!
    expect(ceiling).toMatchObject({ rate_labour: 10, rate_materials: 3, insurer_specific: null })
  })

  it('puts a total-only price on labour and normalises units', () => {
    const basin = buildCatalogue(library, [], null).find(i => i.id === 'basinRr')!
    expect(basin).toMatchObject({ rate_labour: 400, rate_materials: 0, unit: null })
    expect(buildCatalogue(library, [], null).find(i => i.id === 'paintCeiling')!.unit).toBe('ea')
    expect(normaliseUnit('m2')).toBe('m²')
    expect(normaliseUnit('LM')).toBe('lm')
    expect(normaliseUnit('Each')).toBe('ea')
    expect(normaliseUnit('Hours')).toBe('hr')
    expect(normaliseUnit('bag')).toBe('bag')
  })

  it('marks items saved from a quote as pending', () => {
    expect(buildCatalogue(library, [], null).find(i => i.id === 'pending')!.pending).toBe(true)
  })
})

describe('quantities', () => {
  it('fills {QTY} placeholders', () => {
    expect(fillQuantity('Paint ceiling. [{QTY}.0m2]', 9)).toBe('Paint ceiling. [9.0m2]')
    expect(fillQuantity('Paint ceiling. [{QTY}.0m2]', 9.5)).toBe('Paint ceiling. [9.5m2]')
    expect(fillQuantity('Cornice ({QTY} walls). [{QTY}.0lm]', 2)).toBe('Cornice (2 walls). [2.0lm]')
    expect(fillQuantity('Reconnect basin. [{qty} unit]', 1)).toBe('Reconnect basin. [1 unit]')
    expect(fillQuantity('Paint ceiling. [{QTY}.0m2]', null)).toBe('Paint ceiling. [{QTY}.0m2]')
  })

  it('hides placeholders for reading in the field', () => {
    expect(displayWording('Paint ceiling. [{QTY}.0m2]')).toBe('Paint ceiling.')
    expect(displayWording('Install cornice ({QTY} walls). [{QTY}.0lm]')).toBe('Install cornice (# walls).')
    expect(displayWording('Remove furniture. [1 Unit]')).toBe('Remove furniture. [1 Unit]')
  })

  it('reads typed quantities', () => {
    expect(parseQty('9')).toBe(9)
    expect(parseQty('2,5')).toBe(2.5)
    expect(parseQty(' 13 lm')).toBe(13)
    expect(parseQty('')).toBeNull()
    expect(parseQty('abc')).toBeNull()
  })
})

describe('fuzzy search', () => {
  const catalogue = buildCatalogue(library, [], midcity)
  const search = createScopeSearch(catalogue)

  it('finds items by words in any order, keyword or shorthand', () => {
    expect(search('ceiling paint')[0].id).toBe('paintCeiling')
    expect(search('paint walls')[0].id).toBe('paintWalls')
    expect(search('downlight rr')[0].id).toBe('downlightRr')
    expect(search('exhaust')[0].id).toBe('exhaustRr')
    expect(search('basin')[0].id).toBe('basinRr')
  })

  it('tolerates typos', () => {
    expect(search('downlite')[0]?.id).toBe('downlightRr')
    expect(search('cornise')[0]?.id).toBe('corniceMidcity')
  })

  it('needs two letters and finds nothing for unrelated words', () => {
    expect(search('p')).toEqual([])
    expect(search('swimming pool fence')).toEqual([])
  })
})

describe('search order by use', () => {
  const item = (id: string, keyword: string, item_description: string, uses: number, trade = 'Painter') =>
    ({ id, keyword, item_description, trade, uses })
  const items = [
    item('wardrobeCeiling', 'paintWardrobeCeiling', 'Prepare and paint wardrobe ceiling in a similar colour and finish to existing.', 0),
    item('ceilingReplace', 'ceiling', 'Remove, dispose, supply and install plasterboard ceiling ready for painting.', 3, 'Ceiling Fixer'),
    item('paintCeiling', 'paintCeiling', 'Prepare and paint ceiling and cornice in a similar colour and finish to existing.', 40),
    item('insulation', 'insulation', 'Remove, dispose, supply and install ceiling insulation batts R4.1.', 12, 'Ceiling Fixer'),
    item('corniceReplace', 'replace cornice', 'Remove, dispose, supply and install plasterboard cornices.', 25, 'Ceiling Fixer'),
    item('skirtingReplace', 'skirting', 'Remove, dispose, supply and install skirting boards.', 1, 'Carpenter'),
    item('paintSkirting', 'paintSkirting', 'Prepare and paint skirting boards in a similar colour and finish to existing.', 0),
    item('doorInternal', 'doorinternal', 'Remove, dispose, supply and install internal door, hollow core.', 0, 'Carpenter'),
    item('cabinet', '', 'Remove, dispose, supply and install base cabinet carcass. Re use doors.', 30, 'Cabinet Maker'),
  ]
  const search = createScopeSearch(items)
  const ids = (q: string) => search(q).map(i => i.id)

  it('puts the most used match first, also while still typing', () => {
    expect(ids('ceiling')[0]).toBe('paintCeiling')
    expect(ids('cei')[0]).toBe('paintCeiling')
    expect(ids('ceiling').indexOf('ceilingReplace')).toBeLessThan(ids('ceiling').indexOf('wardrobeCeiling'))
  })

  it('never lets a popular item jump ahead for a word it doesn\'t contain', () => {
    expect(ids('skirting')).toEqual(['skirtingReplace', 'paintSkirting'])
    expect(ids('sk')).not.toContain('paintCeiling')
    // A Ceiling Fixer's cornice item still turns up (by its trade), but after every ceiling item
    expect(ids('ceiling').slice(-1)).toEqual(['corniceReplace'])
  })

  it('puts items named by the words ahead of items that mention them in passing', () => {
    expect(ids('door')[0]).toBe('doorInternal')
    expect(ids('paint ceiling')[0]).toBe('paintCeiling')
    expect(ids('paint ceiling').indexOf('wardrobeCeiling')).toBeLessThan(ids('paint ceiling').indexOf('ceilingReplace'))
  })

  it('counts uses per item, and an insurer\'s own item gets the uses of the row it replaces', () => {
    const uses = usesByItem(
      [{ id: 'paintCeiling', keyword: 'paintCeiling' }, { id: 'ceilingMidcity', keyword: 'ceiling' }, { id: 'unused', keyword: null }],
      [
        { scope_library_id: 'paintCeiling', keyword: 'paintCeiling', uses: 4 },
        { scope_library_id: 'ceilingStd', keyword: 'Ceiling', uses: 3 },
        { scope_library_id: 'ceilingMidcity', keyword: 'ceiling', uses: 1 },
      ],
    )
    expect(Object.fromEntries(uses)).toEqual({ paintCeiling: 4, ceilingMidcity: 4, unused: 0 })
  })
})

describe('field scope → quote lines', () => {
  const catalogue = buildCatalogue(library, [], midcity)

  it('reads the current item shape and older plain strings, dropping empty items and rooms', () => {
    expect(normaliseFieldRooms([
      { room: 'Bathroom', l: '3', w: '3', h: '2.4', items: [{ text: 'Disconnect…', qty: '2', libraryId: 'downlightRr' }, { text: '', qty: '', libraryId: null }] },
      { name: 'Ensuite', l: '', w: '', h: '', items: ['Paint 2 walls 8', ''] },
      { room: 'Empty', items: [''] },
    ])).toEqual([
      { room: 'Bathroom', l: '3', w: '3', h: '2.4', items: [{ text: 'Disconnect…', qty: 2, libraryId: 'downlightRr' }] },
      { room: 'Ensuite', l: '', w: '', h: '', items: [{ text: 'Paint 2 walls 8', qty: null, libraryId: null }] },
    ])
  })

  it('puts library picks on exactly — wording with qty, insurer rates — without asking the AI', async () => {
    const parse = vi.fn(async () => [] as ParsedNote[])
    const lines = await buildFieldScopeLines(normaliseFieldRooms([
      { room: 'Bathroom', items: [{ text: 'whatever was shown', qty: '13', libraryId: 'corniceMidcity' }, { text: 'x', qty: '2', libraryId: 'downlightRr' }] },
    ]), catalogue, parse)
    expect(parse).not.toHaveBeenCalled()
    expect(lines).toEqual([
      expect.objectContaining({ room: 'Bathroom', scope_library_id: 'corniceMidcity', is_custom: false, qty: 13, unit: 'lm', rate_labour: 22, rate_materials: 8, trade: 'Ceiling Fixer',
        item_description: 'Remove, dispose, supply and install plasterboard cornice (13 walls). [13.0lm]' }),
      expect.objectContaining({ scope_library_id: 'downlightRr', qty: 2, rate_labour: 60, item_description: 'Disconnect / reconnect downlights to facilitate ceiling repairs. [2 unit]' }),
    ])
  })

  it('sends custom notes to the AI: a match is priced like a pick, a new line goes on at $0, in the inspector\'s order', async () => {
    const parse = vi.fn(async (notes: { n: number; text: string }[]) => {
      expect(notes.map(n => n.text)).toEqual(['Paint ceiling 9', 'Metal door frame 720 x 2040 replace'])
      const paintIdx = catalogue.findIndex(c => c.id === 'paintCeiling') + 1
      return [
        { note: 2, trade: 'Carpenter', keyword: 'metalDoorFrame', qty: 1, unit: 'each', itemDescription: 'Remove, dispose, supply and install metal door frame (720 mm x 2040 mm).', libId: null },
        { note: 1, qty: 9, itemDescription: 'ignored for a match', libId: paintIdx },
      ] as ParsedNote[]
    })
    const lines = await buildFieldScopeLines(normaliseFieldRooms([
      { room: 'Bathroom', items: [
        { text: 'Paint ceiling 9', qty: '', libraryId: null },
        { text: 'Disconnect', qty: '1', libraryId: 'exhaustRr' },
        { text: 'Metal door frame 720 x 2040 replace', qty: '', libraryId: null },
      ] },
    ]), catalogue, parse)
    expect(lines.map(l => l.scope_library_id)).toEqual(['paintCeiling', 'exhaustRr', null])
    expect(lines[0]).toMatchObject({ item_description: 'Prepare and paint ceiling and cornice in a similar colour and finish to existing. [9.0m2]', qty: 9, rate_labour: 10, rate_materials: 3, is_custom: false })
    expect(lines[2]).toMatchObject({ item_description: 'Remove, dispose, supply and install metal door frame (720 mm x 2040 mm).', trade: 'Carpenter', unit: 'ea', qty: 1, rate_labour: 0, rate_materials: 0, is_custom: true })
  })

  it('keeps the inspector\'s quantity over the AI\'s, and a pick no longer in the library goes to the AI', async () => {
    const parse = vi.fn(async () => [{ note: 1, qty: 99, itemDescription: 'Install dust mitigation measures to the bathroom.', libId: null }] as ParsedNote[])
    const lines = await buildFieldScopeLines(normaliseFieldRooms([
      { room: 'Bathroom', items: [{ text: 'dust protection', qty: '3', libraryId: 'archived' }] },
    ]), catalogue, parse)
    expect(lines).toEqual([expect.objectContaining({ qty: 3, is_custom: true, item_description: 'Install dust mitigation measures to the bathroom.' })])
  })

  it('adds the notes as typed, at $0, when the AI fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const lines = await buildFieldScopeLines(normaliseFieldRooms([{ room: '', items: ['Rr shower screen'] }]), catalogue, async () => { throw new Error('down') })
    expect(lines).toEqual([expect.objectContaining({ room: 'General', item_description: 'Rr shower screen', rate_labour: 0, rate_materials: 0, is_custom: true })])
  })

  it('gives the AI each note with its room, dimensions and entered quantity', () => {
    expect(notesText([{ n: 1, room: 'Bathroom', dims: '3×3×2.4', text: 'Ceiling replace', qty: 9 }, { n: 2, room: 'WIR', dims: '', text: 'Furniture r', qty: null }]))
      .toBe('1. [Bathroom 3×3×2.4m] Ceiling replace (qty entered: 9)\n2. [WIR] Furniture r')
  })

  it('reads the AI reply in the stored prompt\'s shape and the older one', () => {
    expect(readParsedNotes('Here you go: [{"room":"Bathroom","itemDescription":"A","confidence":"MATCHED","libId":3,"qty":"2"},{"item_description":"B","confidence":"NEW","libId":4}]')).toEqual([
      expect.objectContaining({ itemDescription: 'A', libId: 3, qty: 2, note: null }),
      expect.objectContaining({ itemDescription: 'B', libId: null }),
    ])
    expect(readParsedNotes('no json')).toEqual([])
  })
})
