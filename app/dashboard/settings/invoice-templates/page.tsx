'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/supabase/database.types'

const supabase = createBrowserClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

interface InvoiceTemplate {
  id: string
  tenant_id: string
  template_code: string
  template_name: string
  description: string
  notes: string | null
  is_active: boolean
  created_at: string
}

const TEMPLATE_CODE_DISPLAY: Record<string, string> = {
  bar: 'BAR',
  single_storey_roof: 'Single Storey Roof',
  double_storey_roof: 'Double Storey Roof',
  leak_detection: 'Leak Detection',
  make_safe: 'Make Safe',
}

export default function InvoiceTemplatesSettingsPage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [templates, setTemplates] = useState<InvoiceTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Edit state
  const [editStates, setEditStates] = useState<Record<string, { 
    description: string; 
    notes: string; 
    saving: boolean; 
    saved: boolean; 
    saveError: string | null 
  }>>({})

  // Effect 1: get session
  useEffect(() => {
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push('/login')
        return
      }
      setUserId(session.user.id)
    }
    getSession()
  }, [router])

  // Effect 2: fetch data once userId is set
  useEffect(() => {
    if (!userId) return
    fetchTemplates()
  }, [userId])

  const fetchTemplates = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from('users')
        .select('tenant_id')
        .eq('id', user.id)
        .single()

      if (!profile) return
      setTenantId(profile.tenant_id)

      const { data: templatesData, error } = await (supabase as any)
        .from('invoice_templates')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .order('template_code')

      if (error) throw error
      setTemplates(templatesData || [])

      // Initialize edit states
      const initialEditStates: Record<string, { 
        description: string; 
        notes: string; 
        saving: boolean; 
        saved: boolean; 
        saveError: string | null 
      }> = {}
      templatesData?.forEach((template: InvoiceTemplate) => {
        initialEditStates[template.id] = {
          description: template.description,
          notes: template.notes || '',
          saving: false,
          saved: false,
          saveError: null,
        }
      })
      setEditStates(initialEditStates)
    } catch (err) {
      console.error('Error fetching templates:', err)
      setError('Failed to load invoice templates. Please refresh.')
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (templateId: string, field: 'description' | 'notes', value: string) => {
    setEditStates(prev => ({
      ...prev,
      [templateId]: { ...prev[templateId], [field]: value, saved: false, saveError: null },
    }))
  }

  const handleSave = async (templateId: string) => {
    const template = templates.find(t => t.id === templateId)
    const editState = editStates[templateId]
    if (!template || !editState) return

    setEditStates(prev => ({
      ...prev,
      [templateId]: { ...prev[templateId], saving: true, saveError: null },
    }))

    try {
      const { error } = await (supabase as any)
        .from('invoice_templates')
        .update({
          description: editState.description,
          notes: editState.notes || null,
        })
        .eq('id', templateId)
        .eq('tenant_id', tenantId!)

      if (error) throw error

      // Update templates array
      setTemplates(prev => prev.map(t => 
        t.id === templateId 
          ? { ...t, description: editState.description, notes: editState.notes || null }
          : t
      ))
      
      // Update edit state
      setEditStates(prev => ({
        ...prev,
        [templateId]: { 
          description: editState.description, 
          notes: editState.notes, 
          saving: false, 
          saved: true, 
          saveError: null 
        },
      }))

      // Clear saved confirmation after 2 seconds
      setTimeout(() => {
        setEditStates(prev => ({
          ...prev,
          [templateId]: { ...prev[templateId], saved: false },
        }))
      }, 2000)
    } catch (err) {
      setEditStates(prev => ({
        ...prev,
        [templateId]: { 
          ...prev[templateId], 
          saving: false, 
          saveError: 'Save failed — please try again.' 
        },
      }))
    }
  }

  const isDirty = (templateId: string): boolean => {
    const template = templates.find(t => t.id === templateId)
    const editState = editStates[templateId]
    if (!template || !editState) return false
    return editState.description !== template.description || 
           editState.notes !== (template.notes || '')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f5f2ee] p-8">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <div className="h-8 bg-[#e8e4e0] rounded w-48 mb-2"></div>
            <div className="h-4 bg-[#e8e4e0] rounded w-96"></div>
          </div>
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="bg-white border border-[#e8e4e0] rounded-lg p-5 mb-4">
              <div className="h-5 bg-[#e8e4e0] rounded w-64 mb-2"></div>
              <div className="h-32 bg-[#fafaf9] border border-[#e8e4e0] rounded"></div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#f5f2ee] p-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-[#9e998f]">{error}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f5f2ee] p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-[#1a1a1a]">Invoice Templates</h1>
          <p className="text-sm text-[#9e998f] mt-1">
            Manage standardized invoice descriptions for common report types. Use placeholders like {'{property_address}'} and {'{claim_number}'} in descriptions — they'll be replaced when creating invoices.
          </p>
        </div>

        <div className="space-y-4">
          {templates.map(template => {
            const editState = editStates[template.id] || { 
              description: template.description, 
              notes: template.notes || '', 
              saving: false, 
              saved: false, 
              saveError: null 
            }
            const dirty = isDirty(template.id)

            return (
              <div key={template.id} className="bg-white border border-[#e8e4e0] rounded-lg p-5">
                {/* Header row */}
                <div className="flex items-center gap-3 mb-4">
                  <span className="font-semibold text-[#1a1a1a]">{template.template_name}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-[#f5f2ee] text-[#9e998f]">
                    {TEMPLATE_CODE_DISPLAY[template.template_code] || template.template_code}
                  </span>
                  <span className="text-xs text-[#9e998f] ml-auto">
                    Code: <span className="font-mono">{template.template_code}</span>
                  </span>
                </div>

                {/* Description field */}
                <div className="mb-4">
                  <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-2">
                    Invoice Description
                  </label>
                  <textarea
                    value={editState.description}
                    onChange={(e) => handleChange(template.id, 'description', e.target.value)}
                    className="w-full min-h-[80px] p-3 border border-[#e8e4e0] rounded-md bg-[#fafaf9] text-sm text-[#1a1a1a] focus:outline-none focus:border-[#c9a96e] resize-none"
                    placeholder="Enter invoice line item description..."
                  />
                  <p className="text-xs text-[#9e998f] mt-1">
                    Available placeholders: {'{property_address}'}, {'{claim_number}'}, {'{job_number}'}, {'{insured_name}'}
                  </p>
                </div>

                {/* Notes field */}
                <div className="mb-4">
                  <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-2">
                    Default Notes (optional)
                  </label>
                  <textarea
                    value={editState.notes}
                    onChange={(e) => handleChange(template.id, 'notes', e.target.value)}
                    className="w-full min-h-[60px] p-3 border border-[#e8e4e0] rounded-md bg-[#fafaf9] text-sm text-[#1a1a1a] focus:outline-none focus:border-[#c9a96e] resize-none"
                    placeholder="Optional default notes for this invoice type..."
                  />
                </div>

                {/* Action row */}
                <div className="flex items-center justify-end gap-3">
                  {editState.saveError && (
                    <span className="text-xs text-red-600">{editState.saveError}</span>
                  )}
                  {editState.saved && (
                    <span className="text-xs text-green-600 flex items-center gap-1">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Saved
                    </span>
                  )}
                  <button
                    onClick={() => handleSave(template.id)}
                    disabled={!dirty || editState.saving}
                    className="px-4 py-1.5 text-xs bg-[#c9a96e] text-white rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#b8985e] transition-colors"
                  >
                    {editState.saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {templates.length === 0 && (
          <div className="bg-white border border-[#e8e4e0] rounded-lg p-8 text-center">
            <p className="text-sm text-[#9e998f]">
              No invoice templates found. Run the seed migration to create default templates.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
