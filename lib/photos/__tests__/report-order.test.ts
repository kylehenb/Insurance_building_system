import { describe, it, expect } from 'vitest'
import {
  applyAiLabels, groupPhotosForReport, MUD_MAP_LABEL, orderReportPhotos, photoKindOfLabel, roomOfLabel,
  VIEW_OF_PROPERTY_LABEL, type AiPhotoLabel,
} from '../report-order'

// Report photo order: one View of Property, then every Mud Map/Floor Plan, then the rest —
// grouped room by room in walk order for the report.

const p = (id: string, label: string | null, room?: string, roomConfidence?: number) => ({ id, label, room, roomConfidence })
const ids = (list: { id: string }[]) => list.map(x => x.id)
const ai = (kind: AiPhotoLabel['kind'], label: string, confidence = 0.9): AiPhotoLabel => ({ kind, label, confidence })
const none = () => false

describe('photoKindOfLabel', () => {
  it('recognises the lead labels however they are typed', () => {
    expect(photoKindOfLabel('View of Property')).toBe('view_of_property')
    expect(photoKindOfLabel(' view of property ')).toBe('view_of_property')
    expect(photoKindOfLabel('Mud Map/Floor Plan')).toBe('mud_map')
    expect(photoKindOfLabel('mud map / floor plan 2')).toBe('mud_map')
    expect(photoKindOfLabel('Kitchen - view of property damage')).toBe('other')
    expect(photoKindOfLabel(null)).toBe('other')
  })
})

describe('orderReportPhotos', () => {
  it('puts the view first, then all mud maps, keeping the rest in order', () => {
    const list = [p('a', 'Kitchen - ceiling'), p('b', MUD_MAP_LABEL), p('c', 'Bathroom - tiles'), p('d', VIEW_OF_PROPERTY_LABEL), p('e', MUD_MAP_LABEL)]
    expect(ids(orderReportPhotos(list))).toEqual(['d', 'b', 'e', 'a', 'c'])
  })

  it('leads with only one view of property', () => {
    const list = [p('a', 'Lounge'), p('b', VIEW_OF_PROPERTY_LABEL), p('c', VIEW_OF_PROPERTY_LABEL)]
    expect(ids(orderReportPhotos(list))).toEqual(['b', 'a', 'c'])
  })

  it('leaves photos without lead labels as they are', () => {
    expect(ids(orderReportPhotos([p('a', 'x'), p('b', null), p('c', '')]))).toEqual(['a', 'b', 'c'])
  })
})

describe('applyAiLabels', () => {
  it('uses the fixed wording for the surest front view and every mud map', () => {
    const labels = applyAiLabels(['', '', '', ''], [
      ai('other', 'Kitchen - water-stained ceiling'),
      ai('view_of_property', 'Front elevation - street view', 0.6),
      ai('mud_map', 'Floor plan sketch'),
      ai('view_of_property', 'Front of house from driveway', 0.95),
    ], { keep: none })
    expect(labels).toEqual(['Kitchen - water-stained ceiling', 'Front elevation - street view', MUD_MAP_LABEL, VIEW_OF_PROPERTY_LABEL])
  })

  it('keeps the inspector’s labels, and their view of property wins', () => {
    const labels = applyAiLabels([VIEW_OF_PROPERTY_LABEL, '', 'Laundry - my label'], [
      ai('view_of_property', 'Front - street', 0.9),
      ai('view_of_property', 'Front elevation - driveway', 0.99),
      ai('other', 'Laundry - tub'),
    ], { keep: i => i !== 1 })
    expect(labels).toEqual([VIEW_OF_PROPERTY_LABEL, 'Front elevation - driveway', 'Laundry - my label'])
  })

  it('leaves a photo the AI missed alone', () => {
    expect(applyAiLabels(['Old', 'Old 2'], [ai('other', 'New'), null], { keep: none })).toEqual(['New', 'Old 2'])
  })

  it('never lets an ordinary photo carry a lead label', () => {
    expect(applyAiLabels([''], [ai('other', VIEW_OF_PROPERTY_LABEL)], { keep: none })).toEqual([''])
  })
})

describe('roomOfLabel', () => {
  it('takes the part before the dash', () => {
    expect(roomOfLabel('Bathroom 2 - no visible damage')).toBe('Bathroom 2')
    expect(roomOfLabel('Kitchen – cabinet')).toBe('Kitchen')
    expect(roomOfLabel('Water-damaged ceiling')).toBe('')
    expect(roomOfLabel(null)).toBe('')
  })
})

describe('groupPhotosForReport', () => {
  it('groups rooms in walk order, keeping the order taken within each room', () => {
    const list = [
      p('k1', 'Kitchen - wide', 'Kitchen'),
      p('b1', 'Bathroom - wide', 'Bathroom'),
      p('k2', 'Kitchen - cabinet', 'kitchen'), // came back to the kitchen
      p('v', VIEW_OF_PROPERTY_LABEL, 'External'),
      p('b2', 'Bathroom - tiles', 'Bathroom'),
      p('m', MUD_MAP_LABEL),
    ]
    expect(ids(groupPhotosForReport(list))).toEqual(['v', 'm', 'k1', 'k2', 'b1', 'b2'])
  })

  it('keeps a photo with an unknown or unsure room next to the one before it', () => {
    const list = [
      p('k1', 'Kitchen - wide', 'Kitchen'),
      p('x', 'Internal - close-up', '', 0),
      p('b1', 'Bathroom - wide', 'Bathroom'),
      p('y', 'Lounge? - stain', 'Lounge', 0.3),
      p('k2', 'Kitchen - floor', 'Kitchen'),
    ]
    expect(ids(groupPhotosForReport(list))).toEqual(['k1', 'x', 'k2', 'b1', 'y'])
  })

  it('leaves photos alone when no rooms are known', () => {
    expect(ids(groupPhotosForReport([p('a', 'x'), p('b', 'y'), p('c', 'z')]))).toEqual(['a', 'b', 'c'])
  })
})
