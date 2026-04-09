import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/get-user'
import { DashboardShell } from '@/components/layout/dashboard-shell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const userSession = await getUser()
  if (!userSession?.session) redirect('/login')
  if (!userSession.user) redirect('/auth/new-user')

  const { user } = userSession

  const initials = user.name
    .split(' ')
    .map((n: string) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  const roleLabel =
    user.role === 'admin'
      ? 'Owner · Inspector'
      : user.role === 'office'
      ? 'Office'
      : 'Inspector'

  return (
    <DashboardShell
      user={{ name: user.name, role: roleLabel, initials }}
      tenantId={user.tenant_id}
    >
      {children}
    </DashboardShell>
  )
}
