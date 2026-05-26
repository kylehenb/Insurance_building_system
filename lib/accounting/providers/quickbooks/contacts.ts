import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccountingContact } from '../../types'
import { qboFetch } from './client'

interface QboCustomerResponse {
  Customer: {
    Id: string
    DisplayName: string
  }
}

interface QboVendorResponse {
  Vendor: {
    Id: string
    DisplayName: string
  }
}

interface QboQueryResponse<T> {
  QueryResponse: {
    Customer?: T[]
    Vendor?: T[]
    totalCount?: number
  }
}

interface QboCustomerRow {
  Id: string
  DisplayName: string
}

interface QboVendorRow {
  Id: string
  DisplayName: string
}

export async function upsertQboContact(
  supabase: SupabaseClient,
  tenantId: string,
  contact: AccountingContact
): Promise<string> {
  const entityType = contact.isVendor ? 'Vendor' : 'Customer'

  // 1. If we already have an ID, verify it still exists in QBO
  if (contact.existingAccountingId) {
    const verifyRes = await qboFetch(
      supabase,
      tenantId,
      `/${entityType.toLowerCase()}/${contact.existingAccountingId}`
    )
    if (verifyRes.ok) {
      const verifyData = (await verifyRes.json()) as QboCustomerResponse | QboVendorResponse
      const entity = contact.isVendor
        ? (verifyData as QboVendorResponse).Vendor
        : (verifyData as QboCustomerResponse).Customer
      if (entity?.Id) {
        return entity.Id
      }
    }
    // Not found — fall through to search
  }

  // 2. Search QBO by name
  const encodedName = encodeURIComponent(
    `SELECT * FROM ${entityType} WHERE DisplayName = '${contact.displayName.replace(/'/g, "\\'")}'`
  )
  const searchRes = await qboFetch(
    supabase,
    tenantId,
    `/query?query=${encodedName}`
  )

  if (searchRes.ok) {
    const searchData = (await searchRes.json()) as QboQueryResponse<QboCustomerRow | QboVendorRow>
    const results = contact.isVendor
      ? searchData.QueryResponse.Vendor
      : searchData.QueryResponse.Customer

    if (results && results.length > 0) {
      return results[0].Id
    }
  }

  // 3. Create new contact
  if (contact.isVendor) {
    const payload = {
      Vendor: {
        DisplayName: contact.displayName,
        ...(contact.email ? { PrimaryEmailAddr: { Address: contact.email } } : {}),
        ...(contact.phone ? { PrimaryPhone: { FreeFormNumber: contact.phone } } : {}),
        ...(contact.companyName ? { CompanyName: contact.companyName } : {}),
        ...(contact.abn ? { TaxIdentifier: contact.abn } : {}),
      },
    }

    const createRes = await qboFetch(supabase, tenantId, '/vendor', {
      method: 'POST',
      body: JSON.stringify(payload),
    })

    if (!createRes.ok) {
      const errBody = await createRes.text()
      throw new Error(`Failed to create QBO vendor: ${createRes.status} ${errBody}`)
    }

    const createData = (await createRes.json()) as QboVendorResponse
    return createData.Vendor.Id
  } else {
    const payload = {
      Customer: {
        DisplayName: contact.displayName,
        ...(contact.email ? { PrimaryEmailAddr: { Address: contact.email } } : {}),
        ...(contact.phone ? { PrimaryPhone: { FreeFormNumber: contact.phone } } : {}),
        ...(contact.companyName ? { CompanyName: contact.companyName } : {}),
      },
    }

    const createRes = await qboFetch(supabase, tenantId, '/customer', {
      method: 'POST',
      body: JSON.stringify(payload),
    })

    if (!createRes.ok) {
      const errBody = await createRes.text()
      throw new Error(`Failed to create QBO customer: ${createRes.status} ${errBody}`)
    }

    const createData = (await createRes.json()) as QboCustomerResponse
    return createData.Customer.Id
  }
}
