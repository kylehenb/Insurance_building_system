import { BUILDING_CONTRACT_THRESHOLD } from '@/lib/signing/config'
import type { SigningDocumentTypeKey } from '@/lib/signing/types'

// Names and descriptions of the signing document types. Client-safe: the
// send dialog reads this; the server registry (registry.ts) adds the
// generators and field positions.

export interface SigningDocumentCatalogEntry {
  key: SigningDocumentTypeKey
  label: string
  description: string
}

export const SIGNING_DOCUMENT_CATALOG: Record<SigningDocumentTypeKey, SigningDocumentCatalogEntry> = {
  scope_of_works: {
    key: 'scope_of_works',
    label: 'Scope of Works Authorisation',
    description: `For approved work of $${BUILDING_CONTRACT_THRESHOLD.toLocaleString('en-AU')} or less. The homeowner authorises the approved scope.`,
  },
  building_contract: {
    key: 'building_contract',
    label: 'Building Contract',
    description: `For approved work over $${BUILDING_CONTRACT_THRESHOLD.toLocaleString('en-AU')} (WA Home Building Contracts Act). Two owner signatures.`,
  },
}

export function signingDocumentLabel(key: string): string {
  return (SIGNING_DOCUMENT_CATALOG as Record<string, SigningDocumentCatalogEntry>)[key]?.label ?? key
}

/** Building Contract over the WA threshold, Scope of Works Authorisation otherwise. */
export function suggestDocumentType(totalInclGst: number): SigningDocumentTypeKey {
  return totalInclGst > BUILDING_CONTRACT_THRESHOLD ? 'building_contract' : 'scope_of_works'
}
