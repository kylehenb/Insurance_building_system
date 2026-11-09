import { JobPresence } from '@/components/jobs/JobPresence'

// Every page of a job (the job, its quotes, work orders, signing) says the
// job is open while it's on screen (components/jobs/JobPresence.tsx)
export default async function JobLayout({ children, params }: { children: React.ReactNode; params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  return (
    <>
      <JobPresence jobId={jobId} />
      {children}
    </>
  )
}
