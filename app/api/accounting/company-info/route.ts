/**
 * Temporary diagnostic route — confirms which QBO company the stored credentials
 * belong to by calling CompanyInfo. Delete once company identity is confirmed.
 *
 * GET /api/accounting/company-info
 */

import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { qboFetch } from '@/lib/accounting/providers/quickbooks/client'

interface UserRow {
  tenant_id: string
}

interface CredentialsRow {
  realm_id: string
}

interface QboCompanyInfoResponse {
  CompanyInfo: {
    CompanyName: string
    LegalName?: string
    Country?: string
    CompanyAddr?: { City?: string; CountrySubDivisionCode?: string }
    FiscalYearStartMonth?: string
    Id?: string
  }
}

export async function GET(): Promise<NextResponse> {
  const cookieSupabase = await createClient()
  const { data: { user }, error: userError } = await cookieSupabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const serviceSupabase = createServiceClient()

  const { data: userRow, error: userRowError } = await serviceSupabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()

  if (userRowError || !userRow) {
    return NextResponse.json({ error: 'User record not found' }, { status: 404 })
  }

  const tenantId = (userRow as UserRow).tenant_id

  const { data: creds, error: credsError } = await serviceSupabase
    .from('accounting_credentials')
    .select('realm_id')
    .eq('tenant_id', tenantId)
    .eq('provider', 'quickbooks')
    .single()

  if (credsError || !creds) {
    return NextResponse.json({ error: 'No QBO credentials found for this tenant' }, { status: 404 })
  }

  const realmId = (creds as CredentialsRow).realm_id

  const res = await qboFetch(serviceSupabase, tenantId, `/companyinfo/${realmId}`)

  if (!res.ok) {
    const body = await res.text()
    return NextResponse.json(
      { error: `QBO CompanyInfo request failed: ${res.status}`, detail: body, realmId },
      { status: res.status }
    )
  }

  const data = (await res.json()) as QboCompanyInfoResponse
  const info = data.CompanyInfo

  return NextResponse.json({
    realmId,
    companyName: info.CompanyName,
    legalName: info.LegalName ?? null,
    country: info.Country ?? null,
    city: info.CompanyAddr?.City ?? null,
    state: info.CompanyAddr?.CountrySubDivisionCode ?? null,
    fiscalYearStart: info.FiscalYearStartMonth ?? null,
  })
}
