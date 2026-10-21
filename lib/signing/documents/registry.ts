import type { SigningDocumentTypeKey } from '@/lib/signing/types'
import { buildingContractDocument } from './building-contract'
import { scopeOfWorksDocument } from './scope-of-works'
import type { SigningDocumentType } from './types'

// Document types that can be sent for signature. Each one owns its signature
// field positions (fields[]) and its PDF/reading-view generator. To add a
// type: write a SigningDocumentType module, add it here, and add its key to
// SigningDocumentTypeKey in lib/signing/types.ts.

export const SIGNING_DOCUMENT_TYPES: Record<SigningDocumentTypeKey, SigningDocumentType> = {
  scope_of_works: scopeOfWorksDocument,
  building_contract: buildingContractDocument,
}

export function getSigningDocumentType(key: string): SigningDocumentType | null {
  return (SIGNING_DOCUMENT_TYPES as Record<string, SigningDocumentType>)[key] ?? null
}

export { suggestDocumentType } from './catalog'
