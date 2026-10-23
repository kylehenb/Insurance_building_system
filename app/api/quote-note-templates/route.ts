import { NextRequest, NextResponse } from 'next/server'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { createServiceClient } from '@/lib/supabase/server'

export interface NoteTemplate {
  id: string
  tenant_id: string
  title: string
  content: string
  sort_order: number
  created_at: string
}

export async function GET(req: NextRequest) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const tenantId = me.tenantId

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('quote_note_templates')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
