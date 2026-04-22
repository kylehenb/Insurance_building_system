'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { X, Upload, Trash2, GripVertical } from 'lucide-react'

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
  locked,
}: {
  photo: Photo
  thumbnailUrl: string | null
  onLabelChange: (id: string, label: string) => void
  onDelete: (id: string) => void
  locked: boolean
}) {
  const [label, setLabel] = useState(photo.label || '')

  const handleLabelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newLabel = e.target.value
    setLabel(newLabel)
    onLabelChange(photo.id, newLabel)
  }

  return (
    <div className="relative group">
      <div className="relative aspect-square rounded-lg overflow-hidden border border-[#e0dbd4]">
        {thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnailUrl}
            alt={photo.label || photo.file_name || 'Photo'}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[#9e998f] text-[11px] bg-[#f5f2ee]">
            Loading
          </div>
        )}
        {!locked && (
          <button
            onClick={() => onDelete(photo.id)}
            className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
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

// — ReportPhotos ————————————————————————————————————————————————
export function ReportPhotos({ reportId, jobId, tenantId, locked }: ReportPhotosProps) {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [photos, setPhotos] = useState<(Photo & { thumbnailUrl: string | null })[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)

  const loadPhotos = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('photos')
      .select('*')
      .eq('report_id', reportId)
      .eq('tenant_id', tenantId)
      .order('sequence_number', { ascending: true })
    
    const photoData = (data ?? []) as Photo[]
    
    // Generate thumbnail signed URLs using Supabase image transformations
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

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    setUploading(true)
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const fileExt = file.name.split('.').pop()
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`
        const filePath = `${tenantId}/${jobId}/${reportId}/${fileName}`

        // Upload to Supabase Storage
        const { error: uploadError } = await supabase.storage
          .from('photos')
          .upload(filePath, file)

        if (uploadError) {
          console.error('Upload error:', uploadError)
          continue
        }

        // Create photo record
        const { error: dbError } = await supabase
          .from('photos')
          .insert({
            tenant_id: tenantId,
            job_id: jobId,
            report_id: reportId,
            storage_path: filePath,
            file_name: file.name,
            sequence_number: photos.length + i + 1,
          })

        if (dbError) {
          console.error('Database error:', dbError)
        }
      }

      // Reload photos after upload
      await loadPhotos()
    } catch (error) {
      console.error('Upload error:', error)
      alert('Failed to upload photos')
    } finally {
      setUploading(false)
      // Reset file input
      e.target.value = ''
    }
  }

  const handleLabelChange = async (id: string, label: string) => {
    const { error } = await supabase
      .from('photos')
      .update({ label })
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (error) {
      console.error('Update error:', error)
      return
    }

    setPhotos(prev => prev.map(p => p.id === id ? { ...p, label } : p))
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this photo?')) return

    const photo = photos.find(p => p.id === id)
    if (!photo) return

    // Delete from storage
    const { error: storageError } = await supabase.storage
      .from('photos')
      .remove([photo.storage_path])

    if (storageError) {
      console.error('Storage delete error:', storageError)
    }

    // Delete from database
    const { error: dbError } = await supabase
      .from('photos')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (dbError) {
      console.error('Database delete error:', dbError)
      return
    }

    // Reload photos
    await loadPhotos()
  }

  if (loading) {
    return (
      <div className="py-8 text-center text-[13px] text-[#9e998f]">
        Loading photos…
      </div>
    )
  }

  return (
    <div style={{ fontFamily: 'DM Sans, sans-serif' }}>
      {/* Upload button */}
      {!locked && (
        <div className="flex justify-end mb-4">
          <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#e0dbd4] text-[13px] text-[#9e998f] hover:bg-[#f5f2ee] cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            <Upload className="h-4 w-4" />
            {uploading ? 'Uploading...' : 'Upload photos'}
            <input
              type="file"
              multiple
              accept="image/*"
              onChange={handleUpload}
              disabled={uploading}
              className="sr-only"
            />
          </label>
        </div>
      )}

      {photos.length === 0 ? (
        <div className="py-12 text-center text-[13px] text-[#9e998f] border-2 border-dashed border-[#e0dbd4] rounded-lg">
          No photos added yet
        </div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {photos.map(photo => (
            <PhotoCard
              key={photo.id}
              photo={photo}
              thumbnailUrl={photo.thumbnailUrl}
              onLabelChange={handleLabelChange}
              onDelete={handleDelete}
              locked={locked}
            />
          ))}
        </div>
      )}
    </div>
  )
}
