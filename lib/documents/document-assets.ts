import { readFile } from 'node:fs/promises'
import path from 'node:path'

// Images for PDF documents. The PDF renderer blocks network requests, so
// every image is embedded as a data: URI. Routes that use these must list the
// files in next.config.ts outputFileTracingIncludes.

const publicImageCache = new Map<string, Promise<string | null>>()

/** An image from /public as a data: URI (null if missing). Cached per instance. */
export function loadPublicImageDataUri(fileName: string): Promise<string | null> {
  let p = publicImageCache.get(fileName)
  if (!p) {
    const mime = fileName.endsWith('.png') ? 'image/png' : fileName.endsWith('.svg') ? 'image/svg+xml' : 'image/jpeg'
    p = readFile(path.join(process.cwd(), 'public', fileName))
      .then(buf => `data:${mime};base64,${buf.toString('base64')}`)
      .catch(err => {
        console.error(`Document asset ${fileName} not found, rendering without it`, err)
        publicImageCache.delete(fileName)
        return null
      })
    publicImageCache.set(fileName, p)
  }
  return p
}

/** The tenant's uploaded logo (public tenant-assets bucket) as a data: URI. */
export async function loadTenantLogoDataUri(storagePath: string | null | undefined): Promise<string | null> {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!storagePath || !baseUrl) return null
  const url = `${baseUrl}/storage/v1/object/public/tenant-assets/${storagePath.split('/').map(encodeURIComponent).join('/')}`
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const type = res.headers.get('content-type') ?? ''
    const mime = type.startsWith('image/') ? type.split(';')[0] : 'image/png'
    return `data:${mime};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`
  } catch (err) {
    console.error('Document tenant logo download failed', err)
    return null
  }
}

/** Safe-ish file name part: letters, digits, spaces and a little punctuation. */
export function filenamePart(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[^\w\s,.-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
