import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/get-user'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const userSession = await getUser()
  if (!userSession?.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const jobId = new URL(req.url).searchParams.get('job_id')
  if (!jobId) {
    return NextResponse.json({ error: 'job_id is required' }, { status: 400 })
  }

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('communications')
    .select(
      'id,type,direction,contact_type,contact_name,contact_detail,subject,content,attachments,requires_action,created_at,from_email,to_email,gmail_message_id,persona,source'
    )
    .eq('job_id', jobId)
    .order('requires_action', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}
