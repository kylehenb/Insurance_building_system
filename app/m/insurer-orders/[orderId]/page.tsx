import type { Viewport } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/get-user'
import { createServiceClient } from '@/lib/supabase/server'
import MobileOrderReview from './MobileOrderReview'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1a1a1a',
}

interface Props {
  params: Promise<{ orderId: string }>
}

// Phone-optimised review of a single insurer order — the landing page for
// "new order lodged" notification emails opened on a mobile device.
export default async function MobileOrderPage({ params }: Props) {
  const { orderId } = await params

  const userData = await getUser()
  if (!userData?.session) redirect('/login')
  if (!userData.user || !userData.tenant_id) redirect('/auth/new-user')

  const service = createServiceClient()
  const { data: order } = await service
    .from('insurer_orders')
    .select('*')
    .eq('id', orderId)
    .eq('tenant_id', userData.tenant_id)
    .maybeSingle()

  if (!order) notFound()

  let jobNumber: string | null = null
  if (order.job_id) {
    const { data: job } = await service
      .from('jobs').select('job_number').eq('id', order.job_id).maybeSingle()
    jobNumber = job?.job_number ?? null
  }

  return <MobileOrderReview initialOrder={order} initialJobNumber={jobNumber} />
}
