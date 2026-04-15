import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Allowed file types (excluding potentially malicious types)
const ALLOWED_MIME_TYPES = new Set([
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
  // Images
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/tiff',
])

// Maximum file size: 50MB
const MAX_FILE_SIZE = 50 * 1024 * 1024

// GET - Fetch files for a job
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const jobId = searchParams.get('jobId')

    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's tenant_id
    const { data: userData } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single()

    if (!userData) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const tenantId = userData.tenant_id

    // Fetch files with added_by user info
    const { data: files, error } = await supabase
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
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching files:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Transform data to match expected format
    const transformedFiles = files?.map(file => ({
      id: file.id,
      description: file.description,
      file_name: file.file_name,
      file_kind: file.file_kind,
      storage_path: file.storage_path,
      mime_type: file.mime_type,
      size_bytes: file.size_bytes,
      added_by: file.is_system_generated ? 'System' : (file.users as any)?.name || 'Unknown',
      created_at: file.created_at,
    })) || []

    return NextResponse.json({ files: transformedFiles })
  } catch (error) {
    console.error('Error in GET /api/job-files:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Upload a file
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    const jobId = formData.get('jobId') as string
    const description = formData.get('description') as string | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
    }

    // Validate file type
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return NextResponse.json({ 
        error: `File type ${file.type} is not allowed. Allowed types: PDF, Word, Excel, text, and common image formats.` 
      }, { status: 400 })
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ 
        error: `File size exceeds maximum allowed size of 50MB` 
      }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's tenant_id
    const { data: userData } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single()

    if (!userData) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const tenantId = userData.tenant_id

    // Verify job belongs to tenant
    const { data: job } = await supabase
      .from('jobs')
      .select('id')
      .eq('id', jobId)
      .eq('tenant_id', tenantId)
      .single()

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Generate file kind from MIME type
    const fileKind = getFileKind(file.type)

    // Upload to Supabase Storage
    const fileName = `${Date.now()}-${file.name}`
    const storagePath = `tenants/${tenantId}/jobs/${jobId}/docs/${fileName}`

    const { error: uploadError } = await supabase.storage
      .from('job-files')
      .upload(storagePath, file)

    if (uploadError) {
      console.error('Error uploading file:', uploadError)
      return NextResponse.json({ error: uploadError.message }, { status: 500 })
    }

    // Create database record
    const { data: fileRecord, error: dbError } = await supabase
      .from('job_files')
      .insert({
        tenant_id: tenantId,
        job_id: jobId,
        description: description || null,
        file_name: file.name,
        file_kind: fileKind,
        storage_path: storagePath,
        mime_type: file.type,
        size_bytes: file.size,
        added_by: user.id,
        is_system_generated: false,
      })
      .select()
      .single()

    if (dbError) {
      console.error('Error creating file record:', dbError)
      // Clean up storage if DB insert fails
      await supabase.storage.from('job-files').remove([storagePath])
      return NextResponse.json({ error: dbError.message }, { status: 500 })
    }

    return NextResponse.json({ file: fileRecord })
  } catch (error) {
    console.error('Error in POST /api/job-files:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Delete a file
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const fileId = searchParams.get('fileId')

    if (!fileId) {
      return NextResponse.json({ error: 'fileId is required' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's tenant_id
    const { data: userData } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single()

    if (!userData) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const tenantId = userData.tenant_id

    // Get file record
    const { data: file } = await supabase
      .from('job_files')
      .select('storage_path')
      .eq('id', fileId)
      .eq('tenant_id', tenantId)
      .single()

    if (!file) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // Delete from storage
    const { error: storageError } = await supabase.storage
      .from('job-files')
      .remove([file.storage_path])

    if (storageError) {
      console.error('Error deleting file from storage:', storageError)
    }

    // Delete database record
    const { error: dbError } = await supabase
      .from('job_files')
      .delete()
      .eq('id', fileId)
      .eq('tenant_id', tenantId)

    if (dbError) {
      console.error('Error deleting file record:', dbError)
      return NextResponse.json({ error: dbError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in DELETE /api/job-files:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function getFileKind(mimeType: string): string {
  if (mimeType === 'application/pdf') return 'PDF'
  if (mimeType.includes('word')) return 'Word'
  if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return 'Excel'
  if (mimeType === 'text/plain') return 'Text'
  if (mimeType === 'text/csv') return 'CSV'
  if (mimeType.includes('jpeg') || mimeType === 'image/jpg') return 'JPEG'
  if (mimeType.includes('png')) return 'PNG'
  if (mimeType.includes('gif')) return 'GIF'
  if (mimeType.includes('webp')) return 'WebP'
  if (mimeType.includes('bmp')) return 'BMP'
  if (mimeType.includes('tiff')) return 'TIFF'
  return mimeType.split('/')[1]?.toUpperCase() || 'Unknown'
}
