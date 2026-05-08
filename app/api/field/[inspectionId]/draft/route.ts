import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ inspectionId: string }> }
) {
  const { inspectionId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient()
  const { data: userRow } = await service
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()
  if (!userRow) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const { data: insp } = await service
    .from('inspections')
    .select('field_draft')
    .eq('id', inspectionId)
    .eq('tenant_id', userRow.tenant_id)
    .single()

  return NextResponse.json({ draft: insp?.field_draft ?? null })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ inspectionId: string }> }
) {
  const { inspectionId } = await params
  const body = await req.json()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient()
  const { data: userRow } = await service
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()
  if (!userRow) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const { error } = await service
    .from('inspections')
    .update({ field_draft: body.draft })
    .eq('id', inspectionId)
    .eq('tenant_id', userRow.tenant_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
