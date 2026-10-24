import { redirect } from 'next/navigation'

// Mail lives on the dashboard now; old links keep working
export default async function MailRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(await searchParams)) {
    for (const value of [v ?? []].flat()) params.append(k, value)
  }
  // An old /dashboard/mail link meant the inbox, not the action cards
  if (!params.has('folder') && !params.has('thread') && !params.has('q') && !params.has('filing')) params.set('folder', 'inbox')
  redirect(`/dashboard?${params}`)
}
