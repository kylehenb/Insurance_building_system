import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/get-user'
import { Sidebar } from '@/components/layout/sidebar'

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
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#f5f2ee', fontFamily: "'DM Sans', -apple-system, sans-serif" }}>
      <Sidebar
        user={{ name: user.name, role: roleLabel, initials }}
        tenantId={user.tenant_id}
      />
      <main style={{ flex: 1, overflowY: 'auto', minWidth: 0 }}>
        {children}
      </main>
    </div>
  )
}
