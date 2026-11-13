import { describe, it, expect } from 'vitest'
import { cleanMarks, cleanPhotoMarks, markAnchor, markColour, moveMark, shapeCentre, MAX_SHAPE_POINTS } from '../overview-marks'

// Photo markup (the roof overview and any report photo): pins, circles, outlines, arrows and labels, kept as fractions of the image.

describe('cleanMarks', () => {
  it('keeps well-formed marks of each kind, inside the image', () => {
    const marks = cleanMarks([
      { id: 'a', kind: 'pin', letter: 'A', x: 0.2, y: 1.3 },
      { id: 'b', kind: 'pin', letter: 'A', x: 0.4, y: 0.4 },
      { id: 'c', kind: 'area', letter: null, x: 0.5, y: 0.5, rx: 0.1, ry: 0.2 },
      { id: 'd', kind: 'arrow', letter: 'B', x1: 0, y1: 0, x2: 0.5, y2: 0.5 },
      { id: 'e', kind: 'text', letter: null, x: 0.1, y: 0.1, text: '  Patio  ' },
    ])
    expect(marks).toEqual([
      { id: 'a', kind: 'pin', letter: 'A', x: 0.2, y: 1 },
      { id: 'b', kind: 'pin', letter: 'A', x: 0.4, y: 0.4 },
      { id: 'c', kind: 'area', letter: null, x: 0.5, y: 0.5, rx: 0.1, ry: 0.2 },
      { id: 'd', kind: 'arrow', letter: 'B', x1: 0, y1: 0, x2: 0.5, y2: 0.5 },
      { id: 'e', kind: 'text', letter: null, x: 0.1, y: 0.1, text: 'Patio' },
    ])
  })

  it('drops broken marks: a pin with no letter, an empty label, a flat area, an unknown kind', () => {
    expect(cleanMarks([
      { kind: 'pin', letter: null, x: 0.1, y: 0.1 },
      { kind: 'text', letter: null, x: 0.1, y: 0.1, text: ' ' },
      { kind: 'area', letter: 'A', x: 0.1, y: 0.1, rx: 0, ry: 0.1 },
      { kind: 'star', x: 0.1, y: 0.1 },
      'nope',
    ])).toEqual([])
    expect(cleanMarks(undefined)).toEqual([])
  })

  it("reads the first version's pins ({ letter, x, y }) and gives repeated ids new ones", () => {
    const marks = cleanMarks([{ letter: 'C', x: 0.3, y: 0.6 }, { id: 'x', kind: 'pin', letter: 'A', x: 0, y: 0 }, { id: 'x', kind: 'pin', letter: 'B', x: 1, y: 1 }])
    expect(marks.map(m => [m.kind, m.letter])).toEqual([['pin', 'C'], ['pin', 'A'], ['pin', 'B']])
    expect(new Set(marks.map(m => m.id)).size).toBe(3)
  })
})

describe('moveMark / markColour', () => {
  it('moves every kind of mark, staying inside the image', () => {
    expect(moveMark({ id: 'a', kind: 'pin', letter: 'A', x: 0.9, y: 0.5 }, 0.2, -0.1)).toMatchObject({ x: 1, y: 0.4 })
    expect(moveMark({ id: 'b', kind: 'arrow', letter: null, x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.3 }, 0.1, 0.1)).toMatchObject({ x1: 0.2, y1: 0.2, x2: 0.4, y2: 0.4 })
  })

  it('colours a mark by its problem letter, white without one', () => {
    expect(markColour('A')).toBe('#1f5fa8')
    expect(markColour(null)).toBe('#ffffff')
  })
})

describe('outlines', () => {
  const square = [{ x: 0.2, y: 0.2 }, { x: 0.6, y: 0.2 }, { x: 0.6, y: 0.6 }, { x: 0.2, y: 0.6 }]

  it('keeps an outline of 3 or more corners, inside the image, and drops one with fewer', () => {
    expect(cleanMarks([{ id: 's', kind: 'shape', letter: 'A', points: [{ x: -1, y: 0.5 }, { x: 0.5, y: 2 }, { x: 0.5, y: 0.5 }, { x: 'x', y: 0 }] }]))
      .toEqual([{ id: 's', kind: 'shape', letter: 'A', points: [{ x: 0, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0.5, y: 0.5 }] }])
    expect(cleanMarks([{ kind: 'shape', letter: 'A', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, { kind: 'shape', letter: null }])).toEqual([])
    const many = Array.from({ length: 60 }, (_, i) => ({ x: i / 60, y: (i % 2) / 2 }))
    expect((cleanMarks([{ kind: 'shape', letter: null, points: many }])[0] as { points: unknown[] }).points).toHaveLength(MAX_SHAPE_POINTS)
  })

  it('puts the letter and the grab spot in the middle of the outline', () => {
    expect(shapeCentre(square)).toEqual({ x: expect.closeTo(0.4), y: expect.closeTo(0.4) })
    // An L shape's middle sits towards its bigger part
    const l = shapeCentre([{ x: 0, y: 0 }, { x: 0.6, y: 0 }, { x: 0.6, y: 0.2 }, { x: 0.2, y: 0.2 }, { x: 0.2, y: 0.6 }, { x: 0, y: 0.6 }])
    expect(l.x).toBeLessThan(0.3)
    expect(markAnchor({ id: 's', kind: 'shape', letter: 'A', points: square })).toEqual({ x: expect.closeTo(0.4), y: expect.closeTo(0.4) })
    expect(markAnchor({ id: 'a', kind: 'arrow', letter: null, x1: 0, y1: 0, x2: 0.4, y2: 0.2 })).toEqual({ x: 0.2, y: 0.1 })
  })

  it('moves an outline whole, stopping at the edge instead of squashing it', () => {
    const moved = moveMark({ id: 's', kind: 'shape', letter: 'A', points: square }, 0.7, -0.1)
    expect(moved).toMatchObject({ points: [{ x: 0.6, y: 0.1 }, { x: 1, y: 0.1 }, { x: 1, y: 0.5 }, { x: 0.6, y: 0.5 }].map(p => ({ x: expect.closeTo(p.x), y: expect.closeTo(p.y) })) })
  })
})

describe('cleanPhotoMarks', () => {
  it("keeps each photo's well-formed marks and leaves out photos with none", () => {
    expect(cleanPhotoMarks({
      p1: [{ id: 'a', kind: 'area', letter: 'B', x: 0.5, y: 0.5, rx: 0.1, ry: 0.1 }],
      p2: [{ kind: 'pin', letter: null, x: 0, y: 0 }],
      p3: 'nope',
    })).toEqual({ p1: [{ id: 'a', kind: 'area', letter: 'B', x: 0.5, y: 0.5, rx: 0.1, ry: 0.1 }] })
    expect(cleanPhotoMarks(null)).toEqual({})
    expect(cleanPhotoMarks([1, 2])).toEqual({})
  })
})
