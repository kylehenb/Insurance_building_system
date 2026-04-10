'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { X, Upload } from 'lucide-react'

// — Types ——————————————————————————————————————————————————————————
interface Photo {
  id: string
  tenant_id: string
  job_id: string
  inspection_id: string | null
  storage_path: string
  label: string | null
  file_name: string | null
  uploaded_at: string
}

interface PhotoGroup {
  key: string
  label: string
  photos: (Photo & { thumbnailUrl: string | null })[]
}

interface PhotosTabProps {
  jobId: string
  tenantId: string
}

// — Lightbox ————————————————————————————————————————————————————
function Lightbox({
  storagePath,
  label,
  onClose,
}: {
  storagePath: string
  label: string | null
  onClose: () => void
}) {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    supabase.storage
      .from('photos')
      .createSignedUrl(storagePath, 3600)
      .then(({ data }) => setUrl(data?.signedUrl ?? null))
  }, [storagePath]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(26,26,26,0.85)' }}
      onClick={onClose}
    >
      <div
        className="relative max-w-5xl w-full mx-4"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute -top-10 right-0 text-white/80 hover:text-white"
        >
          <X className="h-6 w-6" />
        </button>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={label ?? 'Photo'}
            className="w-full rounded-lg object-contain max-h-[80vh]"
          />
        ) : (
          <div className="flex items-center justify-center h-64 text-white/60 text-[13px]">
            Loading…
          </div>
        )}
        {label && (
          <p className="mt-3 text-center text-white/80 text-[13px]">{label}</p>
        )}
      </div>
    </div>
  )
}

// — Thumbnail ——————————————————————————————————————————————————
function Thumbnail({
  photo,
  onClick,
}: {
  photo: Photo & { thumbnailUrl: string | null }
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="relative aspect-square rounded-lg overflow-hidden group"
      style={{ background: '#f0ece6' }}
    >
      {photo.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo.thumbnailUrl}
          alt={photo.label ?? photo.file_name ?? 'Photo'}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-[#9e998f] text-[11px]">
          Loading
        </div>
      )}
      {photo.label && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5">
          <p className="text-white text-[10px] truncate">{photo.label}</p>
        </div>
      )}
    </button>
  )
}

// — PhotosTab ——————————————————————————————————————————————————
export function PhotosTab({ jobId, tenantId }: PhotosTabProps) {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [groups, setGroups] = useState<PhotoGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [lightbox, setLightbox] = useState<{ path: string; label: string | null } | null>(null)

  const buildGroups = useCallback(
    async (photos: Photo[]) => {
      // Generate thumbnail signed URLs (60-min)
      const withUrls = await Promise.all(
        photos.map(async p => {
          const { data } = await supabase.storage
            .from('photos')
            .createSignedUrl(p.storage_path, 3600)
          return { ...p, thumbnailUrl: data?.signedUrl ?? null }
        })
      )

      // Group by inspection_id
      const groupMap = new Map<string, { label: string; photos: typeof withUrls }>()

      for (const photo of withUrls) {
        const key = photo.inspection_id ?? '__job__'
        if (!groupMap.has(key)) {
          groupMap.set(key, {
            label: photo.inspection_id ? `Inspection ${photo.inspection_id.slice(0, 8)}` : 'Job Photos',
            photos: [],
          })
        }
        groupMap.get(key)!.photos.push(photo)
      }

      // Put job photos first, then inspections
      const result: PhotoGroup[] = []
      const jobGroup = groupMap.get('__job__')
      if (jobGroup) result.push({ key: '__job__', ...jobGroup })

      for (const [key, val] of groupMap.entries()) {
        if (key !== '__job__') result.push({ key, ...val })
      }

      setGroups(result)
    },
    [supabase]
  )

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('photos')
        .select('id,tenant_id,job_id,inspection_id,storage_path,label,file_name,uploaded_at')
        .eq('job_id', jobId)
        .eq('tenant_id', tenantId)
        .order('uploaded_at', { ascending: true })
      const photos = (data ?? []) as Photo[]
      await buildGroups(photos)
      setLoading(false)
    }
    load()
  }, [jobId, tenantId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="py-12 text-center text-[13px] text-[#9e998f]">Loading photos…</div>
    )
  }

  return (
    <div style={{ fontFamily: 'DM Sans, sans-serif' }}>
      {/* Upload button (stub) */}
      <div className="flex justify-end mb-5">
        <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#e0dbd4] text-[13px] text-[#9e998f] hover:bg-[#f5f2ee] cursor-pointer transition-colors">
          <Upload className="h-4 w-4" />
          Upload photos
          <input type="file" multiple accept="image/*" className="sr-only" />
        </label>
      </div>

      {groups.length === 0 ? (
        <div className="py-16 text-center text-[13px] text-[#9e998f]">No photos yet</div>
      ) : (
        <div className="space-y-8">
          {groups.map(group => (
            <div key={group.key}>
              <h3
                className="text-[11px] uppercase tracking-[0.07em] text-[#9e998f] mb-3"
              >
                {group.label}
              </h3>
              <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
                {group.photos.map(photo => (
                  <Thumbnail
                    key={photo.id}
                    photo={photo}
                    onClick={() => setLightbox({ path: photo.storage_path, label: photo.label })}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {lightbox && (
        <Lightbox
          storagePath={lightbox.path}
          label={lightbox.label}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  )
}
