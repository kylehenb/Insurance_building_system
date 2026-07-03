'use client'

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { Upload, Trash2, Loader2, RotateCcw, RotateCw, GripVertical } from 'lucide-react'

// — Types ——————————————————————————————————————————————————————————
interface Photo {
  id: string
  tenant_id: string
  job_id: string
  report_id: string | null
  storage_path: string
  label: string | null
  file_name: string | null
  uploaded_at: string
  sequence_number: number
  rotation: number
  crop_x: number
  crop_y: number
  crop_scale: number
}

interface UploadingPhoto {
  id: string
  file: File
  fileName: string
  status: 'uploading' | 'success' | 'error'
  error?: string
  photoId?: string
  thumbnailUrl?: string
  label?: string
}

interface ReportPhotosProps {
  reportId: string
  jobId: string
  tenantId: string
  locked: boolean
}

// — Thumbnail ——————————————————————————————————————————————————
function PhotoCard({
  photo,
  thumbnailUrl,
  onLabelChange,
  onDelete,
  onRotate,
  onCropChange,
  locked,
  isDragged,
  isDragOver,
  isInternalDragging,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onDrop,
}: {
  photo: Photo
  thumbnailUrl: string | null
  onLabelChange: (id: string, label: string) => void
  onDelete: (id: string) => void
  onRotate: (id: string, direction: 'cw' | 'ccw') => void
  onCropChange: (id: string, x: number, y: number, scale: number) => void
  locked: boolean
  isDragged: boolean
  isDragOver: boolean
  isInternalDragging: boolean
  onDragStart: () => void
  onDragEnter: () => void
  onDragEnd: () => void
  onDrop: () => void
}) {
  const [label, setLabel] = useState(photo.label || '')
  const [cropX, setCropX] = useState(photo.crop_x ?? 0)
  const [cropY, setCropY] = useState(photo.crop_y ?? 0)
  const [cropScale, setCropScale] = useState(photo.crop_scale ?? 1)
  const cropRef = useRef({ x: photo.crop_x ?? 0, y: photo.crop_y ?? 0, scale: photo.crop_scale ?? 1 })
  const frameRef = useRef<HTMLDivElement>(null)
  const isPanning = useRef(false)
  const lastPointer = useRef({ x: 0, y: 0 })
  const dragEnabled = useRef(false)

  const handleLabelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newLabel = e.target.value
    setLabel(newLabel)
    onLabelChange(photo.id, newLabel)
  }

  const updateCrop = useCallback((x: number, y: number, scale: number) => {
    cropRef.current = { x, y, scale }
    setCropX(x)
    setCropY(y)
    setCropScale(scale)
    onCropChange(photo.id, x, y, scale)
  }, [photo.id, onCropChange])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (locked) return
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.1 : 0.1
    const newScale = Math.max(0.5, Math.min(8, cropRef.current.scale + delta))
    updateCrop(cropRef.current.x, cropRef.current.y, newScale)
  }, [locked, updateCrop])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (locked) return
    dragEnabled.current = false
    e.preventDefault()
    isPanning.current = true
    lastPointer.current = { x: e.clientX, y: e.clientY }
    frameRef.current?.setPointerCapture(e.pointerId)
  }, [locked])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanning.current || !frameRef.current) return
    const rect = frameRef.current.getBoundingClientRect()
    const dx = (e.clientX - lastPointer.current.x) / rect.width * 100
    const dy = (e.clientY - lastPointer.current.y) / rect.height * 100
    lastPointer.current = { x: e.clientX, y: e.clientY }
    updateCrop(cropRef.current.x + dx, cropRef.current.y + dy, cropRef.current.scale)
  }, [updateCrop])

  const handlePointerUp = useCallback(() => {
    isPanning.current = false
  }, [])

  const isCropped = cropX !== 0 || cropY !== 0 || cropScale !== 1

  return (
    // Outer wrapper: drop target only
    <div
      onDragEnter={(e) => {
        e.preventDefault()
        onDragEnter()
      }}
      onDragOver={(e) => { e.preventDefault() }}
      onDrop={(e) => {
        e.preventDefault()
        if (isInternalDragging) onDrop()
      }}
      className="relative group"
      style={{ opacity: isDragged ? 0.3 : 1, transition: 'opacity 0.15s' }}
    >
      {/* Drag shell — draggable only when grip is held */}
      <div
        draggable={!locked}
        onDragStart={(e) => {
          if (!dragEnabled.current) { e.preventDefault(); return }
          e.dataTransfer.effectAllowed = 'move'
          onDragStart()
        }}
        onDragEnd={() => { dragEnabled.current = false; onDragEnd() }}
      >
        {/* Crop frame — pointer events for pan/zoom */}
        <div
          ref={frameRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onWheel={handleWheel}
          style={{
            position: 'relative',
            height: 190,
            overflow: 'hidden',
            borderRadius: 8,
            background: '#f5f2ee',
            border: isDragOver && !isDragged ? '2px dashed #c8b89a' : '1px solid #e0dbd4',
            cursor: locked ? 'default' : 'grab',
            touchAction: 'none',
          }}
        >
          {thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbnailUrl}
              alt={photo.label || photo.file_name || 'Photo'}
              draggable={false}
              style={{
                position: 'absolute',
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                transformOrigin: 'center center',
                transform: `rotate(${photo.rotation ?? 0}deg) translate(${cropX}%, ${cropY}%) scale(${cropScale})`,
                userSelect: 'none',
                pointerEvents: 'none',
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[#9e998f] text-[11px] bg-[#f5f2ee]">
              Loading
            </div>
          )}

          {!locked && (
            <>
              {/* Grip — only drag handle; stops propagation so frame's pointerdown doesn't fire */}
              <div
                className="absolute top-2 left-2 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: 'rgba(0,0,0,0.45)', cursor: 'grab', zIndex: 2 }}
                onPointerDown={(e) => { e.stopPropagation(); dragEnabled.current = true }}
                onPointerUp={() => { dragEnabled.current = false }}
              >
                <GripVertical className="h-3 w-3 text-white" style={{ pointerEvents: 'none' }} />
              </div>

              {/* Action buttons */}
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" style={{ zIndex: 2 }}>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onRotate(photo.id, 'ccw') }}
                  className="p-1.5 text-white rounded-md transition-colors hover:bg-black/70"
                  style={{ background: 'rgba(0,0,0,0.45)' }}
                  title="Rotate left"
                >
                  <RotateCcw className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onRotate(photo.id, 'cw') }}
                  className="p-1.5 text-white rounded-md transition-colors hover:bg-black/70"
                  style={{ background: 'rgba(0,0,0,0.45)' }}
                  title="Rotate right"
                >
                  <RotateCw className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onDelete(photo.id) }}
                  className="p-1.5 bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors"
                  title="Delete"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>

              {/* Reset crop */}
              {isCropped && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); updateCrop(0, 0, 1) }}
                  className="absolute opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{
                    bottom: 6, right: 6, zIndex: 2,
                    background: 'rgba(0,0,0,0.55)', color: 'white',
                    border: 'none', borderRadius: 4, padding: '2px 8px',
                    fontSize: 9, cursor: 'pointer',
                    fontFamily: 'DM Sans, sans-serif', letterSpacing: '0.5px',
                  }}
                >
                  Reset crop
                </button>
              )}

              {/* Zoom/pan hint */}
              {!isCropped && (
                <div
                  className="absolute opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                  style={{
                    bottom: 6, left: '50%', transform: 'translateX(-50%)',
                    background: 'rgba(0,0,0,0.45)', color: 'white',
                    borderRadius: 4, padding: '2px 8px',
                    fontSize: 9, whiteSpace: 'nowrap',
                    fontFamily: 'DM Sans, sans-serif',
                  }}
                >
                  Scroll to zoom · Drag to pan
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <input
        type="text"
        value={label}
        onChange={handleLabelChange}
        disabled={locked}
        placeholder="Add label..."
        className="mt-2 w-full px-2 py-1.5 rounded border border-[#e0dbd4] text-[11px] text-[#3a3530] bg-white focus:outline-none focus:border-[#c8b89a] disabled:bg-[#f9f7f5] disabled:text-[#b0a898] disabled:cursor-not-allowed"
        style={{ fontFamily: 'DM Sans, sans-serif' }}
      />
    </div>
  )
}

// — Uploading Photo Card —————————————————————————————————————
function UploadingPhotoCard({
  uploadingPhoto,
  onCancel,
  onLabelChange,
}: {
  uploadingPhoto: UploadingPhoto
  onCancel: (id: string) => void
  onLabelChange: (id: string, label: string) => void
}) {
  const [label, setLabel] = useState(uploadingPhoto.label || '')

  const handleLabelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newLabel = e.target.value
    setLabel(newLabel)
    onLabelChange(uploadingPhoto.id, newLabel)
  }

  return (
    <div className="relative group">
      <div style={{ position: 'relative', height: 190, overflow: 'hidden', borderRadius: 8, border: '1px solid #e0dbd4', background: '#f5f2ee' }}>
        {uploadingPhoto.status === 'uploading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <Loader2 className="h-8 w-8 text-[#c8b89a] animate-spin mb-2" />
            <div className="text-[11px] text-[#9e998f]">Uploading...</div>
          </div>
        )}
        {uploadingPhoto.status === 'success' && uploadingPhoto.thumbnailUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={uploadingPhoto.thumbnailUrl}
            alt={uploadingPhoto.label || uploadingPhoto.fileName}
            style={{ position: 'absolute', width: '100%', height: '100%', objectFit: 'contain' }}
          />
        )}
        {uploadingPhoto.status === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-[11px] text-red-500 p-2 text-center">
            <div className="font-semibold mb-1">Upload failed</div>
            <div className="text-[#b0a898]">{uploadingPhoto.error || 'Try again'}</div>
          </div>
        )}
        <button
          onClick={() => onCancel(uploadingPhoto.id)}
          className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      <input
        type="text"
        value={label}
        onChange={handleLabelChange}
        placeholder="Add label..."
        className="mt-2 w-full px-2 py-1.5 rounded border border-[#e0dbd4] text-[11px] text-[#3a3530] bg-white focus:outline-none focus:border-[#c8b89a]"
        style={{ fontFamily: 'DM Sans, sans-serif' }}
      />
    </div>
  )
}

// — ReportPhotos ————————————————————————————————————————————————
export function ReportPhotos({ reportId, jobId, tenantId, locked }: ReportPhotosProps) {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [photos, setPhotos] = useState<(Photo & { thumbnailUrl: string | null })[]>([])
  const [loading, setLoading] = useState(true)
  const [uploadingPhotos, setUploadingPhotos] = useState<UploadingPhoto[]>([])
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [isDraggingFile, setIsDraggingFile] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const labelDebounceRefs = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const cropDebounceRefs = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const isFileDrag = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types).includes('Files')

  const loadPhotos = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('photos')
      .select('*')
      .eq('report_id', reportId)
      .eq('tenant_id', tenantId)
      .order('sequence_number', { ascending: true })

    const photoData = (data ?? []) as Photo[]

    const withUrls = await Promise.all(
      photoData.map(async p => {
        const { data } = await supabase.storage
          .from('photos')
          .createSignedUrl(`${p.storage_path}?width=400&height=300`, 3600)
        return { ...p, thumbnailUrl: data?.signedUrl ?? null }
      })
    )

    setPhotos(withUrls)
    setLoading(false)
  }, [reportId, tenantId, supabase])

  useEffect(() => {
    loadPhotos()
  }, [loadPhotos])

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) return

    const newUploadingPhotos: UploadingPhoto[] = files.map(file => ({
      id: `uploading-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      file,
      fileName: file.name,
      status: 'uploading' as const,
    }))

    setUploadingPhotos(prev => [...prev, ...newUploadingPhotos])

    for (let i = 0; i < newUploadingPhotos.length; i++) {
      const uploadingPhoto = newUploadingPhotos[i]

      try {
        const fileExt = uploadingPhoto.file.name.split('.').pop()
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`
        const filePath = `${tenantId}/${jobId}/${reportId}/${fileName}`

        const { error: uploadError } = await supabase.storage
          .from('photos')
          .upload(filePath, uploadingPhoto.file, { upsert: false })

        if (uploadError) throw uploadError

        const { data: photoData, error: dbError } = await supabase
          .from('photos')
          .insert({
            tenant_id: tenantId,
            job_id: jobId,
            report_id: reportId,
            storage_path: filePath,
            file_name: uploadingPhoto.file.name,
            sequence_number: photos.length + i + 1,
          })
          .select()
          .single()

        if (dbError) throw dbError

        const { data: signedUrlData } = await supabase.storage
          .from('photos')
          .createSignedUrl(`${filePath}?width=400&height=300`, 3600)

        setUploadingPhotos(prev => prev.filter(p => p.id !== uploadingPhoto.id))
        setPhotos(prev => [...prev, { ...photoData as Photo, thumbnailUrl: signedUrlData?.signedUrl ?? null }])
      } catch (error) {
        console.error('Upload error:', error)
        setUploadingPhotos(prev =>
          prev.map(p =>
            p.id === uploadingPhoto.id
              ? { ...p, status: 'error', error: error instanceof Error ? error.message : 'Upload failed' }
              : p
          )
        )
      }
    }
  }

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    uploadFiles(Array.from(files))
    e.target.value = ''
  }

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDraggingFile(false)
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'))
    uploadFiles(files)
  }

  const handleLabelChange = (id: string, label: string) => {
    setPhotos(prev => prev.map(p => p.id === id ? { ...p, label } : p))

    const existing = labelDebounceRefs.current.get(id)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(async () => {
      labelDebounceRefs.current.delete(id)
      const { error } = await supabase
        .from('photos')
        .update({ label })
        .eq('id', id)
        .eq('tenant_id', tenantId)
      if (error) console.error('Label save error:', error)
    }, 600)

    labelDebounceRefs.current.set(id, timer)
  }

  const handleCropChange = (id: string, x: number, y: number, scale: number) => {
    setPhotos(prev => prev.map(p => p.id === id ? { ...p, crop_x: x, crop_y: y, crop_scale: scale } : p))

    const existing = cropDebounceRefs.current.get(id)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(async () => {
      cropDebounceRefs.current.delete(id)
      const { error } = await supabase
        .from('photos')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({ crop_x: x, crop_y: y, crop_scale: scale } as any)
        .eq('id', id)
        .eq('tenant_id', tenantId)
      if (error) console.error('Crop save error:', error)
    }, 400)

    cropDebounceRefs.current.set(id, timer)
  }

  const handleRotate = async (id: string, direction: 'cw' | 'ccw') => {
    const photo = photos.find(p => p.id === id)
    if (!photo) return
    const delta = direction === 'cw' ? 90 : -90
    const newRotation = ((photo.rotation ?? 0) + delta + 360) % 360

    setPhotos(prev => prev.map(p => p.id === id ? { ...p, rotation: newRotation } : p))

    const { error } = await supabase
      .from('photos')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ rotation: newRotation } as any)
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (error) {
      console.error('Rotate error:', error)
      setPhotos(prev => prev.map(p => p.id === id ? { ...p, rotation: photo.rotation } : p))
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this photo?')) return

    const uploadingPhoto = uploadingPhotos.find(p => p.id === id)
    if (uploadingPhoto) {
      setUploadingPhotos(prev => prev.filter(p => p.id !== id))
      return
    }

    const photo = photos.find(p => p.id === id)
    if (!photo) return

    setPhotos(prev => prev.filter(p => p.id !== id))

    const { error: storageError } = await supabase.storage
      .from('photos')
      .remove([photo.storage_path])

    if (storageError) {
      console.error('Storage delete error:', storageError)
    }

    const { error: dbError } = await supabase
      .from('photos')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (dbError) {
      console.error('Database delete error:', dbError)
    }
  }

  const handleDragStart = (id: string) => { setDraggedId(id) }
  const handleDragEnter = (id: string) => { if (draggedId && draggedId !== id) setDragOverId(id) }
  const handleDragEnd = () => { setDraggedId(null); setDragOverId(null) }

  const handleDrop = async (targetId: string) => {
    if (!draggedId || draggedId === targetId) return

    const fromIndex = photos.findIndex(p => p.id === draggedId)
    const toIndex = photos.findIndex(p => p.id === targetId)
    if (fromIndex === -1 || toIndex === -1) return

    const reordered = [...photos]
    const [moved] = reordered.splice(fromIndex, 1)
    reordered.splice(toIndex, 0, moved)

    setPhotos(reordered)
    setDraggedId(null)
    setDragOverId(null)

    await Promise.all(
      reordered.map((photo, index) =>
        supabase
          .from('photos')
          .update({ sequence_number: index + 1 })
          .eq('id', photo.id)
          .eq('tenant_id', tenantId)
      )
    )
  }

  if (loading) {
    return (
      <div className="py-8 text-center text-[13px] text-[#9e998f]">
        Loading photos…
      </div>
    )
  }

  return (
    <div
      style={{ fontFamily: 'DM Sans, sans-serif' }}
      onDragOver={(e) => {
        if (isFileDrag(e) && !locked) {
          e.preventDefault()
          setIsDraggingFile(true)
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsDraggingFile(false)
        }
      }}
      onDrop={(e) => {
        if (isFileDrag(e) && !locked) {
          handleFileDrop(e)
        }
      }}
    >
      {!locked && (
        <div className="flex justify-between items-center mb-4">
          <div className="text-[12px] text-[#b0a898]">
            {uploadingPhotos.filter(p => p.status === 'uploading').length > 0 &&
              `${uploadingPhotos.filter(p => p.status === 'uploading').length} uploading...`}
          </div>
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
            onChange={handleUpload}
            className="sr-only"
          />
        </div>
      )}

      {photos.length === 0 && uploadingPhotos.length === 0 ? (
        <div
          className="py-12 text-center text-[13px] border-2 border-dashed rounded-lg transition-colors"
          style={{
            borderColor: isDraggingFile ? '#c8b89a' : '#e0dbd4',
            color: isDraggingFile ? '#c8b89a' : '#9e998f',
            background: isDraggingFile ? '#fdf9f4' : 'transparent',
          }}
        >
          {isDraggingFile ? 'Drop photos here' : 'No photos added yet — drag photos here or use the button above'}
        </div>
      ) : (
        <div
          className="rounded-lg transition-colors"
          style={{
            outline: isDraggingFile ? '2px dashed #c8b89a' : 'none',
            outlineOffset: '6px',
            background: isDraggingFile ? '#fdf9f4' : 'transparent',
          }}
        >
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {photos.map(photo => (
              <PhotoCard
                key={photo.id}
                photo={photo}
                thumbnailUrl={photo.thumbnailUrl}
                onLabelChange={handleLabelChange}
                onDelete={handleDelete}
                onRotate={handleRotate}
                onCropChange={handleCropChange}
                locked={locked}
                isDragged={draggedId === photo.id}
                isDragOver={dragOverId === photo.id}
                isInternalDragging={draggedId !== null}
                onDragStart={() => handleDragStart(photo.id)}
                onDragEnter={() => handleDragEnter(photo.id)}
                onDragEnd={handleDragEnd}
                onDrop={() => handleDrop(photo.id)}
              />
            ))}
            {uploadingPhotos.map(uploadingPhoto => (
              <UploadingPhotoCard
                key={uploadingPhoto.id}
                uploadingPhoto={uploadingPhoto}
                onCancel={handleDelete}
                onLabelChange={(id, label) => {
                  setUploadingPhotos(prev =>
                    prev.map(p => p.id === id ? { ...p, label } : p)
                  )
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
