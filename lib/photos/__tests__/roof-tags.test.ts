import { describe, it, expect } from 'vitest'
import { composeRoofLabel, issueColour, issueLettersToOffer, issuePoints, orderRoofPhotos, parseRoofLabel, splitIssueLetters } from '../roof-tags'

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
    expect(issueLettersToOffer(['H'])).toHaveLength(8)
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
    expect(new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map(issueColour)).size).toBe(8)
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

  it('treats only clearly wide screenshots as wide', async () => {
    const { isWideImage } = await import('../roof-tags')
    expect(isWideImage(1600, 900)).toBe(true)
    expect(isWideImage(1000, 1000)).toBe(false)
    expect(isWideImage(1170, 2532)).toBe(false)
  })
})
