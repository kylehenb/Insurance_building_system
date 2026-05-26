'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/supabase/database.types'
import type { ScopeLibraryItem, InsurersOption } from '@/lib/types/scope-library'
import { ScopeLibraryClient } from '@/components/scope-library/ScopeLibraryClient'

export default function ScopeLibraryPage() {
  const router = useRouter()
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [items, setItems] = useState<ScopeLibraryItem[] | null>(null)
  const [insurers, setInsurers] = useState<InsurersOption[] | null>(null)
  const [loading, setLoading] = useState(true)

  // Effect 1: auth bootstrap
  useEffect(() => {
    const supabase = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        router.replace('/login')
        return
      }
      supabase
        .from('users')
        .select('tenant_id')
        .eq('id', user.id)
        .single()
        .then(({ data }) => {
          if (data?.tenant_id) {
            setTenantId(data.tenant_id)
          } else {
            router.replace('/login')
          }
        })
    })
  }, [router])

  // Effect 2: load data when tenantId is set
  useEffect(() => {
    if (!tenantId) return

    const supabase = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    async function loadData() {
      try {
        const [itemsRes, insurersRes] = await Promise.all([
          fetch('/api/scope-library'),
          supabase
            .from('clients')
            .select('id, trading_name, name')
            .eq('tenant_id', tenantId!)
            .eq('client_type', 'insurer')
            .order('name'),
        ])

        if (itemsRes.ok) {
          const data = await itemsRes.json() as ScopeLibraryItem[]
          setItems(data)
        } else {
          setItems([])
        }

        if (!insurersRes.error && insurersRes.data) {
          const mapped: InsurersOption[] = insurersRes.data.map((c) => ({
            id: c.id,
            trading_name: c.trading_name,
            name: c.name,
          }))
          setInsurers(mapped)
        } else {
          setInsurers([])
        }
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [tenantId])

  if (loading || !tenantId || items === null || insurers === null) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="text-sm text-[#b0a898]">Loading scope library…</div>
      </div>
    )
  }

  return (
    <div className="px-6 py-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[#1a1a1a]">Scope Library</h1>
        <p className="text-sm text-[#b0a898] mt-1">Manage your pricing library for quotes and AI-assisted scope generation.</p>
      </div>
      <ScopeLibraryClient
        tenantId={tenantId}
        initialItems={items}
        insurers={insurers}
      />
    </div>
  )
}
