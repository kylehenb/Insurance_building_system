import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

function reviewDueAt(): string {
  const d = new Date()
  d.setDate(d.getDate() + 90)
  return d.toISOString()
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = (await req.json()) as { id: string }
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { data: profile } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'No tenant' }, { status: 401 })
  const tenantId = (profile as { tenant_id: string }).tenant_id

  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('brain_entries')
    .update({
      status: 'approved',
      last_reviewed_at: now,
      review_due_at: reviewDueAt(),
      updated_by: user.id,
    })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data })
}
