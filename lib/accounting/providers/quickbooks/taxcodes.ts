import type { SupabaseClient } from '@supabase/supabase-js'
import { qboFetch } from './client'

// Cached per lambda invocation — tax codes don't change mid-batch
const gstCodeCache = new Map<string, string>()

interface QboTaxCodeRow {
  Id: string
  Name: string
  Active: boolean
}

interface QboTaxCodeQueryResponse {
  QueryResponse: {
    TaxCode?: QboTaxCodeRow[]
  }
}

export async function getQboGstTaxCodeId(
  supabase: SupabaseClient,
  tenantId: string
): Promise<string> {
  const cached = gstCodeCache.get(tenantId)
  if (cached) return cached

  const query = encodeURIComponent('SELECT * FROM TaxCode WHERE Active = true MAXRESULTS 100')
  const res = await qboFetch(supabase, tenantId, `/query?query=${query}`)

  if (!res.ok) {
    const tid = res.headers.get('intuit_tid') ?? 'unavailable'
    const errBody = await res.text()
    throw new Error(`Failed to fetch QBO tax codes: ${res.status} ${errBody} [intuit_tid=${tid}]`)
  }

  const data = (await res.json()) as QboTaxCodeQueryResponse
  const codes = data.QueryResponse.TaxCode ?? []
  const gst = codes.find((c) => c.Name === 'GST')

  if (!gst) {
    throw new Error(
      `No active GST tax code found in connected QBO company. Available codes: ${codes.map((c) => c.Name).join(', ') || 'none'}`
    )
  }

  gstCodeCache.set(tenantId, gst.Id)
  return gst.Id
}
