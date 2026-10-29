'use client'

import { createContext, useContext } from 'react'

/**
 * The signed-in user, loaded once on the server by the dashboard layout
 * (components/layout/app-layout.tsx). Pages inside the dashboard read it here
 * instead of asking Supabase for the user and their tenant again.
 */
export interface CurrentUser {
  userId: string
  tenantId: string
  role: string
}

const CurrentUserContext = createContext<CurrentUser | null>(null)

export function CurrentUserProvider({ value, children }: { value: CurrentUser; children: React.ReactNode }) {
  return <CurrentUserContext.Provider value={value}>{children}</CurrentUserContext.Provider>
}

/** The signed-in user. Only valid inside the dashboard layout. */
export function useCurrentUser(): CurrentUser {
  const user = useContext(CurrentUserContext)
  if (!user) throw new Error('useCurrentUser must be used inside the dashboard layout')
  return user
}

/** Like useCurrentUser, but null outside the dashboard layout. */
export function useOptionalCurrentUser(): CurrentUser | null {
  return useContext(CurrentUserContext)
}
