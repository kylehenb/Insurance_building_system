import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/get-user'
import { createClient } from '@/lib/supabase/server'
import { QuotesList } from './components/QuotesList'

interface Props {
  params: Promise<{ jobId: string }>
}

export default async function QuotesPage({ params }: Props) {
  const userData = await getUser()
  if (!userData?.session) redirect('/login')
  if (!userData.user) redirect('/auth/new-user')

  const { jobId } = await params
  const tenantId = userData.tenant_id!

  const supabase = await createClient()

  const { data: job } = await supabase
    .from('jobs')
    .select('job_number, insurer, insured_name, property_address')
    .eq('id', jobId)
    .eq('tenant_id', tenantId)
    .single()

  if (!job) redirect(`/dashboard/jobs`)

  return (
    <div
      style={{
        background: 'var(--surface)',
        minHeight: '100vh',
        fontFamily: 'DM Sans, sans-serif',
      }}
    >
      {/* Page header */}
      <div
        style={{
          background: 'var(--paper)',
          borderBottom: '1px solid var(--line)',
          padding: '12px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <a
            href={`/dashboard/jobs/${jobId}?tab=quotes`}
            style={{
              fontFamily: 'DM Mono, monospace',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--tan)',
              textDecoration: 'none',
            }}
          >
            {job.job_number}
          </a>
          <span style={{ color: 'var(--line)', fontSize: 14 }}>/</span>
          <span
            style={{
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--body)',
            }}
          >
            Quotes
          </span>
        </div>

        {job.insured_name && (
          <span style={{ fontSize: 12, color: 'var(--subtle)' }}>{job.insured_name}</span>
        )}
      </div>

      {/* Content */}
      <div style={{ padding: '20px 24px', maxWidth: 1200 }}>
        <QuotesList jobId={jobId} tenantId={tenantId} insurer={job.insurer} job={job} />
      </div>
    </div>
  )
}
