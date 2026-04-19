/**
 * Structured physical property details for a job.
 * Stored as jobs.property_details JSONB.
 * Captured during the first BAR inspection; shared across all report types on the job.
 * Report-type-specific structural fields (e.g. roof_pitch on a roof report)
 * remain on reports.type_specific_fields — they are NOT part of this interface.
 */
export interface PropertyDetails {
  building_age?: string        // e.g. "~30 years" or "Circa 1995"
  condition?: string           // e.g. "Good" | "Fair" | "Poor"
  roof_type?: string           // e.g. "Concrete tile — hip configuration"
  wall_type?: string           // e.g. "Brick veneer" | "Double brick" | "Rendered"
  storeys?: string             // e.g. "1" | "2"
  foundation?: string          // e.g. "Concrete slab" | "Suspended timber"
  fence?: string               // e.g. "Colourbond — approx. 15 years" | "None"
  pool?: boolean
  detached_garage?: boolean
  granny_flat?: boolean
  tarp_required?: boolean
}

/**
 * Helper — safely read jobs.property_details from a raw Supabase row.
 * Returns an empty object if the column is null or not a valid object.
 */
export function parsePropertyDetails(raw: unknown): PropertyDetails {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return raw as PropertyDetails
}
