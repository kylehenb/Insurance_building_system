import { redirect, notFound } from 'next/navigation'
import { Suspense } from 'react'
import { getUser } from '@/lib/supabase/get-user'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/database.types'
import { JobDetailShell } from './components/JobDetailShell'

type JobRow = Database['public']['Tables']['jobs']['Row']

interface JobDetailPageProps {
  params: Promise<{ jobId: string }>
}

async function JobDetailPage({ params }: JobDetailPageProps) {
  const { jobId } = await params

  const userData = await getUser()

  if (!userData?.session) {
    redirect('/login')
  }

  if (!userData.user) {
    redirect('/auth/new-user')
  }

  const { tenant_id } = userData
  const currentUserId = userData.session.user.id
  const currentUserRole = userData.user?.role ?? 'inspector'

  const supabase = await createClient()

  // Fetch job header
  const { data: jobData, error: jobError } = await supabase
    .from('jobs')
    .select(
      'id,job_number,insured_name,property_address,status,insurer,claim_number,loss_type,date_of_loss,adjuster,excess,sum_insured,assigned_to,created_at,tenant_id,insured_phone,insured_email,additional_contacts,claim_description,special_instructions,notes'
    )
    .eq('id', jobId)
    .eq('tenant_id', tenant_id!)
    .single()

  if (jobError || !jobData) {
    notFound()
  }

  const job = jobData as JobRow

  // Fetch pending action count
  const { count: pendingCount } = await supabase
    .from('action_queue')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', jobId)
    .eq('tenant_id', tenant_id!)
    .eq('status', 'pending')

  // Fetch flag status for current user
  const { data: flagData } = await supabase
    .from('job_flags')
    .select('id')
    .eq('job_id', jobId)
    .eq('user_id', currentUserId)
    .eq('tenant_id', tenant_id!)
    .single()

  const isFlagged = !!flagData

  return (
    <Suspense>
      <JobDetailShell
        job={{
          id: job.id,
          job_number: job.job_number,
          insured_name: job.insured_name,
          property_address: job.property_address,
          status: job.status ?? 'active',
          insurer: job.insurer,
          claim_number: job.claim_number,
          loss_type: job.loss_type,
          date_of_loss: job.date_of_loss,
          adjuster: job.adjuster,
          excess: job.excess,
          sum_insured: job.sum_insured,
          assigned_to: job.assigned_to,
          created_at: job.created_at ?? '',
          insured_phone: job.insured_phone ?? '',
          insured_email: job.insured_email ?? '',
          additional_contacts: job.additional_contacts ?? '',
          claim_description: job.claim_description ?? '',
          special_instructions: job.special_instructions ?? '',
          notes: job.notes ?? '',
        }}
        jobId={jobId}
        tenantId={tenant_id!}
        currentUserId={currentUserId}
        currentUserRole={currentUserRole}
        pendingActionCount={pendingCount ?? 0}
        isFlagged={isFlagged}
      />
    </Suspense>
  )
}

export default JobDetailPage
