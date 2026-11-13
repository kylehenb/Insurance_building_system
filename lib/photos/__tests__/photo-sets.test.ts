import { describe, it, expect } from 'vitest'
import { composeMakeSafeLabel, inPhotoSet, isMakeSafePhotoId, parseMakeSafeLabel } from '../photo-sets'

// Bindi Co's two photo sets (roof report, make safe report) through one uploader, and make safe photo labels.

describe('photo sets', () => {
  it("tells a make safe photo from a roof (or IRC) photo by its client id", () => {
    expect(isMakeSafePhotoId('msm0abc123')).toBe(true)
    expect(isMakeSafePhotoId('pm0abc123')).toBe(false)
    expect(isMakeSafePhotoId(null)).toBe(false)
    expect(inPhotoSet('msm0abc123', 'makesafe')).toBe(true)
    expect(inPhotoSet('msm0abc123', 'main')).toBe(false)
    expect(inPhotoSet('pm0abc123', 'main')).toBe(true)
  })
})

describe('make safe photo labels', () => {
  it('reads Before / After and a note, or just a note', () => {
    expect(parseMakeSafeLabel('Before')).toEqual({ stage: 'Before', note: '' })
    expect(parseMakeSafeLabel('after - tarp over valley')).toEqual({ stage: 'After', note: 'tarp over valley' })
    expect(parseMakeSafeLabel('loose sheet')).toEqual({ stage: null, note: 'loose sheet' })
    expect(parseMakeSafeLabel('Beforehand')).toEqual({ stage: null, note: 'Beforehand' })
  })

  it('writes them back, keeping the space while a note is typed', () => {
    expect(composeMakeSafeLabel('After', 'tarp ')).toBe('After - tarp ')
    expect(parseMakeSafeLabel(composeMakeSafeLabel('After', 'tarp ')).note).toBe('tarp ')
    expect(composeMakeSafeLabel('Before', '  ')).toBe('Before')
    expect(composeMakeSafeLabel(null, 'note')).toBe('note')
  })
})
