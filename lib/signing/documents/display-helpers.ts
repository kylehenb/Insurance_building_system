import { groupScopeItemsAcrossQuotes } from '@/lib/documents/scope-grouping'
import type { QuoteDocumentData } from '@/lib/documents/quote-document-data'
import type { DisplayBlock } from '@/lib/signing/types'

export function formatAud(value: number | null | undefined): string {
  if (value == null) return '$0.00'
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(value)
}

export function excessLabel(excess: number | null | undefined): string {
  return excess != null && excess !== 0 ? formatAud(excess) : 'N/A'
}

/** Scope grouped by room in the same order as the PDF. */
export function scopeBlock(data: Pick<QuoteDocumentData, 'quotes' | 'scopeItems'>): DisplayBlock {
  const { groupedByRoom, sortedRooms } = groupScopeItemsAcrossQuotes(data.quotes, data.scopeItems)
  return {
    type: 'scope',
    rooms: sortedRooms.map(room => ({
      room,
      items: groupedByRoom[room].map(item => ({
        description: item.item_description?.trim() || '-',
        qty: [item.qty ?? '', item.unit ?? ''].join(' ').trim(),
      })),
    })),
  }
}

/** Drops detail rows with no value. */
export function detailRows(rows: { label: string; value: string | null | undefined }[]): { label: string; value: string }[] {
  return rows
    .filter(r => r.value != null && String(r.value).trim() !== '')
    .map(r => ({ label: r.label, value: String(r.value).trim() }))
}
