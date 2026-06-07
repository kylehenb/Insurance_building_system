import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/supabase/get-user'

export const dynamic = 'force-dynamic'

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ templateId: string }> }
) {
  const session = await getUser()
  if (!session?.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tenantId = session.tenant_id
  const { templateId } = await params

  const supabase = createServiceClient()

  const { data: current, error: fetchErr } = await supabase
    .from('report_templates')
    .select('use_count')
    .eq('id', templateId)
    .eq('tenant_id', tenantId)
    .single()

  if (fetchErr || !current) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }

  const { data, error } = await supabase
    .from('report_templates')
    .update({
      use_count: (current.use_count ?? 0) + 1,
      last_used_at: new Date().toISOString(),
    })
    .eq('id', templateId)
    .eq('tenant_id', tenantId)
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
