import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/supabase/get-user'
import type { ReportTemplate } from '@/types/reports'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getUser()
  if (!session?.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tenantId = session.tenant_id

  const { searchParams } = new URL(req.url)
  const reportType = searchParams.get('report_type')

  const supabase = createServiceClient()

  let query = supabase
    .from('report_templates')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('use_count', { ascending: false })
    .order('last_used_at', { ascending: false, nullsFirst: false })

  if (reportType) {
    query = query.eq('report_type', reportType)
  }

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data as ReportTemplate[])
}

export async function POST(req: NextRequest) {
  const session = await getUser()
  if (!session?.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tenantId = session.tenant_id

  const body = await req.json() as {
    name: string
    report_type: string
    loss_types?: string[]
  }

  const { name, report_type, loss_types } = body

  if (!name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (!report_type) {
    return NextResponse.json({ error: 'report_type is required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data: existing } = await supabase
    .from('report_templates')
    .select('*')
    .eq('tenant_id', tenantId)
    .ilike('name', name.trim())
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ ...(existing as ReportTemplate), created: false })
  }

  const { data, error } = await supabase
    .from('report_templates')
    .insert({
      tenant_id: tenantId,
      name: name.trim(),
      report_type,
      loss_types: loss_types ?? null,
    })
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ...(data as ReportTemplate), created: true }, { status: 201 })
}

export async function upsertReportTemplate(
  name: string,
  reportType: string,
  tenantId: string,
  supabase: ReturnType<typeof createServiceClient>
): Promise<void> {
  const { data: existing } = await supabase
    .from('report_templates')
    .select('id')
    .eq('tenant_id', tenantId)
    .ilike('name', name.trim())
    .maybeSingle()

  if (!existing) {
    await supabase.from('report_templates').insert({
      tenant_id: tenantId,
      name: name.trim(),
      report_type: reportType,
    })
  }
}
