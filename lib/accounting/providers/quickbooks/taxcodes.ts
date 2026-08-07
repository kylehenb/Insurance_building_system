import type { SupabaseClient } from '@supabase/supabase-js'
import { qboFetch } from './client'

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
  const query = encodeURIComponent('SELECT * FROM TaxCode WHERE Active = true MAXRESULTS 100')
  const res = await qboFetch(supabase, tenantId, `/query?query=${query}`)

  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`Failed to fetch QBO tax codes: ${res.status} ${errBody}`)
  }

  const data = (await res.json()) as QboTaxCodeQueryResponse
  const codes = data.QueryResponse.TaxCode ?? []
  const gst = codes.find((c) => c.Name === 'GST')

  if (!gst) {
    throw new Error(
      `No active GST tax code found in connected QBO company. Available codes: ${codes.map((c) => c.Name).join(', ') || 'none'}`
    )
  }

  return gst.Id
}
