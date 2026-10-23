import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/get-user'
import { DashboardShell } from '@/components/layout/dashboard-shell'
import { loadUserPermissions } from '@/lib/permissions/resolve'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const userSession = await getUser()
  if (!userSession?.session) redirect('/login')
  if (!userSession.user) redirect('/auth/new-user')

  const { user } = userSession
  // Teaching the AI changes what it tells everyone — the same permission as company settings
  const { levels } = await loadUserPermissions(user.tenant_id, user.id)

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
      currentUser={{
        userId: user.id,
        tenantId: user.tenant_id,
        role: user.role,
        canTeach: levels['settings.edit'] === 'allowed',
      }}
    >
      {children}
    </DashboardShell>
  )
}
