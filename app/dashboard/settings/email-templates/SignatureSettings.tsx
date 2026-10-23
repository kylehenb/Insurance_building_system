'use client'

import { useMemo, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { RichTextEditor } from '@/components/email/RichTextEditor'
import { composeStandardEmail } from '@/lib/email/compose'
import { toRichHtml } from '@/lib/email/rich-text'
import {
  SIGNATURE_IMAGE_DEFAULT_WIDTH,
  SIGNATURE_IMAGE_MAX_WIDTH,
  SIGNATURE_IMAGE_MIN_WIDTH,
  tenantAssetUrl,
} from '@/lib/email/signature'

type Tenant = Database['public']['Tables']['tenants']['Row']

// Settings → Email Templates → Signature: the name/details block and logo
// added to every templated email where {signature} is (or at the end).

const SAMPLE_BODY = '<p>Hi Casey,</p><p></p><p>Please find attached our quote for the repairs at 12 Example St.</p><p></p><p>Kind regards,</p><p>{signature}</p>'
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif']
const MAX_IMAGE_BYTES = 2 * 1024 * 1024

function imageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('Could not read the image'))
    img.src = url
  })
}

interface Props {
  supabase: SupabaseClient<Database>
  tenant: Tenant
  onSaved(tenant: Tenant): void
}

export function SignatureSettings({ supabase, tenant, onSaved }: Props) {
  const savedHtml = tenant.email_signature ? toRichHtml(tenant.email_signature) : ''
  const [html, setHtml] = useState(savedHtml)
  const [imagePath, setImagePath] = useState(tenant.email_signature_image_path)
  const [width, setWidth] = useState(tenant.email_signature_image_width ?? SIGNATURE_IMAGE_DEFAULT_WIDTH)
  // height ÷ width of the image as uploaded
  const [aspect, setAspect] = useState(
    tenant.email_signature_image_width && tenant.email_signature_image_height
      ? tenant.email_signature_image_height / tenant.email_signature_image_width
      : 0.3,
  )
  const [busy, setBusy] = useState<'upload' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const height = Math.max(1, Math.round(width * aspect))
  const fields = {
    email_signature: html.replace(/<p><\/p>/g, '').trim() ? html : null,
    email_signature_image_path: imagePath,
    email_signature_image_width: imagePath ? width : null,
    email_signature_image_height: imagePath ? height : null,
  }
  const dirty =
    (fields.email_signature ?? '') !== (tenant.email_signature ? savedHtml : '') ||
    fields.email_signature_image_path !== tenant.email_signature_image_path ||
    fields.email_signature_image_width !== tenant.email_signature_image_width ||
    fields.email_signature_image_height !== tenant.email_signature_image_height

  const previewHtml = useMemo(
    () => composeStandardEmail(SAMPLE_BODY, { ...tenant, ...fields }).html,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tenant, html, imagePath, width, height],
  )

  const applyImage = async (path: string) => {
    const url = tenantAssetUrl(path)
    if (!url) throw new Error('Storage is not configured')
    const size = await imageSize(url)
    setImagePath(path)
    setAspect(size.height / size.width)
    // Shown at up to the default width, never larger than the file itself
    setWidth(Math.max(SIGNATURE_IMAGE_MIN_WIDTH, Math.min(SIGNATURE_IMAGE_DEFAULT_WIDTH, size.width)))
  }

  const upload = async (file: File) => {
    setError(null)
    if (!IMAGE_TYPES.includes(file.type)) { setError('Use a PNG, JPG or GIF image. SVG and WebP images don’t show in Outlook or Gmail.'); return }
    if (file.size > MAX_IMAGE_BYTES) { setError('That image is over 2 MB. Use a smaller version of the logo.'); return }
    setBusy('upload')
    try {
      const ext = file.type === 'image/png' ? 'png' : file.type === 'image/gif' ? 'gif' : 'jpg'
      // A new file each time, so emails already sent keep their image
      const path = `tenants/${tenant.id}/email/signature-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('tenant-assets').upload(path, file, { contentType: file.type })
      if (upErr) throw upErr
      await applyImage(path)
    } catch (err) {
      console.error('Signature image upload failed:', err)
      setError('Upload failed — please try again.')
    } finally {
      setBusy(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const logoIsUsable = !!tenant.logo_storage_path && /\.(png|jpe?g|gif)$/i.test(tenant.logo_storage_path)

  const save = async () => {
    setBusy('save')
    setError(null)
    try {
      const res = await fetch('/api/settings/tenant', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      })
      if (!res.ok) throw new Error(`Save failed (${res.status})`)
      onSaved((await res.json()) as Tenant)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error('Signature save failed:', err)
      setError('Save failed — please try again.')
    } finally {
      setBusy(null)
    }
  }

  const labelCls = 'block text-[10px] uppercase tracking-wider text-subtle font-semibold mb-2'
  const smallBtn = 'px-3 py-1.5 text-xs border border-line-3 rounded text-body-soft hover:bg-surface-5 disabled:opacity-50'

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 min-w-0">
      <section className="bg-white border border-line-3 rounded-lg p-5 min-w-0">
        <div className="font-semibold text-ink mb-1">Email signature</div>
        <p className="text-xs text-subtle mb-4 leading-relaxed">
          Added to every email the system sends from a template — where the template has {'{signature}'}, or at the end if it doesn’t.
          For example your name and role on the first line, then the company, phone and email.
        </p>

        <label className={labelCls}>Signature text</label>
        <RichTextEditor value={html} onChange={setHtml} minHeight={130} compact />

        <div className="mt-5">
          <label className={labelCls}>Logo or image</label>
          {imagePath ? (
            <div className="border border-line-3 rounded-md p-3 bg-surface-5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={tenantAssetUrl(imagePath) ?? ''} alt="" style={{ width, height }} className="block max-w-full bg-white" />
              <div className="mt-3 flex items-center gap-3 flex-wrap">
                <label className="text-xs text-body-soft flex items-center gap-2">
                  Width
                  <input
                    type="range"
                    min={SIGNATURE_IMAGE_MIN_WIDTH}
                    max={SIGNATURE_IMAGE_MAX_WIDTH}
                    step={10}
                    value={width}
                    onChange={e => setWidth(Number(e.target.value))}
                  />
                  <span className="tabular-nums">{width} px</span>
                </label>
                <button type="button" onClick={() => fileRef.current?.click()} disabled={busy !== null} className={smallBtn}>Replace</button>
                <button type="button" onClick={() => setImagePath(null)} disabled={busy !== null} className="text-xs text-danger-dark hover:underline">Remove</button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" onClick={() => fileRef.current?.click()} disabled={busy !== null} className={smallBtn}>
                {busy === 'upload' ? 'Uploading…' : 'Upload image'}
              </button>
              {logoIsUsable && (
                <button
                  type="button"
                  disabled={busy !== null}
                  className={smallBtn}
                  onClick={() => applyImage(tenant.logo_storage_path!).catch(() => setError('Could not load the company logo.'))}
                >
                  Use company logo
                </button>
              )}
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) upload(f) }}
          />
          <p className="text-xs text-subtle mt-2 leading-relaxed">
            PNG, JPG or GIF. For a sharp logo on phones, upload one about twice as wide as it’s shown. Some Outlook setups show
            “click to download pictures” for new senders — the signature text still shows until they do.
          </p>
        </div>

        <div className="mt-5 flex items-center gap-3 justify-end">
          {error && <span className="text-xs text-red-600 mr-auto">{error}</span>}
          {saved && <span className="text-xs text-green-600">Saved</span>}
          <button
            onClick={save}
            disabled={!dirty || busy !== null}
            className="px-4 py-1.5 text-xs bg-gold text-white rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#b8985e] transition-colors"
          >
            {busy === 'save' ? 'Saving…' : 'Save'}
          </button>
        </div>
      </section>

      <section className="bg-white border border-line-3 rounded-lg p-5 min-w-0">
        <div className={labelCls}>Preview</div>
        <p className="text-xs text-subtle mb-4">How it looks at the end of an email</p>
        <iframe title="Signature preview" srcDoc={previewHtml} sandbox="" className="w-full h-[420px] border border-line-3 rounded-md bg-white" />
      </section>
    </div>
  )
}
