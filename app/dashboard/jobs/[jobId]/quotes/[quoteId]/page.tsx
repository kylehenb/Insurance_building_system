import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/get-user'

interface Props {
  params: Promise<{ jobId: string; quoteId: string }>
}

export default async function QuoteEditorPage({ params }: Props) {
  const userData = await getUser()
  if (!userData?.session) redirect('/login')
  if (!userData.user) redirect('/auth/new-user')

  const { jobId } = await params
  redirect(`/dashboard/jobs/${jobId}?tab=quotes`)
}
