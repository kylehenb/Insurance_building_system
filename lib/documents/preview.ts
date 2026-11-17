import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { parseDocumentRef, prepareDocument, type DocumentRef } from '@/lib/documents/send/documents'
import type { PrintDataContext } from '@/lib/documents/print-data'
import { buildWorkOrderPdf } from '@/lib/work-orders/work-order-pdf'
import { appBaseUrl } from '@/lib/signing/config'

// Looking at a document before it goes out (tech spec §10b "Document
// preview"): the PDF exactly as Send would attach it — the same
// prepareDocument / buildWorkOrderPdf — rendered live, never stored and never
// marked sent. The voice tool preview_document hands out a link to it:
// /api/preview/<token>, where the token is signed (HMAC) and runs out after
// PREVIEW_LINK_HOURS, so it opens on a phone without signing in.

export type PreviewTarget = { kind: 'work_order'; id: string } | DocumentRef

export const PREVIEW_LINK_HOURS = 24
const HOUR_MS = 3_600_000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class PreviewError extends Error {
  constructor(message: string, public readonly status: 400 | 404 = 400) {
    super(message)
    this.name = 'PreviewError'
  }
}

/** A target from a request or token; throws PreviewError on one that doesn't fit */
export function parsePreviewTarget(input: unknown): PreviewTarget {
  const o = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  if (o.kind === 'work_order') {
    if (typeof o.id !== 'string' || !UUID_RE.test(o.id)) throw new PreviewError('Work order not found', 404)
    return { kind: 'work_order', id: o.id }
  }
  try {
    return parseDocumentRef(o)
  } catch (err) {
    throw new PreviewError(err instanceof Error ? err.message : 'Not a document')
  }
}

export interface RenderedPreview { pdf: Buffer; filename: string; title: string }

/** The document's title and file name, checked without rendering (cheap) */
export async function describePreview(target: PreviewTarget, ctx: PrintDataContext): Promise<{ title: string; filename: string; warnings: string[] }> {
  if (target.kind === 'work_order') {
    const { data } = await ctx.supabase.from('work_orders').select('id').eq('tenant_id', ctx.tenantId).eq('id', target.id).maybeSingle()
    if (!data) throw new PreviewError('Work order not found', 404)
    return { title: 'Work order', filename: 'work-order.pdf', warnings: [] }
  }
  const doc = await prepareDocument(target, ctx)
  return { title: doc.title, filename: doc.filename, warnings: doc.warnings }
}

/** Renders the PDF as Send would attach it. Changes nothing. */
export async function renderPreview(target: PreviewTarget, ctx: PrintDataContext): Promise<RenderedPreview> {
  if (target.kind === 'work_order') {
    const { pdf, filename } = await buildWorkOrderPdf(target.id, ctx)
    return { pdf, filename, title: filename.replace(/\.pdf$/i, '') }
  }
  const doc = await prepareDocument(target, ctx)
  return { pdf: await doc.render(), filename: doc.filename, title: doc.title }
}

// ── Links ──

interface TokenBody { t: string; d: PreviewTarget; e: number }

function signingKey(): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  // Its own key, derived so the service key itself is never what signs
  return createHash('sha256').update(`irc-document-preview:${secret}`).digest()
}

const sign = (body: string) => createHmac('sha256', signingKey()).update(body).digest('base64url')

/** A signed token for this tenant's document, good for PREVIEW_LINK_HOURS */
export function previewToken(tenantId: string, target: PreviewTarget, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ t: tenantId, d: target, e: now + PREVIEW_LINK_HOURS * HOUR_MS } satisfies TokenBody)).toString('base64url')
  return `${body}.${sign(body)}`
}

/** The tenant and document a token is for, or null when it's forged, broken or ran out */
export function readPreviewToken(token: string, now = Date.now()): { tenantId: string; target: PreviewTarget } | null {
  const [body, mac, extra] = token.split('.')
  if (!body || !mac || extra !== undefined || token.length > 2000) return null
  const want = Buffer.from(sign(body))
  const got = Buffer.from(mac)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenBody
    if (typeof parsed.t !== 'string' || typeof parsed.e !== 'number' || parsed.e < now) return null
    return { tenantId: parsed.t, target: parsePreviewTarget(parsed.d) }
  } catch {
    return null
  }
}

export function previewLink(tenantId: string, target: PreviewTarget): string {
  return `${appBaseUrl()}/api/preview/${previewToken(tenantId, target)}`
}
