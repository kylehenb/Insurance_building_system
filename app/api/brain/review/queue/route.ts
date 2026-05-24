import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { BrainEntry } from '@/types/brain'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'No tenant' }, { status: 401 })
  const tenantId = (profile as { tenant_id: string }).tenant_id

  const now = new Date().toISOString()

  const [draftRes, staleRes, contradictedRes] = await Promise.all([
    supabase
      .from('brain_entries')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'draft')
      .order('created_at', { ascending: false })
      .limit(5),

    supabase
      .from('brain_entries')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'approved')
      .lt('review_due_at', now)
      .not('review_due_at', 'is', null)
      .order('review_due_at', { ascending: true })
      .limit(5),

    supabase
      .from('brain_entries')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'approved')
      .gte('times_contradicted', 2)
      .order('times_contradicted', { ascending: false })
      .limit(5),
  ])

  const draft = (draftRes.data ?? []) as BrainEntry[]
  const stale = (staleRes.data ?? []) as BrainEntry[]
  const contradicted = (contradictedRes.data ?? []) as BrainEntry[]
  const total = draft.length + stale.length + contradicted.length

  return NextResponse.json({ draft, stale, contradicted, total })
}
