import { describe, it, expect } from 'vitest'
import { composeRoofLabel, issueColour, issueLettersToOffer, issuePoints, orderRoofPhotos, pageOneOutOfStep, parseRoofLabel, reportLetters, splitIssueLetters } from '../roof-tags'

// Roof photo labels are a tag (problem letter, fixed type or nothing) and a note.

describe('parseRoofLabel / composeRoofLabel', () => {
  it('reads and writes problem letters, fixed types and plain notes', () => {
    expect(parseRoofLabel('(A)')).toEqual({ tag: { kind: 'issue', letter: 'A' }, note: '' })
    expect(parseRoofLabel('(B) cracked ridge pointing')).toEqual({ tag: { kind: 'issue', letter: 'B' }, note: 'cracked ridge pointing' })
    expect(parseRoofLabel('Gutter Profile')).toEqual({ tag: { kind: 'type', key: 'gutter_profile' }, note: '' })
    expect(parseRoofLabel('gutter profile - 115mm quad')).toEqual({ tag: { kind: 'type', key: 'gutter_profile' }, note: '115mm quad' })
    expect(parseRoofLabel('View of Property')).toEqual({ tag: { kind: 'type', key: 'view_of_property' }, note: '' })
    expect(parseRoofLabel('Rear - loose screw')).toEqual({ tag: { kind: 'none' }, note: 'Rear - loose screw' })
    expect(parseRoofLabel('')).toEqual({ tag: { kind: 'none' }, note: '' })

    expect(composeRoofLabel({ kind: 'issue', letter: 'C' }, ' tile slipped ')).toBe('(C) tile slipped')
    expect(composeRoofLabel({ kind: 'type', key: 'ladder_setup' })).toBe('Ladder Setup')
    expect(composeRoofLabel({ kind: 'type', key: 'downpipe_profile' }, '100x50')).toBe('Downpipe Profile - 100x50')
    expect(composeRoofLabel({ kind: 'none' })).toBe('')
  })

  it('round-trips', () => {
    for (const label of ['(A)', '(H) note', 'Roof Overview', 'Safety Apparatus - anchor point', 'just a note', '']) {
      const { tag, note } = parseRoofLabel(label)
      expect(composeRoofLabel(tag, note)).toBe(label)
    }
  })
})

describe('issuePoints / issueLettersToOffer', () => {
  it('lists each problem in the cause of damage once, with its first point', () => {
    const cause = 'Stormwater entry from 2 defects:\n• (B) Gutter overflow at the downpipe.\n• (A) 17 broken roof tiles.\n• (A) Staining below the tiles.\n• No other breaches.'
    expect(issuePoints(cause)).toEqual([
      { letter: 'A', text: '17 broken roof tiles.' },
      { letter: 'B', text: 'Gutter overflow at the downpipe.' },
    ])
    expect(issuePoints('')).toEqual([])
  })

  it('offers A–C at least, and one spare after the highest in use', () => {
    expect(issueLettersToOffer([])).toEqual(['A', 'B', 'C'])
    expect(issueLettersToOffer(['A', 'B'])).toEqual(['A', 'B', 'C'])
    expect(issueLettersToOffer(['A', 'C'])).toEqual(['A', 'B', 'C', 'D'])
    expect(issueLettersToOffer(['H'])).toHaveLength(9)
  })

  it('keeps going past H: as many problems as the report has, up to Z', () => {
    const cause = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].map(l => `• (${l}) Defect ${l}.`).join('\n')
    expect(issuePoints(cause).map(i => i.letter)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'])
    expect(issueLettersToOffer(['J'])).toHaveLength(11)
    expect(issueLettersToOffer(['Z'])).toHaveLength(26)
    expect(parseRoofLabel('(K) cracked valley')).toEqual({ tag: { kind: 'issue', letter: 'K' }, note: 'cracked valley' })
  })
})

describe('reportLetters', () => {
  it('offers every letter in use anywhere in the report, plus a spare', () => {
    // (D) added to the cause after page one was written with A–C
    expect(reportLetters({ cause: '• (A) a\n• (B) b\n• (C) c\n• (D) d', causeSummary: '(A) a; (B) b; (C) c', problemLines: '(A) x - a\n(B) y - b\n(C) z - c' }))
      .toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(reportLetters({ photoLabels: ['(E) loose screw', 'Gutter Profile', null] })).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
    expect(reportLetters({ marked: [null, 'D'] })).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(reportLetters({})).toEqual(['A', 'B', 'C'])
  })
})

describe('pageOneOutOfStep', () => {
  const written = ['From 3 defects: (A) x; (B) y; (C) z.', '(A) a - x\n(B) b - y\n(C) c - z'] as const
  const basis = 'Stormwater entry from 3 defects:\n• (A) Tiles short of the gutter.\n• (B) Gutter falls the wrong way.\n• (B) Staining on the fascia.\n• (C) 17 broken tiles.'

  it('flags a problem whose words changed since page one was written, in any of its points', () => {
    const step = (cause: string) => pageOneOutOfStep(cause, ...written, basis)
    expect(step(basis.replace('17 broken', '12 broken'))).toMatchObject({ changed: ['C'], otherChanged: false })
    expect(step(basis.replace('Staining on the fascia', 'Staining on the soffit'))).toMatchObject({ changed: ['B'] })
    expect(step(basis.replace('Tiles short of the gutter.', 'The valley iron has rusted through.'))).toMatchObject({ changed: ['A'] })
    expect(step(basis.replace('Stormwater entry', 'Water entry'))).toMatchObject({ changed: [], otherChanged: true })
  })

  it("doesn't flag changes only to capitals, punctuation or spacing, or a cause it has no copy of", () => {
    expect(pageOneOutOfStep(basis.replace('Tiles short of the gutter.', 'tiles  short of the gutter'), ...written, basis)).toMatchObject({ changed: [], otherChanged: false })
    expect(pageOneOutOfStep(basis.replace('17', '12'), ...written, null)).toMatchObject({ changed: [] })
  })

  it("leaves a new problem to 'missing' rather than 'changed'", () => {
    expect(pageOneOutOfStep(basis + '\n• (D) Valley.', ...written, basis)).toMatchObject({ missing: ['D'], changed: [] })
  })

  const cause = '• (A) Tiles short.\n• (B) Gutter falls.\n• (C) Broken tiles.'
  it('is in step when page one mentions exactly the cause of damage\'s letters, or isn\'t written yet', () => {
    expect(pageOneOutOfStep(cause, 'From 3 defects: (A) x; (B) y; (C) z.', '(A) a - x\n(B) b - y\n(C) c - z')).toEqual({ missing: [], gone: [], changed: [], otherChanged: false })
    expect(pageOneOutOfStep(cause, '', '')).toEqual({ missing: [], gone: [], changed: [], otherChanged: false })
  })
  it('says which problems were added to or taken out of the cause since page one was written', () => {
    expect(pageOneOutOfStep(cause + '\n• (D) Valley.', 'From 3 defects: (A) x; (B) y; (C) z.', '(A) a - x\n(B) b - y\n(C) c - z')).toEqual({ missing: ['D'], gone: [], changed: [], otherChanged: false })
    expect(pageOneOutOfStep('• (A) Tiles short.\n• (C) Broken tiles.', 'From 3 defects: (A) x; (B) y; (C) z.', '(A) a - x\n(B) b - y\n(C) c - z')).toEqual({ missing: [], gone: ['B'], changed: [], otherChanged: false })
  })
})

describe('orderRoofPhotos', () => {
  it('front view, roof overview, problems in letter order, then the rest as taken', () => {
    const photos = ['', '(B)', 'Ladder Setup', '(A) x', 'Roof Overview', '(A)', 'View of Property', 'Gutter Profile'].map((label, i) => ({ i, label }))
    expect(orderRoofPhotos(photos).map(p => p.label)).toEqual([
      'View of Property', 'Roof Overview', '(A) x', '(A)', '(B)', '', 'Ladder Setup', 'Gutter Profile',
    ])
  })
})

describe('colours', () => {
  it('gives each letter its own colour, and splits text around the letters', () => {
    expect(new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].map(issueColour)).size).toBe(12)
    expect(issueColour('M')).toBe(issueColour('A'))
    expect(issueColour('?')).toBe('#555555')
    expect(splitIssueLetters('See (A) and (B).')).toEqual([
      { letter: null, text: 'See ' }, { letter: 'A', text: '(A)' }, { letter: null, text: ' and ' }, { letter: 'B', text: '(B)' }, { letter: null, text: '.' },
    ])
  })
})

describe('page one helpers', () => {
  it('reads the problem lines, falling back to the cause of damage', async () => {
    const { problemSummaries } = await import('../roof-tags')
    expect(problemSummaries('(B) Rear gutter - Falls the wrong way\n(A) Enclosed patio – Tiles short of gutter\nnot a problem', '')).toEqual([
      { letter: 'A', location: 'Enclosed patio', text: 'Tiles short of gutter' },
      { letter: 'B', location: 'Rear gutter', text: 'Falls the wrong way' },
    ])
    expect(problemSummaries('', '• (A) 17 broken tiles.')).toEqual([{ letter: 'A', location: '', text: '17 broken tiles.' }])
  })

  it('adds a problem from the cause of damage that page one has no line for yet', async () => {
    const { problemSummaries } = await import('../roof-tags')
    expect(problemSummaries('(A) Enclosed patio - Tiles short of gutter', '• (A) Tiles short.\n• (D) Failed valley iron on the rear roof.')).toEqual([
      { letter: 'A', location: 'Enclosed patio', text: 'Tiles short of gutter' },
      { letter: 'D', location: '', text: 'Failed valley iron on the rear roof.' },
    ])
  })

  it('treats only clearly wide screenshots as wide', async () => {
    const { isWideImage } = await import('../roof-tags')
    expect(isWideImage(1600, 900)).toBe(true)
    expect(isWideImage(1000, 1000)).toBe(false)
    expect(isWideImage(1170, 2532)).toBe(false)
  })
})

describe('problemNames', () => {
  it("names each problem by its location, or the start of the problem when there's no location", async () => {
    const { problemNames } = await import('../roof-tags')
    expect(problemNames('(A) Rear roof - 7 broken tiles\n(B) Box gutter - Failed joint', '')).toEqual({ A: 'Rear roof', B: 'Box gutter' })
    expect(problemNames('', '• (A) Roof tiles do not overlap far enough into the gutter.\n• (B) 17 broken tiles.')).toEqual({ A: 'Roof tiles do not…', B: '17 broken tiles' })
  })
})
