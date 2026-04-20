import { getUser } from '@/lib/supabase/get-user'
import InspectionSchedulingSettings from './inspection-scheduling-settings'

export default async function InspectionSchedulingPage() {
  const userSession = await getUser()
  
  if (!userSession || !userSession.tenant_id) {
    return null // Will redirect via middleware or layout
  }

  return <InspectionSchedulingSettings tenantId={userSession.tenant_id} />
}
