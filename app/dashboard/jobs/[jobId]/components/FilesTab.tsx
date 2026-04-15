'use client'

import React, { useEffect, useState } from 'react'
import { Upload, File, Trash2, Download } from 'lucide-react'
import { createBrowserClient } from '@supabase/ssr'

interface FileRecord {
  id: string
  description: string | null
  file_name: string
  file_kind: string
  storage_path: string
  mime_type: string
  size_bytes: number
  added_by: string
  created_at: string
}

interface FilesTabProps {
  jobId: string
}

export function FilesTab({ jobId }: FilesTabProps) {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [files, setFiles] = useState<FileRecord[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadDescription, setUploadDescription] = useState('')
  const [showUploadForm, setShowUploadForm] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [previewFile, setPreviewFile] = useState<FileRecord | null>(null)

  useEffect(() => {
    loadFiles()
  }, [jobId])

  async function loadFiles() {
    const { data } = await supabase
      .from('job_files')
      .select(`
        id,
        description,
        file_name,
        file_kind,
        storage_path,
        mime_type,
        size_bytes,
        added_by,
        is_system_generated,
        created_at,
        users!job_files_added_by_fkey (
          name
        )
      `)
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })

    if (data) {
      const transformed = data.map(file => ({
        id: file.id,
        description: file.description,
        file_name: file.file_name,
        file_kind: file.file_kind,
        storage_path: file.storage_path,
        mime_type: file.mime_type,
        size_bytes: file.size_bytes,
        added_by: file.is_system_generated ? 'System' : (file.users as any)?.name || 'Unknown',
        created_at: file.created_at,
      }))
      setFiles(transformed)
    }
  }

  async function handleFileUpload(file: File) {
    if (!file) return

    setUploading(true)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('jobId', jobId)
    if (uploadDescription.trim()) {
      formData.append('description', uploadDescription.trim())
    }

    try {
      const response = await fetch('/api/job-files', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const error = await response.json()
        alert(error.error || 'Failed to upload file')
        return
      }

      setUploadDescription('')
      setShowUploadForm(false)
      loadFiles()
    } catch (error) {
      console.error('Upload error:', error)
      alert('Failed to upload file')
    } finally {
      setUploading(false)
    }
  }

  function handleFileUploadChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFileUpload(file)
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)

    const file = e.dataTransfer.files?.[0]
    if (file) {
      handleFileUpload(file)
    }
  }

  async function handleDelete(fileId: string) {
    if (!confirm('Are you sure you want to delete this file?')) return

    try {
      const response = await fetch(`/api/job-files?fileId=${fileId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        alert('Failed to delete file')
        return
      }

      loadFiles()
    } catch (error) {
      console.error('Delete error:', error)
      alert('Failed to delete file')
    }
  }

  async function handleDownload(file: FileRecord) {
    try {
      const { data, error } = await supabase.storage
        .from('job-files')
        .download(file.storage_path)

      if (error) {
        console.error('Download error:', error)
        alert('Failed to download file')
        return
      }

      const url = URL.createObjectURL(data)
      const a = document.createElement('a')
      a.href = url
      a.download = file.file_name
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Download error:', error)
      alert('Failed to download file')
    }
  }

  async function handleViewFile(file: FileRecord) {
    try {
      const { data, error } = await supabase.storage
        .from('job-files')
        .createSignedUrl(file.storage_path, 60)

      if (error) {
        console.error('Error creating signed URL:', error)
        alert('Failed to open file')
        return
      }

      window.open(data.signedUrl, '_blank')
    } catch (error) {
      console.error('Error opening file:', error)
      alert('Failed to open file')
    }
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  function formatDate(dateString: string): string {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-AU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }) + ' ' + date.toLocaleTimeString('en-AU', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  }

  return (
    <div style={{ fontFamily: 'DM Sans, sans-serif' }}>
      {/* Upload section */}
      <div className="mb-6">
        {!showUploadForm ? (
          <button
            onClick={() => setShowUploadForm(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#e0dbd4] text-[13px] text-[#9e998f] hover:bg-[#f5f2ee] transition-colors"
          >
            <Upload className="h-4 w-4" />
            Upload file
          </button>
        ) : (
          <div
            className="bg-white border border-[#e0dbd4] rounded-lg p-4"
            style={{ maxWidth: '500px' }}
          >
            <div className="mb-3">
              <label className="block text-[12px] text-[#9e998f] mb-1">Description (optional)</label>
              <input
                type="text"
                value={uploadDescription}
                onChange={(e) => setUploadDescription(e.target.value)}
                placeholder="e.g., Roof report, Customer complaint"
                className="w-full px-3 py-2 text-[13px] border border-[#e0dbd4] rounded-md focus:outline-none focus:border-[#c8b89a]"
                disabled={uploading}
              />
            </div>
            <div
              className={`mb-3 border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                isDragging
                  ? 'border-[#c8b89a] bg-[#faf9f7]'
                  : 'border-[#e0dbd4] hover:border-[#c8b89a]'
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <Upload className="h-8 w-8 mx-auto mb-2 text-[#9e998f]" />
              <p className="text-[13px] text-[#9e998f] mb-2">
                Drag and drop a file here, or click to browse
              </p>
              <input
                type="file"
                onChange={handleFileUploadChange}
                className="w-full text-[13px]"
                disabled={uploading}
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowUploadForm(false)
                  setUploadDescription('')
                }}
                className="px-3 py-1.5 text-[12px] text-[#9e998f] hover:text-[#7a6a58] transition-colors"
                disabled={uploading}
              >
                Cancel
              </button>
            </div>
            {uploading && (
              <p className="text-[12px] text-[#c8b89a] mt-2">Uploading...</p>
            )}
          </div>
        )}
      </div>

      {/* Files table */}
      {files.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center py-16 gap-4 bg-white border border-[#e0dbd4] rounded-lg"
          style={{ fontFamily: 'DM Sans, sans-serif' }}
        >
          <File className="h-12 w-12 text-[#e0dbd4]" />
          <p className="text-[13px] text-[#9e998f]">No files attached.</p>
        </div>
      ) : (
        <div className="bg-white border border-[#e0dbd4] rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr
                className="border-b border-[#e0dbd4]"
                style={{ background: '#faf9f7' }}
              >
                <th className="text-left px-4 py-3 text-[11px] uppercase tracking-wider text-[#9e998f] font-medium">
                  Description
                </th>
                <th className="text-left px-4 py-3 text-[11px] uppercase tracking-wider text-[#9e998f] font-medium">
                  File Name
                </th>
                <th className="text-left px-4 py-3 text-[11px] uppercase tracking-wider text-[#9e998f] font-medium">
                  Kind
                </th>
                <th className="text-left px-4 py-3 text-[11px] uppercase tracking-wider text-[#9e998f] font-medium">
                  Added by
                </th>
                <th className="text-left px-4 py-3 text-[11px] uppercase tracking-wider text-[#9e998f] font-medium">
                  Date Added
                </th>
                <th className="px-4 py-3 text-[11px] uppercase tracking-wider text-[#9e998f] font-medium w-24">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.id} className="border-b border-[#f0ece6] hover:bg-[#faf9f7] transition-colors">
                  <td className="px-4 py-3 text-[13px] text-[#3a3530]">
                    {file.description || '—'}
                  </td>
                  <td className="px-4 py-3 text-[13px]">
                    <button
                      onClick={() => handleViewFile(file)}
                      className="text-blue-600 underline hover:text-blue-800 hover:no-underline transition-all"
                      title="Click to view file"
                    >
                      {file.file_name}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-[13px] text-[#9e998f]">
                    {file.file_kind}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-[#3a3530]">
                    {file.added_by}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-[#9e998f]">
                    {formatDate(file.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleDownload(file)}
                        className="p-1.5 text-[#9e998f] hover:text-[#7a6a58] hover:bg-[#f0ece6] rounded transition-colors"
                        title="Download"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(file.id)}
                        className="p-1.5 text-[#9e998f] hover:text-[#a0524a] hover:bg-[#f0ece6] rounded transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
