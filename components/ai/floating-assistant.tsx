'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

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

export function FloatingAssistant({ visible, onClose, tenantId }: Props) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const activeTab = searchParams.get('tab') ?? undefined

  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [size, setSize] = useState({ w: DEFAULT_W, h: DEFAULT_H })
  const [mounted, setMounted] = useState(false)

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

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const slashPopoverRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Drag/resize state in refs to avoid stale closures
  const dragState = useRef({ active: false, startX: 0, startY: 0, startPosX: 0, startPosY: 0 })
  const resizeState = useRef({ active: false, startX: 0, startY: 0, startW: 0, startH: 0 })
  const posRef = useRef(pos)
  const sizeRef = useRef(size)
  posRef.current = pos
  sizeRef.current = size

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

  function openTemplates() {
    setShowTemplates(true)
  }

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
    // Only allow drag from non-interactive elements
    const target = e.target as HTMLElement
    if (target.tagName === 'BUTTON' || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.closest('button') || target.closest('input') || target.closest('textarea')) {
      return
    }

    // Don't drag if user is selecting text in message bubbles
    const selection = window.getSelection()
    if (selection && selection.toString().length > 0) {
      return
    }

    // Don't drag if clicking on selectable text in message bubbles
    if (target.closest('.fai-bubble-text')) {
      return
    }

    e.preventDefault()
    dragState.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      startPosX: posRef.current.x,
      startPosY: posRef.current.y,
    }
  }

  function handleResizeStart(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    resizeState.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      startW: sizeRef.current.w,
      startH: sizeRef.current.h,
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

    // Capture file before clearing attachment state
    const fileToSend = attachedFile
    const isBinaryFile = fileToSend
      ? /^image\/(jpeg|png|webp|gif)$/.test(fileToSend.type) || fileToSend.type === 'application/pdf'
      : false

    // For non-binary files (CSV, Excel, Word, etc.) read as text on client
    let textFileContent: string | null = null
    if (fileToSend && !isBinaryFile) {
      textFileContent = await fileToText(fileToSend)
    }

    removeAttachment()
    setLoading(true)

    try {
      let res: Response

      if (fileToSend && isBinaryFile) {
        // Use FormData for images and PDFs — avoids base64-in-JSON body size limits
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
            pageContext: pathname,
            activeTab,
            tenantId,
            ...(fileAttachment ? { fileAttachment } : {}),
          }),
        })
      }

      const data = await res.json()
      let text: string = data.text ?? 'Sorry, I encountered an error.'
      
      // Filter out tool calls from the response
      text = text.replace(/\n?\n?\s*\{"name":\s*"[^"]+",\s*"parameters":\s*\{[^}]*\}\}\s*\n?/g, '')
      text = text.replace(/\n?\n?\s*\[\]\s*\n?/g, '')
      text = text.replace(/\n?\n?\s*Let me read[^\n]*\n?/g, '')
      text = text.replace(/\n?\n?\s*Let me check[^\n]*\n?/g, '')
      text = text.replace(/\n?\n?\s*Let me get[^\n]*\n?/g, '')
      text = text.trim()
      
      setMessages((prev) => [...prev, { role: 'assistant', content: text }])
      
      // Dispatch custom event to trigger page refreshes
      window.dispatchEvent(new CustomEvent('ai-action-complete', { detail: { success: true } }))
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Something went wrong. Please try again.' },
      ])
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (showSlashPopover) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashSelectedIdx((i) => Math.min(i + 1, filteredTemplates.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashSelectedIdx((i) => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (filteredTemplates[slashSelectedIdx]) {
          insertTemplate(filteredTemplates[slashSelectedIdx])
        }
        return
      }
      if (e.key === 'Escape') {
        setShowSlashPopover(false)
        setSlashQuery('')
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function handleTextareaInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    setInput(val)
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'

    // Detect slash trigger
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

  if (!mounted || !visible) return null

  const isFormOpen = isCreating || editingTemplate !== null

  return (
    <>
      <style>{`
        .fai-widget {
          position: fixed;
          z-index: 1000;
          display: flex;
          flex-direction: column;
          background: #fff;
          border: 0.5px solid #e4dfd8;
          border-radius: 10px;
          box-shadow: 0 8px 40px rgba(0,0,0,0.13), 0 2px 8px rgba(0,0,0,0.07);
          overflow: hidden;
          font-family: 'DM Sans', -apple-system, sans-serif;
        }
        .fai-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 11px 14px 10px;
          border-bottom: 0.5px solid #f0ece6;
          background: #fdfdfc;
          cursor: grab;
          user-select: none;
          flex-shrink: 0;
        }
        .fai-header:active { cursor: grabbing; }
        .fai-drag-dots {
          display: flex;
          flex-direction: column;
          gap: 3px;
          opacity: 0.35;
          margin-right: 2px;
          flex-shrink: 0;
        }
        .fai-drag-row { display: flex; gap: 3px; }
        .fai-drag-dot { width: 2.5px; height: 2.5px; border-radius: 50%; background: #9a9088; }
        .fai-pip { width: 6px; height: 6px; border-radius: 50%; background: #c8b89a; flex-shrink: 0; }
        .fai-label { font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: #c8b89a; font-weight: 700; flex: 1; }
        .fai-header-btn {
          background: none;
          border: none;
          cursor: pointer;
          color: #c8b89a;
          padding: 3px 4px;
          line-height: 1;
          font-size: 16px;
          border-radius: 4px;
          transition: color 0.15s, background 0.15s;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .fai-header-btn:hover { color: #7a6a58; background: #f5f0e8; }
        .fai-header-btn.active { color: #9a7a50; background: #f5f0e8; }
        .fai-close-btn {
          background: none;
          border: none;
          cursor: pointer;
          color: #c8b89a;
          padding: 3px 4px;
          line-height: 1;
          font-size: 16px;
          border-radius: 4px;
          transition: color 0.15s, background 0.15s;
          flex-shrink: 0;
        }
        .fai-close-btn:hover { color: #7a6a58; background: #f5f0e8; }

        .fai-messages {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 14px;
          padding: 16px 18px;
          background: #fff;
          min-height: 0;
        }
        .fai-messages::-webkit-scrollbar { width: 3px; }
        .fai-messages::-webkit-scrollbar-thumb { background: #e8e3dc; border-radius: 2px; }

        .fai-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          flex: 1;
          gap: 8px;
          padding: 24px 0;
        }
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
          padding: 9px 13px;
          border-radius: 10px;
          font-size: 13px;
          line-height: 1.65;
          font-weight: 400;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .fai-bubble.user .fai-bubble-text {
          background: #1a1a1a; color: #e8e0d5;
          border-radius: 10px 10px 3px 10px;
        }
        .fai-bubble.assistant .fai-bubble-text {
          background: #f7f5f2; color: #2a2520;
          border-radius: 10px 10px 10px 3px;
          border: 0.5px solid #e8e3dc;
        }

        .fai-input-wrap {
          padding: 12px 14px 14px;
          border-top: 0.5px solid #f0ece6;
          background: #fdfdfc;
          flex-shrink: 0;
          position: relative;
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
          display: flex; align-items: flex-end; justify-content: flex-end;
          padding: 3px;
        }
        .fai-resize-icon { opacity: 0.3; }
        .fai-resize-handle:hover .fai-resize-icon { opacity: 0.6; }

        /* Templates panel */
        .fai-templates-panel {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-height: 0;
          background: #fff;
        }
        .fai-templates-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px 10px;
          border-bottom: 0.5px solid #f0ece6;
          flex-shrink: 0;
        }
        .fai-templates-title { font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: #9a9088; font-weight: 700; }
        .fai-new-btn {
          font-size: 11px; padding: 4px 12px; border-radius: 20px; cursor: pointer;
          font-family: inherit; font-weight: 600; border: 1px solid #c8b89a;
          background: transparent; color: #7a6a58; transition: all 0.15s;
        }
        .fai-new-btn:hover { background: #f5f0e8; }

        .fai-templates-list {
          flex: 1; overflow-y: auto; padding: 8px 0; min-height: 0;
        }
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

        /* Inline template form */
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
        .fai-slash-item {
          padding: 8px 12px; cursor: pointer; transition: background 0.1s;
          border-bottom: 0.5px solid #f5f2ee;
        }
        .fai-slash-item:last-child { border-bottom: none; }
        .fai-slash-item:hover, .fai-slash-item.selected { background: #f5f0e8; }
        .fai-slash-item-title { font-size: 12px; font-weight: 600; color: #2a2520; }
        .fai-slash-item-preview { font-size: 11px; color: #9a9088; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .fai-slash-empty { padding: 12px; font-size: 12px; color: #b8b0a8; text-align: center; }

        /* File attachment */
        .fai-file-preview {
          display: flex; align-items: center; gap: 6px;
          margin-bottom: 7px;
        }
        .fai-file-thumb {
          width: 40px; height: 40px; border-radius: 6px; object-fit: cover;
          border: 0.5px solid #e4dfd8; flex-shrink: 0;
        }
        .fai-file-pill {
          display: flex; align-items: center; gap: 6px;
          background: #f5f0e8; border: 0.5px solid #e4dfd8; border-radius: 20px;
          padding: 4px 10px; font-size: 11px; color: #7a6a58; font-weight: 500;
          max-width: calc(100% - 28px); overflow: hidden;
        }
        .fai-file-pill-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .fai-file-remove {
          background: none; border: none; cursor: pointer; color: #b8b0a8;
          padding: 0; line-height: 1; font-size: 13px; flex-shrink: 0;
          transition: color 0.15s;
        }
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
      `}</style>

      <div
        className="fai-widget"
        onMouseDown={handleDragStart}
        style={{
          left: pos.x,
          top: pos.y,
          width: size.w,
          height: size.h,
        }}
      >
        {/* Header / drag handle */}
        <div className="fai-header">
          <div className="fai-drag-dots">
            <div className="fai-drag-row">
              <div className="fai-drag-dot" /><div className="fai-drag-dot" />
            </div>
            <div className="fai-drag-row">
              <div className="fai-drag-dot" /><div className="fai-drag-dot" />
            </div>
            <div className="fai-drag-row">
              <div className="fai-drag-dot" /><div className="fai-drag-dot" />
            </div>
          </div>
          <div className="fai-pip" />
          <span className="fai-label">IRC Assistant</span>
          {/* Templates toggle button */}
          <button
            className={`fai-header-btn${showTemplates ? ' active' : ''}`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={showTemplates ? closeTemplates : openTemplates}
            title={showTemplates ? 'Back to chat' : 'Prompt templates'}
          >
            {/* List/bookmark icon */}
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="12" height="12" rx="2" />
              <path d="M5 6h6M5 9h4" />
            </svg>
          </button>
          <button
            className="fai-close-btn"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={onClose}
            title="Hide assistant"
          >
            &#x2715;
          </button>
        </div>

        {/* Templates panel */}
        {showTemplates && (
          <div className="fai-templates-panel">
            <div className="fai-templates-header">
              <span className="fai-templates-title">Prompt Templates</span>
              {!isFormOpen && (
                <button className="fai-new-btn" onClick={startCreate}>
                  + New Template
                </button>
              )}
            </div>

            {isFormOpen && (
              <div className="fai-template-form">
                <label className="fai-form-label">Title</label>
                <input
                  className="fai-form-input"
                  placeholder="Short display name"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                />
                <label className="fai-form-label">Body</label>
                <textarea
                  className="fai-form-textarea"
                  placeholder="Full template text"
                  value={formBody}
                  onChange={(e) => setFormBody(e.target.value)}
                />
                <div className="fai-form-btns">
                  <button className="fai-form-btn primary" onClick={saveTemplate}>
                    Save
                  </button>
                  <button className="fai-form-btn secondary" onClick={cancelForm}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="fai-templates-list">
              {templatesLoading ? (
                <div className="fai-templates-empty">Loading…</div>
              ) : templates.length === 0 ? (
                <div className="fai-templates-empty">
                  No templates yet. Create one to get started.
                  <br />
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
                        <button
                          className="fai-tpl-icon-btn"
                          title="Edit"
                          onClick={() => startEdit(t)}
                        >
                          {/* Pencil icon */}
                          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 2l3 3-9 9H2v-3L11 2z" />
                          </svg>
                        </button>
                        <button
                          className="fai-tpl-icon-btn danger"
                          title="Delete"
                          onClick={() => setDeleteConfirmId(t.id)}
                        >
                          {/* Trash icon */}
                          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 10h8l1-10" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    {deleteConfirmId === t.id && (
                      <div className="fai-delete-confirm">
                        <span>Delete this template?</span>
                        <button
                          className="fai-delete-confirm-btn confirm"
                          onClick={() => deleteTemplate(t.id)}
                        >
                          Delete
                        </button>
                        <button
                          className="fai-delete-confirm-btn cancel"
                          onClick={() => setDeleteConfirmId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Messages (hidden when templates panel is open) */}
        {!showTemplates && (
          <div className="fai-messages">
            {messages.length === 0 && (
              <div className="fai-empty">
                <div className="fai-empty-icon">⬡</div>
                <div className="fai-empty-text">What do you need help with?</div>
                <div className="fai-empty-sub">
                  Ask about jobs, quotes, scope — or ask me to take action on your behalf.
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`fai-bubble ${msg.role}`}>
                <div className={`fai-avatar ${msg.role}`}>
                  {msg.role === 'user' ? 'Me' : '⬡'}
                </div>
                <div className="fai-bubble-inner">
                  {msg.fileName && (
                    <div className="fai-file-bubble-pill">
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 2H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6L9 2z" /><path d="M9 2v4h4" />
                      </svg>
                      <span className="fai-file-bubble-name">{msg.fileName}</span>
                    </div>
                  )}
                  {msg.content && (
                    <div className="fai-bubble-text">{msg.content}</div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="fai-bubble assistant">
                <div className="fai-avatar assistant">⬡</div>
                <div className="fai-bubble-inner">
                  <div className="fai-bubble-text" style={{ color: '#9a9088', fontStyle: 'italic' }}>
                    {thinkingText}
                  </div>
                  {actionChecklist.length > 0 && (
                    <div style={{ marginTop: '8px', padding: '8px 0' }}>
                      {actionChecklist.map((item) => (
                        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#7a6a58', marginBottom: '4px' }}>
                          <span style={{ color: item.completed ? '#2a6b50' : '#c8b89a' }}>
                            {item.completed ? '✓' : '○'}
                          </span>
                          <span style={{ textDecoration: item.completed ? 'line-through' : 'none', opacity: item.completed ? 0.6 : 1 }}>
                            {item.text}
                          </span>
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

        {/* Input */}
        <div className="fai-input-wrap">
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />
          {/* File preview */}
          {attachedFile && (
            <div className="fai-file-preview">
              {attachedPreviewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={attachedPreviewUrl} alt={attachedFile.name} className="fai-file-thumb" />
              ) : (
                <div className="fai-file-pill">
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 2H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6L9 2z" /><path d="M9 2v4h4" />
                  </svg>
                  <span className="fai-file-pill-name">{attachedFile.name}</span>
                </div>
              )}
              <button className="fai-file-remove" onClick={removeAttachment} title="Remove file">&#x2715;</button>
            </div>
          )}
          {/* Slash popover */}
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
            <button
              className="fai-attach-btn"
              title="Attach file"
              onClick={() => fileInputRef.current?.click()}
              type="button"
            >
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
