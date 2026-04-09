'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const MIN_W = 300
const MIN_H = 300
const DEFAULT_W = 380
const DEFAULT_H = 480

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  actionProposal?: { steps: { n: number; description: string }[] } | null
  confirmed?: boolean
}

interface Props {
  visible: boolean
  onClose: () => void
  tenantId: string
}

function parseActionProposal(text: string) {
  try {
    const match = text.match(/\{[\s\S]*?"type"\s*:\s*"action_proposal"[\s\S]*?\}/)
    if (!match) return null
    const parsed = JSON.parse(match[0])
    if (parsed.type === 'action_proposal' && Array.isArray(parsed.steps)) {
      return parsed as { type: string; steps: { n: number; description: string }[] }
    }
  } catch {}
  return null
}

function stripActionJson(text: string) {
  return text.replace(/\{[\s\S]*?"type"\s*:\s*"action_proposal"[\s\S]*?\}/, '').trim()
}

function getPageName(pathname: string): string {
  if (pathname === '/dashboard') return 'Dashboard'
  if (pathname.startsWith('/dashboard/jobs')) return 'Jobs'
  if (pathname.startsWith('/dashboard/calendar')) return 'Calendar'
  if (pathname.startsWith('/dashboard/insurer-orders')) return 'Insurer Orders'
  if (pathname.startsWith('/dashboard/clients')) return 'Clients'
  if (pathname.startsWith('/dashboard/scope-library')) return 'Scope Library'
  if (pathname.startsWith('/dashboard/trades')) return 'Trades'
  if (pathname.startsWith('/dashboard/finance')) return 'Finance'
  if (pathname.startsWith('/dashboard/settings')) return 'Settings'
  return pathname.split('/').filter(Boolean).pop() ?? 'Unknown page'
}

export function FloatingAssistant({ visible, onClose, tenantId }: Props) {
  const pathname = usePathname()

  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [size, setSize] = useState({ w: DEFAULT_W, h: DEFAULT_H })
  const [mounted, setMounted] = useState(false)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Drag state stored in ref to avoid stale closure in mousemove
  const dragState = useRef({ active: false, startX: 0, startY: 0, startPosX: 0, startPosY: 0 })
  // Resize state
  const resizeState = useRef({ active: false, startX: 0, startY: 0, startW: 0, startH: 0 })
  // Live pos/size refs for mouse handlers
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

  function handleDragStart(e: React.MouseEvent) {
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

  // Build context string from current route
  async function buildContext(): Promise<string> {
    // Match /dashboard/jobs/[jobId]
    const jobMatch = pathname.match(/\/dashboard\/jobs\/([^/]+)/)
    if (!jobMatch) {
      return `Current page: ${getPageName(pathname)}`
    }

    const jobId = jobMatch[1]

    // Match /quotes/[quoteId]
    const quoteMatch = pathname.match(/\/quotes\/([^/]+)/)
    // Match /reports/[reportId]
    const reportMatch = pathname.match(/\/reports\/([^/]+)/)

    try {
      if (quoteMatch) {
        const quoteId = quoteMatch[1]
        const { data: quote } = await supabase
          .from('quotes')
          .select('quote_number, status, insurer, total_amount, line_items')
          .eq('id', quoteId)
          .single()

        if (!quote) return `Current page: Quote detail (ID: ${quoteId})`

        return [
          `Current page: Quote detail`,
          `Quote number: ${(quote as any).quote_number}`,
          `Status: ${(quote as any).status}`,
          `Insurer: ${(quote as any).insurer ?? 'N/A'}`,
          `Total: $${(quote as any).total_amount ?? 0}`,
          (quote as any).line_items
            ? `Line items: ${JSON.stringify((quote as any).line_items).slice(0, 400)}`
            : '',
        ]
          .filter(Boolean)
          .join('\n')
      }

      if (reportMatch) {
        const reportId = reportMatch[1]
        const { data: report } = await supabase
          .from('reports')
          .select('report_type, status, title, created_at')
          .eq('id', reportId)
          .single()

        if (!report) return `Current page: Report detail (ID: ${reportId})`

        return [
          `Current page: Report detail`,
          `Type: ${(report as any).report_type}`,
          `Status: ${(report as any).status}`,
          `Title: ${(report as any).title ?? 'N/A'}`,
        ]
          .filter(Boolean)
          .join('\n')
      }

      // Job detail page
      const [{ data: job }, { data: quotes }, { data: actions }] = await Promise.all([
        supabase
          .from('jobs')
          .select('job_number, status, property_address, insured_name, insurer, claim_number, description')
          .eq('id', jobId)
          .single(),
        supabase
          .from('quotes')
          .select('quote_number, status, total_amount')
          .eq('job_id', jobId)
          .limit(5),
        supabase
          .from('action_queue')
          .select('title, type, priority')
          .eq('job_id', jobId)
          .eq('status', 'pending')
          .limit(10),
      ])

      if (!job) return `Current page: Job detail (ID: ${jobId})`

      const j = job as any
      const lines = [
        `Current page: Job detail`,
        `Job number: ${j.job_number}`,
        `Status: ${j.status}`,
        `Address: ${j.property_address ?? 'N/A'}`,
        `Insured: ${j.insured_name ?? 'N/A'}`,
        `Insurer: ${j.insurer ?? 'N/A'}`,
        `Claim number: ${j.claim_number ?? 'N/A'}`,
        j.description ? `Description: ${j.description}` : '',
      ]

      if (quotes && quotes.length > 0) {
        lines.push(
          `Active quotes: ${(quotes as any[]).map((q) => `${q.quote_number} (${q.status}, $${q.total_amount})`).join(', ')}`
        )
      }

      if (actions && actions.length > 0) {
        lines.push(
          `Open action items: ${(actions as any[]).map((a) => a.title).join('; ')}`
        )
      }

      return lines.filter(Boolean).join('\n')
    } catch {
      return `Current page: ${getPageName(pathname)}`
    }
  }

  async function sendMessage() {
    const val = input.trim()
    if (!val || loading) return

    const userMsg: ChatMessage = { role: 'user', content: val }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setLoading(true)

    try {
      const context = await buildContext()
      const res = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
          context,
        }),
      })
      const data = await res.json()
      const rawText: string = data.text ?? 'Sorry, I encountered an error.'
      const proposal = parseActionProposal(rawText)
      const displayText = proposal ? stripActionJson(rawText) : rawText
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: displayText, actionProposal: proposal ?? null },
      ])
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function handleTextareaInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
  }

  function confirmAction(msgIdx: number) {
    setMessages((prev) =>
      prev.map((m, i) => (i === msgIdx ? { ...m, confirmed: true } : m))
    )
  }

  function dismissProposal(msgIdx: number) {
    setMessages((prev) =>
      prev.map((m, i) => (i === msgIdx ? { ...m, actionProposal: null } : m))
    )
  }

  if (!mounted || !visible) return null

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

        .fai-action-panel { background: #fdf9f4; border: 0.5px solid #e8ddd0; border-radius: 8px; padding: 12px 14px; }
        .fai-action-panel.confirmed { background: #f0fbf5; border-color: #b8e0c8; }
        .fai-action-title { font-size: 9px; letter-spacing: 1.2px; text-transform: uppercase; color: #c8b89a; font-weight: 700; margin-bottom: 9px; }
        .fai-action-step { display: flex; gap: 8px; align-items: flex-start; padding: 5px 0; border-bottom: 0.5px solid #f0ece6; }
        .fai-action-step:last-of-type { border-bottom: none; }
        .fai-step-n { width: 15px; height: 15px; border-radius: 50%; background: #f0ece6; color: #9a8070; font-size: 8px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px; }
        .fai-step-text { font-size: 12px; color: #5a534a; line-height: 1.45; font-weight: 300; }
        .fai-action-btns { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; align-items: center; }
        .fai-btn { font-size: 11px; padding: 4px 12px; border-radius: 20px; cursor: pointer; font-family: inherit; font-weight: 600; border: 1px solid transparent; transition: all 0.15s; white-space: nowrap; line-height: 1.4; }
        .fai-btn-confirm { background: #2a6b50; color: #fff; border-color: #2a6b50; }
        .fai-btn-confirm:hover { background: #235a42; }
        .fai-btn-edit { background: transparent; color: #7a6a58; border-color: #d4cfc8; }
        .fai-btn-edit:hover { border-color: #9a7a50; color: #9a7a50; }
        .fai-btn-dismiss { background: transparent; border: none; color: #c8c0b8; font-size: 15px; padding: 2px 4px; cursor: pointer; line-height: 1; }
        .fai-btn-dismiss:hover { color: #a0524a; }

        .fai-input-wrap {
          padding: 12px 14px 14px;
          border-top: 0.5px solid #f0ece6;
          background: #fdfdfc;
          flex-shrink: 0;
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
      `}</style>

      <div
        className="fai-widget"
        style={{
          left: pos.x,
          top: pos.y,
          width: size.w,
          height: size.h,
        }}
      >
        {/* Header / drag handle */}
        <div className="fai-header" onMouseDown={handleDragStart}>
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
          <button
            className="fai-close-btn"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={onClose}
            title="Hide assistant"
          >
            &#x2715;
          </button>
        </div>

        {/* Messages */}
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
                {msg.content && (
                  <div className="fai-bubble-text">{msg.content}</div>
                )}
                {msg.actionProposal && !msg.confirmed && (
                  <div className="fai-action-panel">
                    <div className="fai-action-title">Proposed actions</div>
                    {msg.actionProposal.steps.map((step) => (
                      <div key={step.n} className="fai-action-step">
                        <div className="fai-step-n">{step.n}</div>
                        <div className="fai-step-text">{step.description}</div>
                      </div>
                    ))}
                    <div className="fai-action-btns">
                      <button className="fai-btn fai-btn-confirm" onClick={() => confirmAction(i)}>
                        Confirm &amp; execute
                      </button>
                      <button className="fai-btn fai-btn-edit">Edit steps</button>
                      <button className="fai-btn-dismiss" onClick={() => dismissProposal(i)}>
                        &#x2715;
                      </button>
                    </div>
                  </div>
                )}
                {msg.actionProposal && msg.confirmed && (
                  <div className="fai-action-panel confirmed">
                    <div className="fai-action-title">Proposed actions</div>
                    {msg.actionProposal.steps.map((step) => (
                      <div key={step.n} className="fai-action-step">
                        <div className="fai-step-n">{step.n}</div>
                        <div className="fai-step-text">{step.description}</div>
                      </div>
                    ))}
                    <div className="fai-action-btns">
                      <span style={{ fontSize: 11, color: '#2a6b50', fontWeight: 600 }}>
                        ✓ Done — actions executed
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="fai-bubble assistant">
              <div className="fai-avatar assistant">⬡</div>
              <div className="fai-bubble-inner">
                <div className="fai-bubble-text" style={{ color: '#9a9088', fontStyle: 'italic' }}>
                  Thinking…
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="fai-input-wrap">
          <div className="fai-input-row">
            <textarea
              ref={textareaRef}
              className="fai-textarea"
              placeholder="Ask anything or say what you'd like to do…"
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
