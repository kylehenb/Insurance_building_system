'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/supabase/database.types'

const supabase = createBrowserClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

interface Prompt {
  id: string
  tenant_id: string
  key: string
  name: string
  category: string
  report_type: string | null
  system_prompt: string
  previous_prompt: string | null
  notes: string | null
  updated_by: string | null
  updated_at: string
  created_at: string
}

const CATEGORY_DISPLAY_NAMES: Record<string, string> = {
  report: 'Report Generation',
  scope: 'Scope Parsing',
  photo: 'Photo Labelling',
  comms_trade: 'Trade Communications (Gary)',
  comms_client: 'Client Communications',
  action_queue: 'Action Queue',
  portal: 'Portal',
  scheduling: 'Scheduling & SMS',
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (seconds < 60) return 'Just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days > 1 ? 's' : ''} ago`
}

export default function PromptsSettingsPage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Per-prompt edit state
  const [editStates, setEditStates] = useState<Record<string, { value: string; saving: boolean; saved: boolean; saveError: string | null }>>({})
  const [revertModal, setRevertModal] = useState<{ promptId: string | null; promptName: string }>({ promptId: null, promptName: '' })

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
    fetchPrompts()
  }, [userId])

  const fetchPrompts = async () => {
    try {
      const response = await fetch('/api/settings/prompts')
      if (!response.ok) throw new Error('Failed to load prompts')
      
      const data = await response.json()
      setPrompts(data.prompts)
      
      // Initialize edit states
      const initialEditStates: Record<string, { value: string; saving: boolean; saved: boolean; saveError: string | null }> = {}
      data.prompts.forEach((prompt: Prompt) => {
        initialEditStates[prompt.id] = {
          value: prompt.system_prompt,
          saving: false,
          saved: false,
          saveError: null,
        }
      })
      setEditStates(initialEditStates)
    } catch (err) {
      setError('Failed to load prompts. Please refresh.')
    } finally {
      setLoading(false)
    }
  }

  const handlePromptChange = (promptId: string, value: string) => {
    setEditStates(prev => ({
      ...prev,
      [promptId]: { ...prev[promptId], value, saved: false, saveError: null },
    }))
  }

  const handleSave = async (promptId: string) => {
    const prompt = prompts.find(p => p.id === promptId)
    const editState = editStates[promptId]
    if (!prompt || !editState) return

    setEditStates(prev => ({
      ...prev,
      [promptId]: { ...prev[promptId], saving: true, saveError: null },
    }))

    try {
      const response = await fetch('/api/settings/prompts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: promptId,
          system_prompt: editState.value,
          notes: prompt.notes,
        }),
      })

      if (!response.ok) throw new Error('Save failed')

      const data = await response.json()
      
      // Update prompts array with returned prompt
      setPrompts(prev => prev.map(p => p.id === promptId ? data.prompt : p))
      
      // Update edit state
      setEditStates(prev => ({
        ...prev,
        [promptId]: { value: data.prompt.system_prompt, saving: false, saved: true, saveError: null },
      }))

      // Clear saved confirmation after 2 seconds
      setTimeout(() => {
        setEditStates(prev => ({
          ...prev,
          [promptId]: { ...prev[promptId], saved: false },
        }))
      }, 2000)
    } catch (err) {
      setEditStates(prev => ({
        ...prev,
        [promptId]: { ...prev[promptId], saving: false, saveError: 'Save failed — please try again.' },
      }))
    }
  }

  const handleRevert = async (promptId: string) => {
    try {
      const response = await fetch('/api/settings/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: promptId,
          action: 'revert',
        }),
      })

      if (!response.ok) throw new Error('Revert failed')

      const data = await response.json()
      
      // Update prompts array
      setPrompts(prev => prev.map(p => p.id === promptId ? data.prompt : p))
      
      // Update edit state
      setEditStates(prev => ({
        ...prev,
        [promptId]: { value: data.prompt.system_prompt, saving: false, saved: true, saveError: null },
      }))

      setRevertModal({ promptId: null, promptName: '' })

      // Clear saved confirmation after 2 seconds
      setTimeout(() => {
        setEditStates(prev => ({
          ...prev,
          [promptId]: { ...prev[promptId], saved: false },
        }))
      }, 2000)
    } catch (err) {
      setEditStates(prev => ({
        ...prev,
        [promptId]: { ...prev[promptId], saving: false, saveError: 'Revert failed — please try again.' },
      }))
    }
  }

  const isDirty = (promptId: string): boolean => {
    const prompt = prompts.find(p => p.id === promptId)
    const editState = editStates[promptId]
    return !!(prompt && editState && editState.value !== prompt.system_prompt)
  }

  // Group prompts by category
  const groupedPrompts = prompts.reduce((acc, prompt) => {
    if (!acc[prompt.category]) {
      acc[prompt.category] = []
    }
    acc[prompt.category].push(prompt)
    return acc
  }, {} as Record<string, Prompt[]>)

  // Sort categories
  const sortedCategories = Object.keys(groupedPrompts).sort()

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f5f2ee] p-8">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <div className="h-8 bg-[#e8e4e0] rounded w-48 mb-2"></div>
            <div className="h-4 bg-[#e8e4e0] rounded w-96"></div>
          </div>
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white border border-[#e8e4e0] rounded-lg p-5 mb-4">
              <div className="h-5 bg-[#e8e4e0] rounded w-64 mb-2"></div>
              <div className="h-4 bg-[#e8e4e0] rounded w-48 mb-4"></div>
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
          <h1 className="text-2xl font-semibold text-[#1a1a1a]">AI Prompt Library</h1>
          <p className="text-sm text-[#9e998f] mt-1">
            Edit the system prompts used across all AI features. Changes take effect immediately — no code deploy required.
          </p>
        </div>

        {sortedCategories.map(category => (
          <div key={category} className="mb-6">
            <h2 className="text-xs text-[#9e998f] uppercase tracking-wider mb-3">
              {CATEGORY_DISPLAY_NAMES[category] || category}
            </h2>
            <div className="space-y-4">
              {groupedPrompts[category].map(prompt => {
                const editState = editStates[prompt.id] || { value: prompt.system_prompt, saving: false, saved: false, saveError: null }
                const dirty = isDirty(prompt.id)

                return (
                  <div key={prompt.id} className="bg-white border border-[#e8e4e0] rounded-lg p-5">
                    {/* Header row */}
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <span className="font-semibold text-[#1a1a1a]">{prompt.name}</span>
                      <span className="text-xs text-[#9e998f] font-mono">{prompt.key}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[#f5f2ee] text-[#9e998f]">
                        {CATEGORY_DISPLAY_NAMES[prompt.category] || prompt.category}
                      </span>
                      {prompt.report_type && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[#f5f2ee] text-[#9e998f]">
                          {prompt.report_type}
                        </span>
                      )}
                      <span className="text-xs text-[#9e998f] ml-auto">
                        Updated {formatTimeAgo(prompt.updated_at)}
                      </span>
                    </div>

                    {/* Notes field */}
                    {prompt.notes && (
                      <div className="text-xs text-[#9e998f] italic mb-3">{prompt.notes}</div>
                    )}

                    {/* Prompt editor */}
                    <textarea
                      value={editState.value}
                      onChange={(e) => handlePromptChange(prompt.id, e.target.value)}
                      onInput={(e) => {
                        const target = e.target as HTMLTextAreaElement
                        target.style.height = 'auto'
                        target.style.height = `${target.scrollHeight}px`
                      }}
                      className="w-full min-h-[160px] p-3 border border-[#e8e4e0] rounded-md bg-[#fafaf9] font-mono text-sm text-[#1a1a1a] focus:outline-none focus:border-[#c9a96e] resize-none"
                      style={{ fontFamily: 'DM Mono, monospace' }}
                    />

                    {/* Action row */}
                    <div className="flex items-center justify-end gap-3 mt-3">
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
                      {prompt.previous_prompt && (
                        <button
                          onClick={() => setRevertModal({ promptId: prompt.id, promptName: prompt.name })}
                          className="px-3 py-1.5 text-xs border border-[#e8e4e0] rounded text-[#9e998f] hover:bg-[#f5f2ee] transition-colors"
                        >
                          Revert to previous
                        </button>
                      )}
                      <button
                        onClick={() => handleSave(prompt.id)}
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
          </div>
        ))}
      </div>

      {/* Revert confirmation modal */}
      {revertModal.promptId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-lg">
            <h3 className="text-lg font-semibold text-[#1a1a1a] mb-2">Revert prompt?</h3>
            <p className="text-sm text-[#9e998f] mb-6">
              This will restore the previous version of this prompt. Your current version will become the new 'previous' — you can revert again if needed.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setRevertModal({ promptId: null, promptName: '' })}
                className="px-4 py-2 text-sm border border-[#e8e4e0] rounded text-[#1a1a1a] hover:bg-[#f5f2ee] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRevert(revertModal.promptId!)}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
              >
                Revert
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
