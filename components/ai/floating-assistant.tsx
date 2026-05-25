'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import type {
  StructuredTeachOutput,
  SimilarityMatch,
  BrainEntryCategory,
} from '@/types/brain'

// Web Speech API inline type declarations (no external package required)
interface SpeechRecognitionAlternative {
  readonly transcript: string
  readonly confidence: number
}
interface SpeechRecognitionResult {
  readonly isFinal: boolean
  readonly length: number
  item(index: number): SpeechRecognitionAlternative
  [index: number]: SpeechRecognitionAlternative
}
interface SpeechRecognitionResultList {
  readonly length: number
  item(index: number): SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultList
}
interface SpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
}
declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition
    webkitSpeechRecognition?: new () => SpeechRecognition
  }
}

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const MIN_W = 300
const MIN_H = 300
const DEFAULT_W = 380
const DEFAULT_H = 480

const BLOCKED_EXTENSIONS = new Set(['.exe', '.bat', '.cmd', '.sh', '.ps1', '.msi', '.dll', '.vbs', '.js', '.jar', '.scr', '.com'])

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  fileName?: string
}

interface Template {
  id: string
  title: string
  body: string
}

interface Props {
  visible: boolean
  onClose: () => void
  tenantId: string
}

type ActiveMode = 'chat' | 'doit' | 'teach'
type ProcessStep = 'form' | 'structuring' | 'review' | 'saved'

export function FloatingAssistant({ visible, onClose, tenantId }: Props) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const activeTab = searchParams.get('tab') ?? undefined

  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [size, setSize] = useState({ w: DEFAULT_W, h: DEFAULT_H })
  const [mounted, setMounted] = useState(false)

  // ── Chat state ──
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  // Templates panel state
  const [showTemplates, setShowTemplates] = useState(false)
  const [templates, setTemplates] = useState<Template[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [formTitle, setFormTitle] = useState('')
  const [formBody, setFormBody] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  // Slash-trigger popover state
  const [showSlashPopover, setShowSlashPopover] = useState(false)
  const [slashQuery, setSlashQuery] = useState('')
  const [filteredTemplates, setFilteredTemplates] = useState<Template[]>([])
  const [slashSelectedIdx, setSlashSelectedIdx] = useState(0)

  const [attachedFile, setAttachedFile] = useState<File | null>(null)
  const [attachedPreviewUrl, setAttachedPreviewUrl] = useState<string | null>(null)

  // Action checklist state
  const [actionChecklist, setActionChecklist] = useState<{ id: string; text: string; completed: boolean }[]>([])
  const [thinkingText, setThinkingText] = useState('Thinking')

  // ── Mode selector ──
  const [activeMode, setActiveMode] = useState<ActiveMode>('chat')

  // ── Teach mode state ──
  const [processStep, setProcessStep] = useState<ProcessStep>('form')
  const [dictationText, setDictationText] = useState('')
  const [triggerText, setTriggerText] = useState('')
  const [structuredOutput, setStructuredOutput] = useState<StructuredTeachOutput | null>(null)
  const [editedOutput, setEditedOutput] = useState<StructuredTeachOutput | null>(null)
  const [isEditingReview, setIsEditingReview] = useState(false)
  const [similarityMatches, setSimilarityMatches] = useState<SimilarityMatch[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [savedResult, setSavedResult] = useState<{ brainEntryId: string; playbookId: string | null } | null>(null)
  const [structureError, setStructureError] = useState<string | null>(null)
  const [newTagInput, setNewTagInput] = useState('')

  // Dictation / Web Speech API state
  const [isListening, setIsListening] = useState(false)
  const [interimTranscript, setInterimTranscript] = useState('')
  const [speechSupported, setSpeechSupported] = useState(false)
  const recognitionRef = useRef<SpeechRecognition | null>(null)

  // Permission gate
  const [userCanTeach, setUserCanTeach] = useState<boolean | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const teachTextareaRef = useRef<HTMLTextAreaElement>(null)
  const slashPopoverRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Drag/resize state in refs to avoid stale closures
  const dragState = useRef({ active: false, startX: 0, startY: 0, startPosX: 0, startPosY: 0 })
  const resizeState = useRef({ active: false, startX: 0, startY: 0, startW: 0, startH: 0 })
  const posRef = useRef(pos)
  const sizeRef = useRef(size)
  posRef.current = pos
  sizeRef.current = size

  // Stable ref for the open-teach event handler (avoids stale closures in effect)
  const handleOpenTeachRef = useRef<() => void>(() => {})

  // Initialise from localStorage after mount
  useEffect(() => {
    try {
      const savedPos = localStorage.getItem('fai-pos')
      const savedSize = localStorage.getItem('fai-size')
      if (savedPos) {
        setPos(JSON.parse(savedPos))
      } else {
        setPos({ x: window.innerWidth - DEFAULT_W - 24, y: window.innerHeight - DEFAULT_H - 24 })
      }
      if (savedSize) setSize(JSON.parse(savedSize))
    } catch {
      setPos({ x: window.innerWidth - DEFAULT_W - 24, y: window.innerHeight - DEFAULT_H - 24 })
    }
    setMounted(true)
  }, [])

  // Detect Web Speech API support
  useEffect(() => {
    setSpeechSupported(
      typeof window !== 'undefined' &&
      !!(window.SpeechRecognition || window.webkitSpeechRecognition)
    )
  }, [])

  // Load permission once on mount
  useEffect(() => {
    async function checkPermission() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setUserCanTeach(false); return }
      const { data: profile } = await supabase
        .from('users')
        .select('role, can_edit_settings')
        .eq('id', user.id)
        .single()
      if (!profile) { setUserCanTeach(false); return }
      const p = profile as { role: string; can_edit_settings: boolean | null }
      setUserCanTeach(p.role === 'admin' || p.can_edit_settings === true)
    }
    checkPermission()
  }, [])

  // Persist position
  useEffect(() => {
    if (mounted) {
      try { localStorage.setItem('fai-pos', JSON.stringify(pos)) } catch {}
    }
  }, [pos, mounted])

  // Persist size
  useEffect(() => {
    if (mounted) {
      try { localStorage.setItem('fai-size', JSON.stringify(size)) } catch {}
    }
  }, [size, mounted])

  // Global mouse handlers for drag + resize
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (dragState.current.active) {
        const dx = e.clientX - dragState.current.startX
        const dy = e.clientY - dragState.current.startY
        setPos({
          x: dragState.current.startPosX + dx,
          y: dragState.current.startPosY + dy,
        })
      }
      if (resizeState.current.active) {
        const dw = e.clientX - resizeState.current.startX
        const dh = e.clientY - resizeState.current.startY
        setSize({
          w: Math.max(MIN_W, resizeState.current.startW + dw),
          h: Math.max(MIN_H, resizeState.current.startH + dh),
        })
      }
    }
    function onMouseUp() {
      dragState.current.active = false
      resizeState.current.active = false
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Animated "Thinking...and doing" text
  useEffect(() => {
    if (!loading) {
      setThinkingText('Thinking')
      setActionChecklist([])
      return
    }
    const texts = ['Thinking', 'Thinking..', 'Thinking...', 'Thinking...and doing', 'Thinking...and doing.', 'Thinking...and doing..']
    let index = 0
    const interval = setInterval(() => {
      index = (index + 1) % texts.length
      setThinkingText(texts[index])
    }, 500)
    return () => clearInterval(interval)
  }, [loading])

  // Load templates when panel opens
  useEffect(() => {
    if (showTemplates) loadTemplates()
  }, [showTemplates])

  // Update slash popover filter
  useEffect(() => {
    if (!showSlashPopover) return
    const q = slashQuery.toLowerCase()
    setFilteredTemplates(
      q ? templates.filter((t) => t.title.toLowerCase().includes(q)) : templates
    )
    setSlashSelectedIdx(0)
  }, [slashQuery, templates, showSlashPopover])

  // Reset teach state when leaving teach mode
  useEffect(() => {
    if (activeMode !== 'teach') {
      resetTeachState()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMode])

  // Keep open-teach handler current (avoids stale closures)
  handleOpenTeachRef.current = () => {
    if (!userCanTeach) return
    setActiveMode('teach')
    setProcessStep('form')
    setTimeout(() => teachTextareaRef.current?.focus(), 100)
  }

  // Listen for global fai-open-teach event (fired by dashboard hotkey)
  useEffect(() => {
    function handler() { handleOpenTeachRef.current() }
    window.addEventListener('fai-open-teach', handler)
    return () => window.removeEventListener('fai-open-teach', handler)
  }, [])

  // ── Teach helpers ──
  function stopListening() {
    if (recognitionRef.current) {
      recognitionRef.current.abort()
      recognitionRef.current = null
    }
    setIsListening(false)
    setInterimTranscript('')
  }

  function resetTeachState() {
    stopListening()
    setProcessStep('form')
    setDictationText('')
    setTriggerText('')
    setStructuredOutput(null)
    setEditedOutput(null)
    setIsEditingReview(false)
    setSimilarityMatches([])
    setIsSaving(false)
    setSavedResult(null)
    setStructureError(null)
    setNewTagInput('')
    setInterimTranscript('')
  }

  function toggleListening() {
    if (isListening) {
      stopListening()
      return
    }

    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognitionCtor) return

    const recognition = new SpeechRecognitionCtor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-AU'

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          const finalWord = result[0].transcript
          setDictationText((prev) => prev + (prev ? ' ' : '') + finalWord.trim())
          interim = ''
        } else {
          interim += result[0].transcript
        }
      }
      setInterimTranscript(interim)
    }

    recognition.onerror = () => {
      stopListening()
    }

    recognition.onend = () => {
      setIsListening(false)
      setInterimTranscript('')
      recognitionRef.current = null
    }

    recognitionRef.current = recognition
    recognition.start()
    setIsListening(true)
  }

  async function handleTeachSubmit() {
    if (!dictationText.trim()) return
    stopListening()
    setProcessStep('structuring')
    setStructureError(null)
    try {
      const structureRes = await fetch('/api/brain/teach/structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dictation: dictationText, trigger: triggerText, tenantId }),
      })
      if (!structureRes.ok) throw new Error('Structure failed')
      const structured = await structureRes.json() as StructuredTeachOutput
      setStructuredOutput(structured)

      // Similarity check (non-blocking)
      try {
        const simRes = await fetch('/api/brain/teach/similarity-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: structured.title, trigger_condition: structured.trigger_condition, tags: structured.tags, tenantId }),
        })
        if (simRes.ok) {
          const { matches } = await simRes.json() as { matches: SimilarityMatch[] }
          setSimilarityMatches(matches)
        }
      } catch {
        // non-fatal
      }

      setProcessStep('review')
    } catch {
      setStructureError('Failed to structure your teaching. Please try again.')
      setProcessStep('form')
    }
  }

  async function approveSave(saveMode: 'new' | 'example' | 'variant' = 'new', sourceRefId?: string) {
    const output = isEditingReview ? editedOutput : structuredOutput
    if (!output) return
    setIsSaving(true)
    try {
      const res = await fetch('/api/brain/teach/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ structured: output, tenantId, saveMode, sourceRefId }),
      })
      if (!res.ok) throw new Error('Save failed')
      const result = await res.json() as { brainEntryId: string; playbookId: string | null }
      setSavedResult(result)
      setProcessStep('saved')
    } catch {
      // keep review open on error
    } finally {
      setIsSaving(false)
    }
  }

  function enterEditMode() {
    if (!structuredOutput) return
    setEditedOutput(JSON.parse(JSON.stringify(structuredOutput)) as StructuredTeachOutput)
    setIsEditingReview(true)
  }

  function updateEditedStep(index: number, value: string) {
    if (!editedOutput) return
    const steps = editedOutput.steps.map((s, i) =>
      i === index ? { ...s, description: value } : s
    )
    setEditedOutput({ ...editedOutput, steps })
  }

  function removeEditedTag(tag: string) {
    if (!editedOutput) return
    setEditedOutput({ ...editedOutput, tags: editedOutput.tags.filter((t) => t !== tag) })
  }

  function addEditedTag(tag: string) {
    if (!editedOutput || !tag.trim()) return
    const clean = tag.trim().toLowerCase().replace(/\s+/g, '-')
    if (!editedOutput.tags.includes(clean)) {
      setEditedOutput({ ...editedOutput, tags: [...editedOutput.tags, clean] })
    }
    setNewTagInput('')
  }

  // ── Chat helpers ──
  async function loadTemplates() {
    setTemplatesLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('assistant_templates')
        .select('id, title, body')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      setTemplates((data as Template[]) ?? [])
    } finally {
      setTemplatesLoading(false)
    }
  }

  async function saveTemplate() {
    if (!formTitle.trim() || !formBody.trim()) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    if (editingTemplate) {
      await supabase
        .from('assistant_templates')
        .update({ title: formTitle.trim(), body: formBody.trim(), updated_at: new Date().toISOString() })
        .eq('id', editingTemplate.id)
    } else {
      await supabase
        .from('assistant_templates')
        .insert({ title: formTitle.trim(), body: formBody.trim(), tenant_id: tenantId, user_id: user.id })
    }
    setEditingTemplate(null)
    setIsCreating(false)
    setFormTitle('')
    setFormBody('')
    await loadTemplates()
  }

  async function deleteTemplate(id: string) {
    await supabase.from('assistant_templates').delete().eq('id', id)
    setDeleteConfirmId(null)
    await loadTemplates()
  }

  function startEdit(t: Template) {
    setEditingTemplate(t)
    setIsCreating(false)
    setFormTitle(t.title)
    setFormBody(t.body)
  }

  function startCreate() {
    setIsCreating(true)
    setEditingTemplate(null)
    setFormTitle('')
    setFormBody('')
  }

  function cancelForm() {
    setIsCreating(false)
    setEditingTemplate(null)
    setFormTitle('')
    setFormBody('')
  }

  function openTemplates() { setShowTemplates(true) }
  function closeTemplates() {
    setShowTemplates(false)
    setIsCreating(false)
    setEditingTemplate(null)
    setDeleteConfirmId(null)
  }

  function insertTemplate(t: Template) {
    setInput(t.body)
    setShowSlashPopover(false)
    setSlashQuery('')
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  function handleDragStart(e: React.MouseEvent) {
    const target = e.target as HTMLElement
    if (
      target.tagName === 'BUTTON' || target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' ||
      target.closest('button') || target.closest('input') ||
      target.closest('textarea') || target.closest('select')
    ) return
    const selection = window.getSelection()
    if (selection && selection.toString().length > 0) return
    if (target.closest('.fai-bubble-text')) return
    e.preventDefault()
    dragState.current = {
      active: true, startX: e.clientX, startY: e.clientY,
      startPosX: posRef.current.x, startPosY: posRef.current.y,
    }
  }

  function handleResizeStart(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    resizeState.current = {
      active: true, startX: e.clientX, startY: e.clientY,
      startW: sizeRef.current.w, startH: sizeRef.current.h,
    }
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  function fileToText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsText(file)
    })
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const ext = '.' + (file.name.split('.').pop() ?? '').toLowerCase()
    if (BLOCKED_EXTENSIONS.has(ext)) return
    if (attachedPreviewUrl) URL.revokeObjectURL(attachedPreviewUrl)
    setAttachedFile(file)
    const isImage = /^image\/(jpeg|png|webp|gif)$/.test(file.type)
    setAttachedPreviewUrl(isImage ? URL.createObjectURL(file) : null)
  }

  function removeAttachment() {
    if (attachedPreviewUrl) URL.revokeObjectURL(attachedPreviewUrl)
    setAttachedFile(null)
    setAttachedPreviewUrl(null)
  }

  async function sendMessage() {
    const val = input.trim()
    if (!val || loading) return
    const userMsg: ChatMessage = { role: 'user', content: val, fileName: attachedFile?.name }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    const fileToSend = attachedFile
    const isBinaryFile = fileToSend
      ? /^image\/(jpeg|png|webp|gif)$/.test(fileToSend.type) || fileToSend.type === 'application/pdf'
      : false
    let textFileContent: string | null = null
    if (fileToSend && !isBinaryFile) textFileContent = await fileToText(fileToSend)
    removeAttachment()
    setLoading(true)
    try {
      let res: Response
      if (fileToSend && isBinaryFile) {
        const fd = new FormData()
        fd.append('messages', JSON.stringify(newMessages.map((m) => ({ role: m.role, content: m.content }))))
        fd.append('pageContext', pathname || '')
        if (activeTab) fd.append('activeTab', activeTab)
        fd.append('tenantId', tenantId)
        fd.append('file', fileToSend)
        fd.append('fileType', fileToSend.type === 'application/pdf' ? 'document' : 'image')
        res = await fetch('/api/ai/assistant', { method: 'POST', body: fd })
      } else {
        const fileAttachment = fileToSend && textFileContent !== null
          ? { type: 'text', name: fileToSend.name, data: textFileContent }
          : null
        res = await fetch('/api/ai/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
            pageContext: pathname, activeTab, tenantId,
            ...(fileAttachment ? { fileAttachment } : {}),
          }),
        })
      }
      const data = await res.json()
      let text: string = data.text ?? 'Sorry, I encountered an error.'
      text = text.replace(/\n?\n?\s*\{"name":\s*"[^"]+",\s*"parameters":\s*\{[^}]*\}\}\s*\n?/g, '')
      text = text.replace(/\n?\n?\s*\[\]\s*\n?/g, '')
      text = text.replace(/\n?\n?\s*Let me read[^\n]*\n?/g, '')
      text = text.replace(/\n?\n?\s*Let me check[^\n]*\n?/g, '')
      text = text.replace(/\n?\n?\s*Let me get[^\n]*\n?/g, '')
      text = text.trim()
      setMessages((prev) => [...prev, { role: 'assistant', content: text }])
      window.dispatchEvent(new CustomEvent('ai-action-complete', { detail: { success: true } }))
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Something went wrong. Please try again.' }])
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (showSlashPopover) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashSelectedIdx((i) => Math.min(i + 1, filteredTemplates.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashSelectedIdx((i) => Math.max(i - 1, 0)); return }
      if (e.key === 'Enter') { e.preventDefault(); if (filteredTemplates[slashSelectedIdx]) insertTemplate(filteredTemplates[slashSelectedIdx]); return }
      if (e.key === 'Escape') { setShowSlashPopover(false); setSlashQuery(''); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  function handleTextareaInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    setInput(val)
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
    const slashIdx = val.lastIndexOf('/')
    if (slashIdx !== -1 && (slashIdx === 0 || val[slashIdx - 1] === ' ' || val[slashIdx - 1] === '\n')) {
      const afterSlash = val.slice(slashIdx + 1)
      if (!afterSlash.includes(' ') && !afterSlash.includes('\n')) {
        setSlashQuery(afterSlash)
        setShowSlashPopover(true)
        return
      }
    }
    setShowSlashPopover(false)
    setSlashQuery('')
  }

  // Suppress unused warning
  void fileToBase64

  if (!mounted || !visible) return null

  const isFormOpen = isCreating || editingTemplate !== null
  const displayOutput = isEditingReview ? editedOutput : structuredOutput
  const visibleModes: ActiveMode[] = userCanTeach ? ['chat', 'doit', 'teach'] : ['chat', 'doit']

  return (
    <>
      <style>{`
        .fai-widget {
          position: fixed; z-index: 1000; display: flex; flex-direction: column;
          background: #fff; border: 0.5px solid #e4dfd8; border-radius: 10px;
          box-shadow: 0 8px 40px rgba(0,0,0,0.13), 0 2px 8px rgba(0,0,0,0.07);
          overflow: hidden; font-family: 'DM Sans', -apple-system, sans-serif;
        }
        .fai-header {
          display: flex; align-items: center; gap: 8px;
          padding: 11px 14px 10px; border-bottom: 0.5px solid #f0ece6;
          background: #fdfdfc; cursor: grab; user-select: none; flex-shrink: 0;
        }
        .fai-header:active { cursor: grabbing; }
        .fai-drag-dots { display: flex; flex-direction: column; gap: 3px; opacity: 0.35; margin-right: 2px; flex-shrink: 0; }
        .fai-drag-row { display: flex; gap: 3px; }
        .fai-drag-dot { width: 2.5px; height: 2.5px; border-radius: 50%; background: #9a9088; }
        .fai-pip { width: 6px; height: 6px; border-radius: 50%; background: #c8b89a; flex-shrink: 0; }
        .fai-label { font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: #c8b89a; font-weight: 700; flex: 1; }
        .fai-header-btn {
          background: none; border: none; cursor: pointer; color: #c8b89a;
          padding: 3px 4px; line-height: 1; font-size: 16px; border-radius: 4px;
          transition: color 0.15s, background 0.15s; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
        }
        .fai-header-btn:hover { color: #7a6a58; background: #f5f0e8; }
        .fai-header-btn.active { color: #9a7a50; background: #f5f0e8; }
        .fai-close-btn {
          background: none; border: none; cursor: pointer; color: #c8b89a;
          padding: 3px 4px; line-height: 1; font-size: 16px; border-radius: 4px;
          transition: color 0.15s, background 0.15s; flex-shrink: 0;
        }
        .fai-close-btn:hover { color: #7a6a58; background: #f5f0e8; }

        /* Mode selector */
        .fai-mode-selector {
          display: flex; border-bottom: 0.5px solid #f0ece6;
          background: #fdfdfc; flex-shrink: 0;
        }
        .fai-mode-btn {
          flex: 1; padding: 7px 0; border: none; background: transparent;
          font-family: inherit; font-size: 10.5px; font-weight: 600;
          letter-spacing: 0.4px; cursor: pointer; transition: all 0.15s; color: #b8b0a8;
        }
        .fai-mode-btn.active { background: #1a1a1a; color: #f5f0e8; }
        .fai-mode-btn:not(.active):hover { color: #7a6a58; background: #f5f0e8; }

        .fai-messages {
          flex: 1; overflow-y: auto; display: flex; flex-direction: column;
          gap: 14px; padding: 16px 18px; background: #fff; min-height: 0;
        }
        .fai-messages::-webkit-scrollbar { width: 3px; }
        .fai-messages::-webkit-scrollbar-thumb { background: #e8e3dc; border-radius: 2px; }

        .fai-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; gap: 8px; padding: 24px 0; }
        .fai-empty-icon { font-size: 24px; opacity: 0.2; }
        .fai-empty-text { font-size: 13px; color: #9a9088; font-weight: 400; text-align: center; }
        .fai-empty-sub { font-size: 11px; color: #c0b8b0; font-weight: 300; text-align: center; line-height: 1.5; }

        .fai-bubble { display: flex; gap: 8px; align-items: flex-start; max-width: 86%; }
        .fai-bubble.user { align-self: flex-end; flex-direction: row-reverse; }
        .fai-bubble.assistant { align-self: flex-start; }

        .fai-avatar {
          width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          font-size: 9px; font-weight: 700; margin-top: 2px;
        }
        .fai-avatar.user { background: #2e2820; color: #c8b89a; border: 0.5px solid rgba(200,184,154,0.2); }
        .fai-avatar.assistant { background: #f5f0e8; color: #9a7a50; border: 0.5px solid #e8ddd0; font-size: 12px; }

        .fai-bubble-inner { display: flex; flex-direction: column; max-width: 100%; gap: 8px; }
        .fai-bubble-text {
          padding: 9px 13px; border-radius: 10px; font-size: 13px; line-height: 1.65;
          font-weight: 400; white-space: pre-wrap; word-break: break-word;
        }
        .fai-bubble.user .fai-bubble-text { background: #1a1a1a; color: #e8e0d5; border-radius: 10px 10px 3px 10px; }
        .fai-bubble.assistant .fai-bubble-text { background: #f7f5f2; color: #2a2520; border-radius: 10px 10px 10px 3px; border: 0.5px solid #e8e3dc; }

        .fai-input-wrap {
          padding: 12px 14px 14px; border-top: 0.5px solid #f0ece6;
          background: #fdfdfc; flex-shrink: 0; position: relative;
        }
        .fai-input-row {
          display: flex; align-items: flex-end; gap: 0;
          background: #f7f5f2; border-radius: 10px;
          border: 0.5px solid #e4dfd8; transition: border-color 0.2s; overflow: hidden;
        }
        .fai-input-row:focus-within { border-color: #c8b89a; }
        .fai-textarea {
          flex: 1; background: transparent; border: none;
          padding: 10px 13px; color: #1a1a1a; font-size: 13px;
          font-family: inherit; font-weight: 400; outline: none;
          resize: none; line-height: 1.55; min-height: 42px; max-height: 120px;
        }
        .fai-textarea::placeholder { color: #b8b0a8; }
        .fai-send-btn {
          background: #1a1a1a; border: none; margin: 7px 8px 7px 0;
          width: 32px; height: 32px; border-radius: 8px; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; transition: background 0.15s; align-self: flex-end;
        }
        .fai-send-btn:hover { background: #2a2a2a; }
        .fai-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .fai-hint { font-size: 10px; color: #c8c0b8; text-align: right; margin-top: 5px; font-weight: 300; }

        .fai-resize-handle {
          position: absolute; bottom: 0; right: 0;
          width: 16px; height: 16px; cursor: nwse-resize;
          display: flex; align-items: flex-end; justify-content: flex-end; padding: 3px;
        }
        .fai-resize-icon { opacity: 0.3; }
        .fai-resize-handle:hover .fai-resize-icon { opacity: 0.6; }

        /* Templates panel */
        .fai-templates-panel { flex: 1; display: flex; flex-direction: column; min-height: 0; background: #fff; }
        .fai-templates-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 12px 16px 10px; border-bottom: 0.5px solid #f0ece6; flex-shrink: 0;
        }
        .fai-templates-title { font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: #9a9088; font-weight: 700; }
        .fai-new-btn {
          font-size: 11px; padding: 4px 12px; border-radius: 20px; cursor: pointer;
          font-family: inherit; font-weight: 600; border: 1px solid #c8b89a;
          background: transparent; color: #7a6a58; transition: all 0.15s;
        }
        .fai-new-btn:hover { background: #f5f0e8; }
        .fai-templates-list { flex: 1; overflow-y: auto; padding: 8px 0; min-height: 0; }
        .fai-templates-list::-webkit-scrollbar { width: 3px; }
        .fai-templates-list::-webkit-scrollbar-thumb { background: #e8e3dc; border-radius: 2px; }
        .fai-template-item {
          display: flex; align-items: flex-start; gap: 8px;
          padding: 10px 16px; border-bottom: 0.5px solid #f5f2ee;
          cursor: pointer; transition: background 0.12s;
        }
        .fai-template-item:hover { background: #faf8f5; }
        .fai-template-item:last-child { border-bottom: none; }
        .fai-template-text { flex: 1; min-width: 0; }
        .fai-template-title { font-size: 13px; font-weight: 600; color: #2a2520; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .fai-template-preview { font-size: 11px; color: #9a9088; line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .fai-template-actions { display: flex; gap: 2px; flex-shrink: 0; margin-top: 1px; }
        .fai-tpl-icon-btn {
          background: none; border: none; cursor: pointer; color: #c8b89a;
          padding: 3px; border-radius: 4px; line-height: 1; transition: color 0.15s, background 0.15s;
          display: flex; align-items: center; justify-content: center;
        }
        .fai-tpl-icon-btn:hover { color: #7a6a58; background: #f0ece6; }
        .fai-tpl-icon-btn.danger:hover { color: #a0524a; background: #fdf0ee; }
        .fai-delete-confirm {
          display: flex; align-items: center; gap: 8px;
          padding: 6px 16px 10px; font-size: 11px; color: #7a6a58;
          border-bottom: 0.5px solid #f5f2ee; background: #fdf9f4;
        }
        .fai-delete-confirm-btn {
          font-size: 11px; padding: 3px 10px; border-radius: 12px; cursor: pointer;
          font-family: inherit; font-weight: 600; border: 1px solid transparent; transition: all 0.15s;
        }
        .fai-delete-confirm-btn.confirm { background: #a0524a; color: #fff; border-color: #a0524a; }
        .fai-delete-confirm-btn.confirm:hover { background: #8a4440; }
        .fai-delete-confirm-btn.cancel { background: transparent; color: #7a6a58; border-color: #d4cfc8; }
        .fai-delete-confirm-btn.cancel:hover { border-color: #9a9088; }
        .fai-templates-empty { padding: 32px 16px; text-align: center; color: #b8b0a8; font-size: 12px; line-height: 1.6; }
        .fai-template-form { padding: 14px 16px; border-bottom: 0.5px solid #f0ece6; background: #faf8f5; flex-shrink: 0; }
        .fai-form-label { font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: #9a9088; font-weight: 700; margin-bottom: 5px; display: block; }
        .fai-form-input {
          width: 100%; box-sizing: border-box; background: #fff; border: 0.5px solid #e4dfd8;
          border-radius: 6px; padding: 7px 10px; font-size: 13px; font-family: inherit;
          color: #1a1a1a; outline: none; transition: border-color 0.2s; margin-bottom: 10px;
        }
        .fai-form-input:focus { border-color: #c8b89a; }
        .fai-form-textarea {
          width: 100%; box-sizing: border-box; background: #fff; border: 0.5px solid #e4dfd8;
          border-radius: 6px; padding: 7px 10px; font-size: 13px; font-family: inherit;
          color: #1a1a1a; outline: none; transition: border-color 0.2s; resize: vertical;
          min-height: 80px; line-height: 1.5; margin-bottom: 10px;
        }
        .fai-form-textarea:focus { border-color: #c8b89a; }
        .fai-form-btns { display: flex; gap: 6px; }
        .fai-form-btn {
          font-size: 11px; padding: 4px 14px; border-radius: 20px; cursor: pointer;
          font-family: inherit; font-weight: 600; border: 1px solid transparent; transition: all 0.15s;
        }
        .fai-form-btn.primary { background: #2a6b50; color: #fff; border-color: #2a6b50; }
        .fai-form-btn.primary:hover { background: #235a42; }
        .fai-form-btn.secondary { background: transparent; color: #7a6a58; border-color: #d4cfc8; }
        .fai-form-btn.secondary:hover { border-color: #9a9088; }

        /* Slash popover */
        .fai-slash-popover {
          position: absolute; bottom: calc(100% + 6px); left: 14px; right: 14px;
          background: #fff; border: 0.5px solid #e4dfd8; border-radius: 8px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.1); z-index: 10; overflow: hidden;
          max-height: 200px; display: flex; flex-direction: column;
        }
        .fai-slash-list { overflow-y: auto; }
        .fai-slash-list::-webkit-scrollbar { width: 3px; }
        .fai-slash-list::-webkit-scrollbar-thumb { background: #e8e3dc; border-radius: 2px; }
        .fai-slash-item { padding: 8px 12px; cursor: pointer; transition: background 0.1s; border-bottom: 0.5px solid #f5f2ee; }
        .fai-slash-item:last-child { border-bottom: none; }
        .fai-slash-item:hover, .fai-slash-item.selected { background: #f5f0e8; }
        .fai-slash-item-title { font-size: 12px; font-weight: 600; color: #2a2520; }
        .fai-slash-item-preview { font-size: 11px; color: #9a9088; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .fai-slash-empty { padding: 12px; font-size: 12px; color: #b8b0a8; text-align: center; }

        /* File attachment */
        .fai-file-preview { display: flex; align-items: center; gap: 6px; margin-bottom: 7px; }
        .fai-file-thumb { width: 40px; height: 40px; border-radius: 6px; object-fit: cover; border: 0.5px solid #e4dfd8; flex-shrink: 0; }
        .fai-file-pill {
          display: flex; align-items: center; gap: 6px;
          background: #f5f0e8; border: 0.5px solid #e4dfd8; border-radius: 20px;
          padding: 4px 10px; font-size: 11px; color: #7a6a58; font-weight: 500;
          max-width: calc(100% - 28px); overflow: hidden;
        }
        .fai-file-pill-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .fai-file-remove { background: none; border: none; cursor: pointer; color: #b8b0a8; padding: 0; line-height: 1; font-size: 13px; flex-shrink: 0; transition: color 0.15s; }
        .fai-file-remove:hover { color: #7a6a58; }
        .fai-attach-btn {
          background: none; border: none; cursor: pointer; color: #c8b89a;
          padding: 0 6px 0 10px; align-self: flex-end; height: 46px;
          display: flex; align-items: center; justify-content: center;
          transition: color 0.15s; flex-shrink: 0;
        }
        .fai-attach-btn:hover { color: #7a6a58; }
        .fai-file-bubble-pill {
          display: inline-flex; align-items: center; gap: 4px;
          background: #f5f0e8; border: 0.5px solid #e4dfd8; border-radius: 12px;
          padding: 2px 8px; font-size: 11px; color: #7a6a58; font-weight: 500;
          margin-top: 4px; max-width: 180px; overflow: hidden;
        }
        .fai-file-bubble-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        /* Teach mode */
        .fai-coming-soon {
          flex: 1; display: flex; align-items: center; justify-content: center;
          font-size: 13px; color: #b8b0a8; background: #fff;
        }
        .fai-teach-panel {
          flex: 1; overflow-y: auto; background: #fff; min-height: 0;
        }
        .fai-teach-panel::-webkit-scrollbar { width: 3px; }
        .fai-teach-panel::-webkit-scrollbar-thumb { background: #e8e3dc; border-radius: 2px; }

        .fai-teach-section { padding: 14px 14px 20px; display: flex; flex-direction: column; gap: 12px; }

        .fai-teach-label { font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: #9a9088; font-weight: 700; margin-bottom: 4px; display: block; }
        .fai-teach-textarea {
          width: 100%; box-sizing: border-box; background: #f7f5f2;
          border: 0.5px solid #e4dfd8; border-radius: 8px; padding: 10px 12px;
          font-size: 13px; font-family: inherit; color: #1a1a1a; outline: none;
          transition: border-color 0.2s; resize: vertical; line-height: 1.55;
          min-height: 90px;
        }
        .fai-teach-textarea:focus { border-color: #c8b89a; background: #fff; }
        .fai-teach-textarea::placeholder { color: #b8b0a8; }
        .fai-teach-input {
          width: 100%; box-sizing: border-box; background: #f7f5f2;
          border: 0.5px solid #e4dfd8; border-radius: 8px; padding: 8px 12px;
          font-size: 12px; font-family: inherit; color: #1a1a1a; outline: none;
          transition: border-color 0.2s;
        }
        .fai-teach-input:focus { border-color: #c8b89a; background: #fff; }
        .fai-teach-input::placeholder { color: #b8b0a8; }
        .fai-teach-select {
          width: 100%; box-sizing: border-box; background: #f7f5f2;
          border: 0.5px solid #e4dfd8; border-radius: 8px; padding: 7px 10px;
          font-size: 12px; font-family: inherit; color: #1a1a1a; outline: none;
          transition: border-color 0.2s; cursor: pointer;
        }
        .fai-teach-select:focus { border-color: #c8b89a; }

        .fai-teach-btn {
          font-family: inherit; font-size: 12px; font-weight: 600;
          border-radius: 8px; border: none; cursor: pointer; padding: 9px 16px;
          transition: all 0.15s; display: inline-flex; align-items: center; gap: 6px;
        }
        .fai-teach-btn.primary { background: #1a1a1a; color: #f5f0e8; }
        .fai-teach-btn.primary:hover { background: #2a2a2a; }
        .fai-teach-btn.primary:disabled { opacity: 0.45; cursor: not-allowed; }
        .fai-teach-btn.success { background: #2a6b50; color: #fff; }
        .fai-teach-btn.success:hover { background: #235a42; }
        .fai-teach-btn.success:disabled { opacity: 0.45; cursor: not-allowed; }
        .fai-teach-btn.outline { background: transparent; color: #7a6a58; border: 1px solid #d4cfc8; }
        .fai-teach-btn.outline:hover { border-color: #9a9088; }
        .fai-teach-btn.sm { font-size: 11px; padding: 5px 10px; border-radius: 6px; }

        /* Mic button */
        .fai-mic-btn {
          position: absolute; top: 8px; right: 8px;
          width: 28px; height: 28px; border-radius: 50%; border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          background: #f0ece6; color: #9a9088; transition: all 0.15s;
          font-size: 13px;
        }
        .fai-mic-btn:hover { background: #e8e3dc; color: #7a6a58; }
        .fai-mic-btn.listening { background: #fdf0ee; color: #a0524a; animation: fai-mic-pulse 1.4s ease-in-out infinite; }
        @keyframes fai-mic-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(160,82,74,0.4); }
          50% { box-shadow: 0 0 0 5px rgba(160,82,74,0); }
        }
        .fai-interim { font-size: 11px; color: #b8b0a8; font-style: italic; min-height: 16px; line-height: 1.4; }

        /* Review card */
        .fai-review-card {
          border: 0.5px solid #e4dfd8; border-radius: 8px; background: #fdfdfc;
          overflow: hidden;
        }
        .fai-review-header { padding: 12px 14px; border-bottom: 0.5px solid #f0ece6; }
        .fai-review-title { font-size: 13px; font-weight: 700; color: #2a2520; }
        .fai-review-trigger { font-size: 11px; color: #7a6a58; margin-top: 4px; line-height: 1.5; }
        .fai-review-section { padding: 10px 14px; border-bottom: 0.5px solid #f0ece6; }
        .fai-review-section:last-child { border-bottom: none; }
        .fai-review-section-label { font-size: 9.5px; letter-spacing: 1.2px; text-transform: uppercase; color: #b8b0a8; font-weight: 700; margin-bottom: 6px; }
        .fai-review-step { display: flex; gap: 8px; margin-bottom: 4px; font-size: 12px; color: #2a2520; line-height: 1.5; }
        .fai-review-step-num { color: #c8b89a; font-weight: 700; flex-shrink: 0; min-width: 16px; }
        .fai-review-chips { display: flex; flex-wrap: wrap; gap: 4px; }
        .fai-review-chip {
          background: #f5f0e8; border: 0.5px solid #e4dfd8; border-radius: 20px;
          padding: 2px 8px; font-size: 10px; color: #7a6a58; font-weight: 500;
          display: inline-flex; align-items: center; gap: 4px;
        }
        .fai-chip-remove {
          background: none; border: none; cursor: pointer; color: #b8b0a8;
          padding: 0; line-height: 1; font-size: 11px; transition: color 0.15s;
        }
        .fai-chip-remove:hover { color: #a0524a; }
        .fai-review-vars { font-size: 11px; color: #9a9088; font-family: 'DM Mono', monospace; }

        .fai-similar-header { font-size: 11px; color: #c8844a; font-weight: 600; margin: 4px 0; display: flex; align-items: center; gap: 6px; }
        .fai-similar-card {
          border: 0.5px solid #f0ece6; border-radius: 6px; padding: 10px 12px;
          background: #fdf9f4; margin-bottom: 6px;
        }
        .fai-similar-title { font-size: 12px; font-weight: 600; color: #2a2520; margin-bottom: 2px; }
        .fai-similar-meta { font-size: 10px; color: #9a9088; margin-bottom: 6px; }
        .fai-similar-actions { display: flex; gap: 6px; flex-wrap: wrap; }

        .fai-review-actions { display: flex; gap: 8px; margin-top: 12px; }

        .fai-teach-confirm {
          border: 0.5px solid #c8e6d8; border-radius: 8px; background: #f0faf5;
          padding: 14px; text-align: center;
        }
        .fai-teach-confirm-icon { font-size: 22px; margin-bottom: 6px; }
        .fai-teach-confirm-text { font-size: 13px; font-weight: 600; color: #2a6b50; margin-bottom: 4px; }
        .fai-teach-confirm-sub { font-size: 11px; color: #4a8a68; }

        .fai-teach-error { font-size: 11px; color: #a0524a; background: #fdf0ee; border: 0.5px solid #e8c8c4; border-radius: 6px; padding: 8px 10px; }

        .fai-structuring { padding: 24px 16px; text-align: center; }
        .fai-structuring-text { font-size: 13px; color: #7a6a58; font-style: italic; }
        .fai-structuring-sub { font-size: 11px; color: #b8b0a8; margin-top: 4px; }
      `}</style>

      <div
        className="fai-widget"
        onMouseDown={handleDragStart}
        style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
      >
        {/* Header / drag handle */}
        <div className="fai-header">
          <div className="fai-drag-dots">
            {[0, 1, 2].map((r) => (
              <div key={r} className="fai-drag-row">
                <div className="fai-drag-dot" /><div className="fai-drag-dot" />
              </div>
            ))}
          </div>
          <div className="fai-pip" />
          <span className="fai-label">IRC Assistant</span>
          {activeMode === 'chat' && (
            <button
              className={`fai-header-btn${showTemplates ? ' active' : ''}`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={showTemplates ? closeTemplates : openTemplates}
              title={showTemplates ? 'Back to chat' : 'Prompt templates'}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="12" height="12" rx="2" />
                <path d="M5 6h6M5 9h4" />
              </svg>
            </button>
          )}
          <button className="fai-close-btn" onMouseDown={(e) => e.stopPropagation()} onClick={onClose} title="Hide assistant">
            &#x2715;
          </button>
        </div>

        {/* Mode selector */}
        <div className="fai-mode-selector">
          {visibleModes.map((mode) => (
            <button
              key={mode}
              className={`fai-mode-btn${activeMode === mode ? ' active' : ''}`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setActiveMode(mode)}
            >
              {mode === 'chat' ? 'Chat' : mode === 'doit' ? 'Do It' : 'Teach'}
            </button>
          ))}
        </div>

        {/* ── Chat mode ── */}
        {activeMode === 'chat' && (
          <>
            {showTemplates && (
              <div className="fai-templates-panel">
                <div className="fai-templates-header">
                  <span className="fai-templates-title">Prompt Templates</span>
                  {!isFormOpen && (
                    <button className="fai-new-btn" onClick={startCreate}>+ New Template</button>
                  )}
                </div>
                {isFormOpen && (
                  <div className="fai-template-form">
                    <label className="fai-form-label">Title</label>
                    <input className="fai-form-input" placeholder="Short display name" value={formTitle} onChange={(e) => setFormTitle(e.target.value)} />
                    <label className="fai-form-label">Body</label>
                    <textarea className="fai-form-textarea" placeholder="Full template text" value={formBody} onChange={(e) => setFormBody(e.target.value)} />
                    <div className="fai-form-btns">
                      <button className="fai-form-btn primary" onClick={saveTemplate}>Save</button>
                      <button className="fai-form-btn secondary" onClick={cancelForm}>Cancel</button>
                    </div>
                  </div>
                )}
                <div className="fai-templates-list">
                  {templatesLoading ? (
                    <div className="fai-templates-empty">Loading…</div>
                  ) : templates.length === 0 ? (
                    <div className="fai-templates-empty">
                      No templates yet. Create one to get started.<br />
                      Type <strong>/</strong> in the chat to use templates quickly.
                    </div>
                  ) : (
                    templates.map((t) => (
                      <div key={t.id}>
                        <div className="fai-template-item">
                          <div className="fai-template-text">
                            <div className="fai-template-title">{t.title}</div>
                            <div className="fai-template-preview">{t.body.slice(0, 80)}{t.body.length > 80 ? '…' : ''}</div>
                          </div>
                          <div className="fai-template-actions">
                            <button className="fai-tpl-icon-btn" title="Edit" onClick={() => startEdit(t)}>
                              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 2l3 3-9 9H2v-3L11 2z" /></svg>
                            </button>
                            <button className="fai-tpl-icon-btn danger" title="Delete" onClick={() => setDeleteConfirmId(t.id)}>
                              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 10h8l1-10" /></svg>
                            </button>
                          </div>
                        </div>
                        {deleteConfirmId === t.id && (
                          <div className="fai-delete-confirm">
                            <span>Delete this template?</span>
                            <button className="fai-delete-confirm-btn confirm" onClick={() => deleteTemplate(t.id)}>Delete</button>
                            <button className="fai-delete-confirm-btn cancel" onClick={() => setDeleteConfirmId(null)}>Cancel</button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {!showTemplates && (
              <div className="fai-messages">
                {messages.length === 0 && (
                  <div className="fai-empty">
                    <div className="fai-empty-icon">⬡</div>
                    <div className="fai-empty-text">What do you need help with?</div>
                    <div className="fai-empty-sub">Ask about jobs, quotes, scope — or ask me to take action on your behalf.</div>
                  </div>
                )}
                {messages.map((msg, i) => (
                  <div key={i} className={`fai-bubble ${msg.role}`}>
                    <div className={`fai-avatar ${msg.role}`}>{msg.role === 'user' ? 'Me' : '⬡'}</div>
                    <div className="fai-bubble-inner">
                      {msg.fileName && (
                        <div className="fai-file-bubble-pill">
                          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 2H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6L9 2z" /><path d="M9 2v4h4" /></svg>
                          <span className="fai-file-bubble-name">{msg.fileName}</span>
                        </div>
                      )}
                      {msg.content && <div className="fai-bubble-text">{msg.content}</div>}
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="fai-bubble assistant">
                    <div className="fai-avatar assistant">⬡</div>
                    <div className="fai-bubble-inner">
                      <div className="fai-bubble-text" style={{ color: '#9a9088', fontStyle: 'italic' }}>{thinkingText}</div>
                      {actionChecklist.length > 0 && (
                        <div style={{ marginTop: '8px', padding: '8px 0' }}>
                          {actionChecklist.map((item) => (
                            <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#7a6a58', marginBottom: '4px' }}>
                              <span style={{ color: item.completed ? '#2a6b50' : '#c8b89a' }}>{item.completed ? '✓' : '○'}</span>
                              <span style={{ textDecoration: item.completed ? 'line-through' : 'none', opacity: item.completed ? 0.6 : 1 }}>{item.text}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}

            <div className="fai-input-wrap">
              <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleFileSelect} />
              {attachedFile && (
                <div className="fai-file-preview">
                  {attachedPreviewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={attachedPreviewUrl} alt={attachedFile.name} className="fai-file-thumb" />
                  ) : (
                    <div className="fai-file-pill">
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 2H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6L9 2z" /><path d="M9 2v4h4" /></svg>
                      <span className="fai-file-pill-name">{attachedFile.name}</span>
                    </div>
                  )}
                  <button className="fai-file-remove" onClick={removeAttachment} title="Remove file">&#x2715;</button>
                </div>
              )}
              {showSlashPopover && (
                <div className="fai-slash-popover" ref={slashPopoverRef}>
                  <div className="fai-slash-list">
                    {filteredTemplates.length === 0 ? (
                      <div className="fai-slash-empty">No templates match</div>
                    ) : (
                      filteredTemplates.map((t, idx) => (
                        <div
                          key={t.id}
                          className={`fai-slash-item${idx === slashSelectedIdx ? ' selected' : ''}`}
                          onMouseDown={(e) => { e.preventDefault(); insertTemplate(t) }}
                        >
                          <div className="fai-slash-item-title">{t.title}</div>
                          <div className="fai-slash-item-preview">{t.body.slice(0, 60)}{t.body.length > 60 ? '…' : ''}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
              <div className="fai-input-row">
                <button className="fai-attach-btn" title="Attach file" onClick={() => fileInputRef.current?.click()} type="button">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                </button>
                <textarea
                  ref={textareaRef}
                  className="fai-textarea"
                  placeholder="Ask anything or say what you'd like to do… (type / for templates)"
                  rows={1}
                  value={input}
                  onChange={handleTextareaInput}
                  onKeyDown={handleKeyDown}
                />
                <button className="fai-send-btn" onClick={sendMessage} disabled={loading}>
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#e8e0d5" strokeWidth="2.2" strokeLinecap="round">
                    <path d="M2 14L14 8 2 2v4.5l7 1.5-7 1.5V14z" />
                  </svg>
                </button>
              </div>
              <div className="fai-hint">Enter to send &nbsp;·&nbsp; Shift+Enter for new line</div>
            </div>
          </>
        )}

        {/* ── Do It mode ── */}
        {activeMode === 'doit' && (
          <div className="fai-coming-soon">Coming soon</div>
        )}

        {/* ── Teach mode ── */}
        {activeMode === 'teach' && (
          <div className="fai-teach-panel">

            {/* Unified form */}
            {processStep === 'form' && (
              <div className="fai-teach-section">
                {structureError && (
                  <div className="fai-teach-error">{structureError}</div>
                )}

                <div>
                  <div style={{ position: 'relative' }}>
                    <textarea
                      ref={teachTextareaRef}
                      className="fai-teach-textarea"
                      placeholder="Teach IRC something — a rule, a tone note, or walk through a process step by step..."
                      value={dictationText}
                      onChange={(e) => setDictationText(e.target.value)}
                      style={{ minHeight: 110, paddingRight: speechSupported ? 44 : 12 }}
                    />
                    {speechSupported && (
                      <button
                        className={`fai-mic-btn${isListening ? ' listening' : ''}`}
                        onClick={toggleListening}
                        title={isListening ? 'Stop dictation' : 'Dictate with microphone'}
                        type="button"
                      >
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="5" y="1" width="6" height="9" rx="3" />
                          <path d="M2 8a6 6 0 0 0 12 0M8 14v2M5 16h6" />
                        </svg>
                      </button>
                    )}
                  </div>
                  {isListening && (
                    <div className="fai-interim">
                      {interimTranscript || 'Listening…'}
                    </div>
                  )}
                </div>

                <div>
                  <span className="fai-teach-label">What triggers this? (optional)</span>
                  <input
                    className="fai-teach-input"
                    placeholder="e.g. when a job is cash settled"
                    value={triggerText}
                    onChange={(e) => setTriggerText(e.target.value)}
                  />
                </div>

                <button
                  className="fai-teach-btn primary"
                  onClick={handleTeachSubmit}
                  disabled={!dictationText.trim()}
                  style={{ alignSelf: 'flex-start' }}
                >
                  ⚡ Teach
                </button>
              </div>
            )}

            {/* Structuring */}
            {processStep === 'structuring' && (
              <div className="fai-structuring">
                <div style={{ fontSize: 24, marginBottom: 12, opacity: 0.4 }}>⬡</div>
                <div className="fai-structuring-text">Structuring what you taught…</div>
                <div className="fai-structuring-sub">This takes a few seconds</div>
              </div>
            )}

            {/* Review */}
            {processStep === 'review' && displayOutput && (
              <div className="fai-teach-section">
                <div className="fai-review-card">
                  <div className="fai-review-header">
                    {isEditingReview && editedOutput ? (
                      <input
                        className="fai-teach-input"
                        value={editedOutput.title}
                        onChange={(e) => setEditedOutput({ ...editedOutput, title: e.target.value })}
                        style={{ fontWeight: 700, fontSize: 13 }}
                      />
                    ) : (
                      <div className="fai-review-title">
                        {displayOutput.type === 'note' ? '📝' : '📋'} {displayOutput.title}
                      </div>
                    )}
                    {displayOutput.trigger_condition && (
                      isEditingReview && editedOutput ? (
                        <textarea
                          className="fai-teach-textarea"
                          value={editedOutput.trigger_condition}
                          onChange={(e) => setEditedOutput({ ...editedOutput, trigger_condition: e.target.value })}
                          style={{ marginTop: 6, minHeight: 48, fontSize: 11 }}
                        />
                      ) : (
                        <div className="fai-review-trigger">Triggers when: {displayOutput.trigger_condition}</div>
                      )
                    )}
                  </div>

                  {displayOutput.steps.length > 0 && (
                    <div className="fai-review-section">
                      <div className="fai-review-section-label">Steps</div>
                      {displayOutput.steps.map((step, i) => (
                        <div key={i} className="fai-review-step">
                          <span className="fai-review-step-num">{step.order}.</span>
                          {isEditingReview ? (
                            <input
                              className="fai-teach-input"
                              value={editedOutput?.steps[i]?.description ?? step.description}
                              onChange={(e) => updateEditedStep(i, e.target.value)}
                              style={{ flex: 1 }}
                            />
                          ) : (
                            <span>{step.description}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {displayOutput.variables.length > 0 && (
                    <div className="fai-review-section">
                      <div className="fai-review-section-label">Variables</div>
                      <div className="fai-review-vars">{displayOutput.variables.join(', ')}</div>
                    </div>
                  )}

                  <div className="fai-review-section">
                    <div className="fai-review-section-label">Tags</div>
                    <div className="fai-review-chips">
                      {displayOutput.tags.map((tag) => (
                        <span key={tag} className="fai-review-chip">
                          {tag}
                          {isEditingReview && (
                            <button className="fai-chip-remove" onClick={() => removeEditedTag(tag)} title="Remove tag">×</button>
                          )}
                        </span>
                      ))}
                      {isEditingReview && (
                        <input
                          className="fai-teach-input"
                          style={{ width: 100, padding: '2px 8px', fontSize: 10, borderRadius: 20, minHeight: 'unset' }}
                          placeholder="+ add tag"
                          value={newTagInput}
                          onChange={(e) => setNewTagInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addEditedTag(newTagInput) } }}
                          onBlur={() => { if (newTagInput.trim()) addEditedTag(newTagInput) }}
                        />
                      )}
                    </div>
                  </div>

                  <div className="fai-review-section">
                    <div className="fai-review-section-label">Category</div>
                    {isEditingReview && editedOutput ? (
                      <select
                        className="fai-teach-select"
                        value={editedOutput.category}
                        onChange={(e) => setEditedOutput({ ...editedOutput, category: e.target.value as BrainEntryCategory })}
                      >
                        <option value="workflow">Workflow</option>
                        <option value="rule">Rule</option>
                        <option value="tone">Tone</option>
                        <option value="classification">Classification</option>
                        <option value="example">Example</option>
                        <option value="correction">Correction</option>
                      </select>
                    ) : (
                      <div style={{ fontSize: 12, color: '#7a6a58', textTransform: 'capitalize' }}>{displayOutput.category}</div>
                    )}
                  </div>
                </div>

                {similarityMatches.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div className="fai-similar-header">
                      ⚠ Similar existing entries found
                    </div>
                    {similarityMatches.map((match) => (
                      <div key={match.id} className="fai-similar-card">
                        <div className="fai-similar-title">{match.title}</div>
                        <div className="fai-similar-meta">{match.category} · {match.similarity} similarity</div>
                        <div className="fai-similar-actions">
                          <button
                            className="fai-teach-btn outline sm"
                            onClick={() => approveSave('example', match.id)}
                            disabled={isSaving}
                          >
                            Add as example to this
                          </button>
                          <button
                            className="fai-teach-btn outline sm"
                            onClick={() => approveSave('variant', match.id)}
                            disabled={isSaving}
                          >
                            Save as variant
                          </button>
                        </div>
                      </div>
                    ))}
                    <div style={{ fontSize: 11, color: '#9a9088', marginTop: 4 }}>Or save as new below ↓</div>
                  </div>
                )}

                <div className="fai-review-actions">
                  {!isEditingReview && (
                    <button className="fai-teach-btn outline" onClick={enterEditMode}>
                      ✏️ Edit
                    </button>
                  )}
                  <button
                    className="fai-teach-btn success"
                    onClick={() => approveSave('new')}
                    disabled={isSaving}
                    style={{ flex: 1 }}
                  >
                    {isSaving ? 'Saving…' : '✅ Approve'}
                  </button>
                </div>
              </div>
            )}

            {/* Saved */}
            {processStep === 'saved' && (
              <div className="fai-teach-section">
                <div className="fai-teach-confirm">
                  <div className="fai-teach-confirm-icon">✅</div>
                  <div className="fai-teach-confirm-text">
                    {savedResult?.playbookId ? 'Workflow saved to brain' : 'Note saved to brain'}
                  </div>
                  <div className="fai-teach-confirm-sub">IRC will use this next time.</div>
                </div>
                {savedResult && (
                  <div style={{ fontSize: 10, color: '#b8b0a8', textAlign: 'center' }}>
                    Entry ID: {savedResult.brainEntryId.slice(0, 8)}…
                    {savedResult.playbookId && ` · Playbook: ${savedResult.playbookId.slice(0, 8)}…`}
                  </div>
                )}
                <button
                  className="fai-teach-btn outline"
                  style={{ alignSelf: 'center' }}
                  onClick={resetTeachState}
                >
                  Teach something else
                </button>
              </div>
            )}
          </div>
        )}

        {/* Resize handle */}
        <div className="fai-resize-handle" onMouseDown={handleResizeStart}>
          <svg className="fai-resize-icon" width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M9 1L1 9M9 5L5 9M9 9" stroke="#9a9088" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </div>
      </div>
    </>
  )
}
