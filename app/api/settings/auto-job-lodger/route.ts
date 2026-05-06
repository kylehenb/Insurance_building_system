import { NextRequest, NextResponse } from 'next/server'
import { createClient as createRawClient } from '@supabase/supabase-js'
import { getUser } from '@/lib/supabase/get-user'

type AutoJobLodgerConfig = {
  id: string
  tenant_id: string
  notification_enabled: boolean
  notification_email: string
  notify_on_success: boolean
  notify_on_needs_review: boolean
  notify_outside_business_hours: boolean
  notification_subject_success: string
  notification_subject_review: string
  notification_body_template: string
  created_at: string
  updated_at: string
}

type EmailKeywordRule = {
  id: string
  tenant_id: string
  keyword: string
  active: boolean
  created_at: string
}

function getRawClient() {
  return createRawClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(_req: NextRequest) {
  const userSession = await getUser()
  if (!userSession || !userSession.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tenantId = userSession.tenant_id

  const supabase = getRawClient()

  const [configResult, keywordsResult] = await Promise.all([
    supabase
      .from('auto_job_lodger_config')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    supabase
      .from('email_keyword_rules')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true }),
  ])

  if (configResult.error) {
    return NextResponse.json({ error: configResult.error.message }, { status: 500 })
  }
  if (keywordsResult.error) {
    return NextResponse.json({ error: keywordsResult.error.message }, { status: 500 })
  }

  return NextResponse.json({
    config: (configResult.data as AutoJobLodgerConfig | null),
    keywords: (keywordsResult.data as EmailKeywordRule[]) ?? [],
  })
}

export async function PATCH(req: NextRequest) {
  const userSession = await getUser()
  if (!userSession || !userSession.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tenantId = userSession.tenant_id

  const body = await req.json() as Partial<Omit<AutoJobLodgerConfig, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>>

  const supabase = getRawClient()

  const { data, error } = await supabase
    .from('auto_job_lodger_config')
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ config: data as AutoJobLodgerConfig })
}
