# AI Action Refresh Guide

## Overview

When the AI widget completes actions (creating jobs, updating data, etc.), pages need to refresh their data to show the updated information without requiring a manual page reload.

## How It Works

The AI widget dispatches a custom event `ai-action-complete` whenever it successfully completes an action. Pages can listen for this event and refresh their data automatically.

## When to Use the Hook

**Use the `useAIActionRefresh` hook ONLY on Client Components that:**
- Are marked with `'use client'` at the top
- Fetch data using `useEffect` + `useState`
- Need to show updated data after AI actions

**Do NOT use the hook on:**
- Server Components (async functions) - these automatically fetch fresh data on navigation
- Pages that don't fetch data
- Pages that only display static content

## Implementation

### Step 1: Import the hook

```tsx
import { useAIActionRefresh } from '@/lib/hooks/useAIActionRefresh'
```

### Step 2: Add the hook call

Add the hook after your data fetching `useEffect`. Pass your refresh function and dependencies:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useAIActionRefresh } from '@/lib/hooks/useAIActionRefresh'

export default function MyPage() {
  const [data, setData] = useState([])
  const [tenantId, setTenantId] = useState<string | null>(null)
  
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // Initial data fetch
  useEffect(() => {
    if (!tenantId) return
    async function fetchData() {
      const { data } = await supabase
        .from('your_table')
        .select('*')
        .eq('tenant_id', tenantId)
      setData(data ?? [])
    }
    fetchData()
  }, [tenantId])

  // Auto-refresh when AI actions complete
  useAIActionRefresh(async () => {
    if (!tenantId) return
    const { data } = await supabase
      .from('your_table')
      .select('*')
      .eq('tenant_id', tenantId)
    setData(data ?? [])
  }, [tenantId])

  return (
    <div>
      {/* Your page content */}
    </div>
  )
}
```

## Best Practices

1. **Keep refresh logic simple** - The refresh function should mirror your initial data fetch
2. **Include all dependencies** - Pass the same dependencies array as your data fetching useEffect
3. **Handle edge cases** - Check for null/undefined values (e.g., `if (!tenantId) return`)
4. **Avoid duplicate code** - Extract the fetch logic into a function if it's complex

## Example: Complete Implementation

```tsx
'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useAIActionRefresh } from '@/lib/hooks/useAIActionRefresh'
import type { Database } from '@/lib/supabase/database.types'

type TableRow = Database['public']['Tables']['your_table']['Row']

export default function MyListPage() {
  const [items, setItems] = useState<TableRow[]>([])
  const [loading, setLoading] = useState(true)
  const [tenantId, setTenantId] = useState<string | null>(null)
  
  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // Auth bootstrap
  useEffect(() => {
    async function bootstrap() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: profile } = await supabase
        .from('users')
        .select('tenant_id')
        .eq('id', user.id)
        .single()
      if (profile) setTenantId(profile.tenant_id)
    }
    bootstrap()
  }, [])

  // Initial data fetch
  useEffect(() => {
    if (!tenantId) return
    async function fetchItems() {
      const { data } = await supabase
        .from('your_table')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
      setItems(data ?? [])
      setLoading(false)
    }
    fetchItems()
  }, [tenantId])

  // Auto-refresh when AI actions complete
  useAIActionRefresh(async () => {
    if (!tenantId) return
    const { data } = await supabase
      .from('your_table')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
    setItems(data ?? [])
  }, [tenantId])

  if (loading) return <div>Loading...</div>

  return (
    <div>
      {items.map(item => (
        <div key={item.id}>{/* Render item */}</div>
      ))}
    </div>
  )
}
```

## Current Implementation Status

The following pages already have AI refresh implemented:

✅ `app/dashboard/page.tsx` - Dashboard home (Client Component)
✅ `app/dashboard/jobs/page.tsx` - Jobs list (Client Component)
✅ `app/dashboard/insurer-orders/page.tsx` - Insurer orders list (Client Component)

The following pages are Server Components and do NOT need the hook (data refreshes automatically on navigation):

ℹ️ `app/dashboard/inspections/page.tsx` - Server Component
ℹ️ `app/dashboard/inspections/[id]/page.tsx` - Server Component
ℹ️ `app/dashboard/jobs/[jobId]/page.tsx` - Server Component
ℹ️ `app/dashboard/jobs/[jobId]/quotes/page.tsx` - Server Component
ℹ️ `app/dashboard/jobs/[jobId]/quotes/[quoteId]/page.tsx` - Server Component

## Troubleshooting

**Q: My page isn't refreshing after AI actions**
- A: Ensure the page is a Client Component (`'use client'`)
- A: Check that the hook is being called with the correct dependencies
- A: Verify the refresh function matches your data fetch logic

**Q: Do Server Components need this hook?**
- A: No. Server Components fetch data on the server and automatically get fresh data on navigation.

**Q: Can I use this with React Query/SWR?**
- A: If you migrate to a data fetching library, use its built-in cache invalidation instead of this hook.
