'use client'

import React, { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/supabase/database.types'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type Client = Database['public']['Tables']['clients']['Row']

interface InsurerSelectProps {
  tenantId: string
  value: string | null
  onSave: (value: string | null) => void
  label?: string
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: '0.5px solid #e4dfd8',
  borderRadius: 4,
  padding: '4px 7px',
  fontSize: 13,
  fontFamily: "'DM Sans', sans-serif",
  color: '#1a1a1a',
  background: '#ffffff',
  boxSizing: 'border-box',
  outline: 'none',
  transition: 'border-color 0.15s',
}

export function InsurerSelect({ tenantId, value, onSave, label = 'Insurer' }: InsurerSelectProps) {
  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [insurers, setInsurers] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchInsurers() {
      const { data } = await supabase
        .from('clients')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('client_type', 'insurer')
        .eq('status', 'active')
        .order('name', { ascending: true })

      setInsurers(data || [])
      setLoading(false)
    }

    if (tenantId) {
      fetchInsurers()
    }
  }, [tenantId, supabase])

  const handleChange = (newValue: string) => {
    // Find the selected insurer to get its name
    const selected = insurers.find(i => i.name === newValue)
    if (selected) {
      onSave(selected.name)
    } else if (newValue === '_none_') {
      onSave(null)
    }
  }

  return (
    <div>
      <div style={{
        fontSize: 9,
        fontWeight: 600,
        color: '#b0a898',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        marginBottom: 3,
      }}>
        {label}
      </div>
      <Select
        value={value || '_none_'}
        onValueChange={handleChange}
        disabled={loading}
      >
        <SelectTrigger style={{ ...inputStyle, height: '32px' }}>
          <SelectValue placeholder={loading ? 'Loading…' : '— Select —'} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="_none_">— Select —</SelectItem>
          {insurers.map((insurer) => (
            <SelectItem key={insurer.id} value={insurer.name}>
              {insurer.name}
              {insurer.trading_name && insurer.trading_name !== insurer.name && (
                <span style={{ color: '#9e998f', marginLeft: 8, fontSize: 11 }}>
                  ({insurer.trading_name})
                </span>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
