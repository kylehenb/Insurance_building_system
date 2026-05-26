export interface PricingTier {
  up_to_qty: number | null // null = open-ended standard rate (always last)
  rate_per_unit: number
  min_charge?: number | null
}

export interface PricingTiers {
  tiers: PricingTier[]
}

export interface ScopeLibraryOverride {
  id: string
  tenant_id: string
  scope_library_id: string
  insurer_id: string
  labour_per_unit: number | null
  materials_per_unit: number | null
  total_per_unit: number | null
  pricing_tiers: PricingTiers | null
  split_format: boolean
  wording_single: string | null
  wording_labour: string | null
  wording_materials: string | null
  imported_at: string | null
  import_source: string | null
  insurer?: { id: string; trading_name: string | null; name: string }
}

export interface ScopeLibraryItem {
  id: string
  tenant_id: string
  trade: string | null
  keyword: string | null
  site_notes: string | null
  item_description: string | null
  unit: string | null
  labour_per_unit: number | null
  materials_per_unit: number | null
  total_per_unit: number | null
  pricing_tiers: PricingTiers | null
  estimated_hours: number | null
  price_updated_at: string | null
  is_draft: boolean
  draft_source_quote_id: string | null
  draft_source_job_ref: string | null
  updated_at: string | null
  overrides: ScopeLibraryOverride[]
}

export interface InsurersOption {
  id: string
  trading_name: string | null
  name: string
}
