import { fillQuantity, normaliseUnit, parseQty, type CatalogueItem } from './pricing'

// Turning the field app's scope (rooms of items: a description, a quantity
// and — when picked from the search — a library item) into quote lines.
//
// - A library pick goes straight onto the quote: the library's wording (qty
//   filled in), unit and trade, at the job's insurer's rates. No AI.
// - A custom item goes to the AI with the scope library, which either matches
//   it to a library item (then it's priced like a pick) or writes a new line
//   in the library's style, at $0 for the office to price.

/** One item as the field app sends it. Older drafts and clients send plain strings. */
export interface FieldScopeItem {
  text: string
  qty: number | null
  libraryId: string | null
}

export interface FieldScopeRoom {
  room: string
  l: string
  w: string
  h: string
  items: FieldScopeItem[]
}

/** A note the AI is asked to turn into a line */
export interface ScopeNote {
  /** 1-based, in the order sent */
  n: number
  room: string
  /** The room's L×W×H as entered, e.g. "3×3×2.4" */
  dims: string
  text: string
  qty: number | null
}

/** The AI's answer for one note */
export interface ParsedNote {
  note: number | null
  room?: string | null
  trade?: string | null
  keyword?: string | null
  qty?: number | null
  unit?: string | null
  itemDescription?: string | null
  /** The library item's number in the list given to the AI, when it matched one */
  libId?: number | null
}

export interface FieldScopeLine {
  room: string
  trade: string | null
  keyword: string | null
  item_description: string
  qty: number | null
  unit: string | null
  rate_labour: number | null
  rate_materials: number | null
  trade_rate_total: number | null
  estimated_hours: number | null
  scope_library_id: string | null
  is_custom: boolean
}

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))

/** The rooms from the submit body (or a saved draft), items in the current shape. Empty items dropped. */
export function normaliseFieldRooms(rooms: unknown): FieldScopeRoom[] {
  if (!Array.isArray(rooms)) return []
  return rooms.map((r: Record<string, unknown>) => ({
    room: str(r?.room ?? r?.name).trim(),
    l: str(r?.l), w: str(r?.w), h: str(r?.h),
    items: (Array.isArray(r?.items) ? r.items : [])
      .map((i: unknown): FieldScopeItem => {
        if (i && typeof i === 'object') {
          const o = i as Record<string, unknown>
          return { text: str(o.text).trim(), qty: parseQty(o.qty), libraryId: str(o.libraryId).trim() || null }
        }
        return { text: str(i).trim(), qty: null, libraryId: null }
      })
      .filter(i => i.text || i.libraryId),
  })).filter(r => r.items.length > 0)
}

/** A quote line for a library item: its wording with the qty filled in, at the catalogue's (insurer's) rates. */
export function libraryLine(room: string, lib: CatalogueItem, qty: number | null): FieldScopeLine {
  return {
    room,
    trade: lib.trade,
    keyword: lib.keyword,
    item_description: fillQuantity(lib.item_description, qty),
    qty,
    unit: lib.unit,
    rate_labour: lib.rate_labour,
    rate_materials: lib.rate_materials,
    trade_rate_total: lib.trade_rate_total,
    estimated_hours: lib.estimated_hours,
    scope_library_id: lib.id,
    is_custom: false,
  }
}

/** A custom line, priced at $0 for the office to fill in */
function customLine(room: string, fields: { trade?: string | null; keyword?: string | null; description: string; qty: number | null; unit?: string | null }): FieldScopeLine {
  return {
    room,
    trade: fields.trade?.trim() || null,
    keyword: fields.keyword?.trim() || null,
    item_description: fields.description.trim(),
    qty: fields.qty,
    unit: normaliseUnit(fields.unit),
    rate_labour: 0,
    rate_materials: 0,
    trade_rate_total: null,
    estimated_hours: null,
    scope_library_id: null,
    is_custom: true,
  }
}

/** The scope library as the AI sees it: numbered, one item per line */
export function libraryText(catalogue: CatalogueItem[]): string {
  if (!catalogue.length) return '(the scope library is empty)'
  return catalogue
    .map((c, i) => `#${i + 1} | TRADE: ${c.trade ?? 'none'} | KEYWORD: ${c.keyword ?? 'none'} | UNIT: ${c.unit ?? 'none'} | ITEM: ${c.item_description}`)
    .join('\n')
}

/** The custom notes as the AI sees them: numbered, with room and any quantity the inspector entered */
export function notesText(notes: ScopeNote[]): string {
  return notes.map(n => `${n.n}. [${n.room || 'General'}${n.dims ? ` ${n.dims}m` : ''}] ${n.text}${n.qty != null ? ` (qty entered: ${n.qty})` : ''}`).join('\n')
}

/**
 * The quote lines for a field scope, in the inspector's order. `parseNotes`
 * turns the custom notes into lines (the AI); when it fails or skips a note,
 * the note goes on as typed at $0.
 */
export async function buildFieldScopeLines(
  rooms: FieldScopeRoom[],
  catalogue: CatalogueItem[],
  parseNotes: (notes: ScopeNote[]) => Promise<ParsedNote[]>,
): Promise<FieldScopeLine[]> {
  const byId = new Map(catalogue.map(c => [c.id, c]))
  const slots: (FieldScopeLine | ScopeNote)[] = []
  const notes: ScopeNote[] = []
  for (const r of rooms) {
    const room = r.room || 'General'
    const dims = [r.l, r.w, r.h].map(d => d.trim()).filter(Boolean).join('×')
    for (const item of r.items) {
      const lib = item.libraryId ? byId.get(item.libraryId) : undefined
      if (lib) {
        slots.push(libraryLine(room, lib, item.qty))
      } else if (item.text) {
        // Not picked (or the pick is no longer in the library): the AI writes it
        const note: ScopeNote = { n: notes.length + 1, room, dims, text: item.text, qty: item.qty }
        notes.push(note)
        slots.push(note)
      }
    }
  }

  let parsed: ParsedNote[] = []
  if (notes.length) {
    try {
      parsed = await parseNotes(notes)
    } catch (err) {
      console.error('[field scope] parsing notes failed, adding them as typed:', err)
    }
  }
  // Answers by note number; ones without a number go by position
  const answerFor = new Map<number, ParsedNote>()
  parsed.forEach((p, i) => {
    const n = typeof p?.note === 'number' ? p.note : i + 1
    if (!answerFor.has(n)) answerFor.set(n, p)
  })

  return slots.map(slot => {
    if (!('n' in slot)) return slot
    const answer = answerFor.get(slot.n)
    // The inspector's own quantity wins over one read from the text
    const qty = slot.qty ?? parseQty(answer?.qty)
    const libRef = typeof answer?.libId === 'number' ? answer.libId : parseQty(answer?.libId)
    const lib = libRef != null && Number.isInteger(libRef) ? catalogue[libRef - 1] : undefined
    if (lib) return libraryLine(slot.room, lib, qty)
    const description = answer?.itemDescription?.trim()
    if (!description) return customLine(slot.room, { description: slot.text, qty })
    return customLine(slot.room, { trade: answer?.trade, keyword: answer?.keyword, description, qty, unit: answer?.unit })
  })
}

/** The AI's reply as a list of parsed notes (accepts the older item_description / library field names too) */
export function readParsedNotes(text: string): ParsedNote[] {
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return []
  let raw: unknown
  try { raw = JSON.parse(match[0]) } catch { return [] }
  if (!Array.isArray(raw)) return []
  return raw.filter(r => r && typeof r === 'object').map((r: Record<string, unknown>): ParsedNote => {
    const confidence = str(r.confidence).toUpperCase()
    return {
      note: parseQty(r.note ?? r.n),
      room: str(r.room) || null,
      trade: str(r.trade) || null,
      keyword: str(r.keyword) || null,
      qty: parseQty(r.qty),
      unit: str(r.unit) || null,
      itemDescription: str(r.itemDescription ?? r.item_description) || null,
      libId: confidence === 'NEW' ? null : parseQty(r.libId ?? r.lib_id ?? r.library_ref),
    }
  })
}
