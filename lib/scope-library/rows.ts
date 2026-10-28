import type { Database } from '@/lib/supabase/database.types'
import type { PricingTiers, ScopeLibraryItem, ScopeLibraryOverride } from '@/lib/types/scope-library'

type LibraryRow = Database['public']['Tables']['scope_library']['Row']

/**
 * A scope_library row as the Settings → Scope Library screen shows it. Items
 * saved from a quote (approval_status "pending") show as drafts to approve,
 * like drafts from imports.
 */
export function toScopeLibraryItem(row: LibraryRow, overrides: ScopeLibraryOverride[] = []): ScopeLibraryItem {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    trade: row.trade,
    keyword: row.keyword,
    site_notes: row.site_notes,
    item_description: row.item_description,
    unit: row.unit,
    labour_per_unit: row.labour_per_unit,
    materials_per_unit: row.materials_per_unit,
    total_per_unit: row.total_per_unit,
    pricing_tiers: row.pricing_tiers as PricingTiers | null,
    estimated_hours: row.estimated_hours,
    price_updated_at: row.price_updated_at,
    is_draft: (row.is_draft ?? false) || row.approval_status === 'pending',
    insurer_specific: row.insurer_specific?.trim() || null,
    draft_source_quote_id: row.draft_source_quote_id,
    draft_source_job_ref: row.draft_source_job_ref,
    updated_at: row.updated_at,
    overrides,
  }
}
