import { createServiceClient } from '@/lib/supabase/server'
import type { BrainEntry, BrainEntryCategory } from '@/types/brain'

const CONFIDENCE_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }

export async function getBrainContext(params: {
  tenantId: string
  promptKey?: string
  category?: BrainEntryCategory | BrainEntryCategory[]
  persona?: string
  tags?: string[]
  limit?: number
}): Promise<BrainEntry[]> {
  const { tenantId, promptKey, category, persona, tags, limit = 10 } = params
  const supabase = createServiceClient()

  let query = supabase
    .from('brain_entries')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('status', 'approved')

  if (category) {
    if (Array.isArray(category)) {
      query = query.in('category', category)
    } else {
      query = query.eq('category', category)
    }
  }

  const { data, error } = await query

  if (error) throw error

  let entries = (data ?? []) as BrainEntry[]

  if (promptKey) {
    entries = entries.filter(
      (e) => e.prompt_keys.length === 0 || e.prompt_keys.includes(promptKey)
    )
  }

  if (persona) {
    entries = entries.filter((e) => e.persona === null || e.persona === persona)
  }

  if (tags && tags.length > 0) {
    entries = entries.filter((e) => tags.some((tag) => e.tags.includes(tag)))
  }

  // Newest entries first (so newer instructions take priority over older ones),
  // then by confidence as tiebreaker.
  entries.sort((a, b) => {
    const aTime = new Date(a.created_at).getTime()
    const bTime = new Date(b.created_at).getTime()
    if (bTime !== aTime) return bTime - aTime

    return (CONFIDENCE_RANK[a.confidence] ?? 1) - (CONFIDENCE_RANK[b.confidence] ?? 1)
  })

  return entries.slice(0, limit)
}
