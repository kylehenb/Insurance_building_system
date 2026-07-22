'use client'

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { X, Upload, FileDown, Check, Loader2 } from 'lucide-react'

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

interface UploadingPhoto {
  id: string
  fileName: string
  status: 'uploading' | 'error'
  error?: string
}

interface PhotoGroup {
  key: string
  label: string
  photos: (Photo & { thumbnailUrl: string | null })[]
}

interface PhotosTabProps {
  jobId: string
  tenantId: string
  jobNumber: string
  insuredName: string | null
  propertyAddress: string | null
  claimNumber: string | null
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
  selected,
  onToggleSelect,
  onOpenLightbox,
}: {
  photo: Photo & { thumbnailUrl: string | null }
  selected: boolean
  onToggleSelect: () => void
  onOpenLightbox: () => void
}) {
  return (
    <div
      className="relative aspect-square rounded-lg overflow-hidden"
      style={{ background: '#f0ece6' }}
    >
      <button
        type="button"
        onClick={onOpenLightbox}
        className="absolute inset-0 w-full h-full"
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

      {!selected && (
        <div
          className="absolute inset-0 pointer-events-none rounded-lg"
          style={{ background: 'rgba(255,255,255,0.55)' }}
        />
      )}

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggleSelect() }}
        className="absolute top-1.5 right-1.5 z-10 w-5 h-5 rounded-full flex items-center justify-center transition-all"
        style={{
          background: selected ? '#1a1a1a' : 'rgba(255,255,255,0.85)',
          border: `1.5px solid ${selected ? '#1a1a1a' : 'rgba(0,0,0,0.2)'}`,
          boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
        }}
      >
        {selected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
      </button>
    </div>
  )
}

// — UploadingThumbnail ————————————————————————————————————————
function UploadingThumbnail({ photo }: { photo: UploadingPhoto }) {
  return (
    <div
      className="relative aspect-square rounded-lg overflow-hidden flex flex-col items-center justify-center gap-1"
      style={{ background: '#f0ece6' }}
    >
      {photo.status === 'uploading' ? (
        <>
          <Loader2 className="h-5 w-5 text-[#9e998f] animate-spin" />
          <p className="text-[10px] text-[#9e998f] px-2 text-center truncate w-full">{photo.fileName}</p>
        </>
      ) : (
        <>
          <X className="h-5 w-5 text-red-400" />
          <p className="text-[10px] text-red-400 px-2 text-center">Failed</p>
        </>
      )}
    </div>
  )
}

// — PhotosTab ——————————————————————————————————————————————————
export function PhotosTab({
  jobId,
  tenantId,
  jobNumber,
  insuredName,
  propertyAddress,
  claimNumber,
}: PhotosTabProps) {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [groups, setGroups] = useState<PhotoGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [lightbox, setLightbox] = useState<{ path: string; label: string | null } | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [uploadingPhotos, setUploadingPhotos] = useState<UploadingPhoto[]>([])
  const [isDraggingFile, setIsDraggingFile] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const buildGroups = useCallback(
    async (photos: Photo[]) => {
      const withUrls = await Promise.all(
        photos.map(async p => {
          const { data } = await supabase.storage
            .from('photos')
            .createSignedUrl(p.storage_path, 3600)
          return { ...p, thumbnailUrl: data?.signedUrl ?? null }
        })
      )

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

      const result: PhotoGroup[] = []
      const jobGroup = groupMap.get('__job__')
      if (jobGroup) result.push({ key: '__job__', ...jobGroup })

      for (const [key, val] of groupMap.entries()) {
        if (key !== '__job__') result.push({ key, ...val })
      }

      setGroups(result)
      setSelectedIds(new Set(photos.map(p => p.id)))
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

  const uploadFiles = useCallback(async (files: File[]) => {
    const imageFiles = files.filter(f => f.type.startsWith('image/'))
    if (imageFiles.length === 0) return

    const placeholders: UploadingPhoto[] = imageFiles.map(file => ({
      id: `uploading-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      fileName: file.name,
      status: 'uploading' as const,
    }))

    setUploadingPhotos(prev => [...prev, ...placeholders])

    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i]
      const placeholder = placeholders[i]

      try {
        const ext = file.name.split('.').pop()
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`
        const filePath = `${tenantId}/${jobId}/${fileName}`

        const { error: uploadError } = await supabase.storage
          .from('photos')
          .upload(filePath, file, { upsert: false })

        if (uploadError) throw uploadError

        const { data: photoData, error: dbError } = await supabase
          .from('photos')
          .insert({
            tenant_id: tenantId,
            job_id: jobId,
            storage_path: filePath,
            file_name: file.name,
          })
          .select('id,tenant_id,job_id,inspection_id,storage_path,label,file_name,uploaded_at')
          .single()

        if (dbError) throw dbError

        const { data: signedUrlData } = await supabase.storage
          .from('photos')
          .createSignedUrl(filePath, 3600)

        setUploadingPhotos(prev => prev.filter(p => p.id !== placeholder.id))

        const newPhoto = { ...(photoData as Photo), thumbnailUrl: signedUrlData?.signedUrl ?? null }
        setGroups(prev => {
          const jobGroupIndex = prev.findIndex(g => g.key === '__job__')
          if (jobGroupIndex >= 0) {
            const updated = [...prev]
            updated[jobGroupIndex] = {
              ...updated[jobGroupIndex],
              photos: [...updated[jobGroupIndex].photos, newPhoto],
            }
            return updated
          }
          return [...prev, { key: '__job__', label: 'Job Photos', photos: [newPhoto] }]
        })
        setSelectedIds(prev => new Set([...prev, (photoData as Photo).id]))
      } catch (error) {
        console.error('Upload error:', error)
        setUploadingPhotos(prev =>
          prev.map(p => p.id === placeholder.id ? { ...p, status: 'error' as const } : p)
        )
      }
    }
  }, [supabase, tenantId, jobId])

  const allPhotos = groups.flatMap(g => g.photos)
  const totalCount = allPhotos.length
  const selectedCount = selectedIds.size

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleExportPDF() {
    if (selectedIds.size === 0) return
    const ids = [...selectedIds].join(',')
    window.open(`/print/jobs/${jobId}/photos?ids=${encodeURIComponent(ids)}`, '_blank')
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    uploadFiles(Array.from(files))
    e.target.value = ''
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    if (Array.from(e.dataTransfer.types).includes('Files')) {
      setIsDraggingFile(true)
    }
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDraggingFile(false)
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDraggingFile(false)
    const files = Array.from(e.dataTransfer.files)
    uploadFiles(files)
  }

  if (loading) {
    return (
      <div className="py-12 text-center text-[13px] text-[#9e998f]">Loading photos…</div>
    )
  }

  const hasContent = groups.length > 0 || uploadingPhotos.length > 0

  return (
    <div
      style={{ fontFamily: 'DM Sans, sans-serif' }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDraggingFile && (
        <div className="fixed inset-0 z-40 pointer-events-none flex items-center justify-center"
          style={{ background: 'rgba(245,242,238,0.85)' }}
        >
          <div className="flex flex-col items-center gap-3 text-[#3a3530]">
            <Upload className="h-10 w-10" />
            <p className="text-[15px] font-medium">Drop photos to upload</p>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-5">
        {totalCount > 0 && (
          <button
            type="button"
            onClick={() =>
              setSelectedIds(
                selectedCount === totalCount
                  ? new Set()
                  : new Set(allPhotos.map(p => p.id))
              )
            }
            className="text-[12px] text-[#9e998f] hover:text-[#3a3530] transition-colors"
          >
            {selectedCount === totalCount ? 'Deselect all' : 'Select all'}
          </button>
        )}

        <div className="flex items-center gap-2 ml-auto">
          {totalCount > 0 && (
            <button
              type="button"
              onClick={handleExportPDF}
              disabled={selectedCount === 0}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: selectedCount > 0 ? '#1a1a1a' : '#e0dbd4',
                color: selectedCount > 0 ? '#f5f2ee' : '#9e998f',
              }}
            >
              <FileDown className="h-4 w-4" />
              Export PDF
              <span className="text-[11px] opacity-60">
                {selectedCount}/{totalCount}
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#e0dbd4] text-[13px] text-[#9e998f] hover:bg-[#f5f2ee] cursor-pointer transition-colors"
          >
            <Upload className="h-4 w-4" />
            Upload photos
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            className="sr-only"
            onChange={handleFileInputChange}
          />
        </div>
      </div>

      {!hasContent ? (
        <div
          className="py-16 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed transition-colors"
          style={{ borderColor: '#e0dbd4', color: '#9e998f' }}
        >
          <Upload className="h-8 w-8 opacity-40" />
          <p className="text-[13px]">No photos yet — drag &amp; drop or click Upload photos</p>
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map(group => (
            <div key={group.key}>
              <h3 className="text-[11px] uppercase tracking-[0.07em] text-[#9e998f] mb-3">
                {group.label}
              </h3>
              <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
                {group.photos.map(photo => (
                  <Thumbnail
                    key={photo.id}
                    photo={photo}
                    selected={selectedIds.has(photo.id)}
                    onToggleSelect={() => toggleSelect(photo.id)}
                    onOpenLightbox={() => setLightbox({ path: photo.storage_path, label: photo.label })}
                  />
                ))}
              </div>
            </div>
          ))}

          {uploadingPhotos.length > 0 && (
            <div>
              <h3 className="text-[11px] uppercase tracking-[0.07em] text-[#9e998f] mb-3">
                Uploading
              </h3>
              <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
                {uploadingPhotos.map(p => (
                  <UploadingThumbnail key={p.id} photo={p} />
                ))}
              </div>
            </div>
          )}
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
