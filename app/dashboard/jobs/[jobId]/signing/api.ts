import type { SendDialogDefaults, SendForSignatureResult } from '@/lib/signing/service'
import type { SigningDocumentTypeKey, SigningEventSummary, SigningRequestSummary } from '@/lib/signing/types'

// Browser-side calls to the internal signing API (/api/signing/*). The UI
// only ever talks to these routes, never to a signing provider.

export type { SendDialogDefaults }

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`)
  return data as T
}

export function fetchJobSigning(jobId: string) {
  return call<{ requests: SigningRequestSummary[]; defaults: SendDialogDefaults }>(`/api/signing/jobs/${jobId}/requests`)
}

export function createAndSend(jobId: string, body: {
  documentType: SigningDocumentTypeKey
  quoteIds: string[]
  signer: { name: string; email: string; phone: string }
  moveJobToAwaitingStage: boolean
}) {
  return call<SendForSignatureResult>(`/api/signing/jobs/${jobId}/requests`, { method: 'POST', body: JSON.stringify(body) })
}

export function requestAction(id: string, action: 'send' | 'resend' | 'revoke' | 'confirm-stage', body?: Record<string, unknown>) {
  return call<{ request?: SigningRequestSummary; stage?: string }>(`/api/signing/requests/${id}/${action}`, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  })
}

export function fetchAuditTrail(id: string) {
  return call<{ request: SigningRequestSummary; events: SigningEventSummary[] }>(`/api/signing/requests/${id}`)
}

export function documentUrl(id: string, version: 'signed' | 'source', download = false) {
  return `/api/signing/requests/${id}/document?version=${version}${download ? '&download=1' : ''}`
}
