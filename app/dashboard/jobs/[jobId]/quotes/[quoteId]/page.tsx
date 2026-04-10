import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/get-user'
import { createClient } from '@/lib/supabase/server'
import { QuoteEditorClient } from '../components/QuoteEditorClient'

interface Props {
  params: Promise<{ jobId: string; quoteId: string }>
}

export default async function QuoteEditorPage({ params }: Props) {
  const userData = await getUser()
  if (!userData?.session) redirect('/login')
  if (!userData.user) redirect('/auth/new-user')

  const { jobId, quoteId } = await params
  const tenantId = userData.tenant_id!

  const supabase = await createClient()

  const { data: job } = await supabase
    .from('jobs')
    .select('job_number, insurer, insured_name, property_address')
    .eq('id', jobId)
    .eq('tenant_id', tenantId)
    .single()

  if (!job) redirect(`/dashboard/jobs/${jobId}?tab=quotes`)

  return (
    <div
      style={{
        background: '#f5f2ee',
        minHeight: '100vh',
        fontFamily: 'DM Sans, sans-serif',
      }}
    >
      <QuoteEditorClient
        jobId={jobId}
        quoteId={quoteId}
        tenantId={tenantId}
        job={job}
      />
    </div>
  )
}
