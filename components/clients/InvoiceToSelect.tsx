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

interface InvoiceToSelectProps {
  tenantId: string
  insurer: string | null
  adjuster: string | null
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

export function InvoiceToSelect({
  tenantId,
  insurer,
  adjuster,
  value,
  onSave,
  label = 'Invoice to',
}: InvoiceToSelectProps) {
  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [options, setOptions] = useState<Array<{ trading_name: string; name: string; type: string }>>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    async function fetchMatchingClients() {
      // Only fetch if we have an insurer or adjuster
      if (!insurer && !adjuster) {
        setOptions([])
        return
      }

      setLoading(true)

      // Build the query to get clients matching insurer OR adjuster
      let query = supabase
        .from('clients')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('status', 'active')

      // Apply OR filter for insurer or adjuster match
      if (insurer && adjuster) {
        query = query.or(`name.eq.${insurer},name.eq.${adjuster}`)
      } else if (insurer) {
        query = query.eq('name', insurer)
      } else if (adjuster) {
        query = query.eq('name', adjuster)
      }

      const { data } = await query

      if (data) {
        // Map to trading_name options (falling back to name if trading_name is null)
        const tradingOptions = data
          .filter(client => client.trading_name || client.name)
          .map(client => ({
            trading_name: client.trading_name || client.name!,
            name: client.name!,
            type: client.client_type,
          }))
          // Remove duplicates by trading_name
          .filter((option, index, self) =>
            index === self.findIndex(o => o.trading_name === option.trading_name)
          )
          .sort((a, b) => a.trading_name.localeCompare(b.trading_name))

        setOptions(tradingOptions)
      } else {
        setOptions([])
      }

      setLoading(false)
    }

    if (tenantId) {
      fetchMatchingClients()
    }
  }, [tenantId, insurer, adjuster, supabase])

  const handleChange = (newValue: string) => {
    if (newValue === '') {
      onSave(null)
    } else {
      onSave(newValue)
    }
  }

  // Show placeholder message if no insurer/adjuster selected
  const placeholderText = !insurer && !adjuster
    ? 'Select insurer/adjuster first'
    : loading
      ? 'Loading…'
      : options.length === 0
        ? 'No matching clients'
        : '— Select —'

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
        value={value || ''}
        onValueChange={handleChange}
        disabled={loading || options.length === 0}
      >
        <SelectTrigger style={{ ...inputStyle, height: '32px' }}>
          <SelectValue placeholder={placeholderText} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">— Select —</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.trading_name} value={option.trading_name}>
              {option.trading_name}
              <span style={{ color: '#9e998f', marginLeft: 8, fontSize: 11 }}>
                ({option.type === 'insurer' ? 'Insurer' : 'Adjuster'}: {option.name})
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
