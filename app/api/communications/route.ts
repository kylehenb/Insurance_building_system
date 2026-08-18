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
      'id,type,direction,contact_type,contact_name,contact_detail,subject,content,body_text,' +
      'attachments,requires_action,action_queue_id,created_at,from_email,to_email,' +
      'gmail_message_id,thread_id,work_order_id,persona,source,read_at,is_starred'
    )
    .eq('job_id', jobId)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}
