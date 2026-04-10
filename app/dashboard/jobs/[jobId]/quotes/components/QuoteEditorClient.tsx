'use client'

import React, { useCallback, useState } from 'react'
import Link from 'next/link'
import { useQuote } from '../hooks/useQuote'
import { useScopeLibrary } from '../hooks/useScopeLibrary'
import { QuoteHeader } from './QuoteHeader'
import { RoomSection } from './RoomSection'
import { QuoteFooter } from './QuoteFooter'

interface JobInfo {
  job_number: string
  insurer: string | null
  insured_name: string | null
  property_address: string | null
}

interface QuoteEditorClientProps {
  jobId: string
  quoteId: string
  tenantId: string
  job: JobInfo
  inline?: boolean
}

export function QuoteEditorClient({ jobId, quoteId, tenantId, job, inline }: QuoteEditorClientProps) {
  const {
    quote,
    rooms,
    loading,
    error,
    saveStatus,
    subtotal,
    markup,
    gst,
    total,
    updateItemLocal,
    addItem,
    deleteItem,
    updateRoomDimensions,
    renameRoom,
    updateQuoteMeta,
  } = useQuote({ quoteId, tenantId })

  const { search } = useScopeLibrary({ tenantId, insurer: job.insurer })

  // Local-only rooms (added but no items yet)
  const [pendingRooms, setPendingRooms] = useState<string[]>([])

  const handleAddItem = useCallback(
    async (room: string) => {
      const item = await addItem(room)
      if (item) {
        // Remove from pendingRooms if it was there
        setPendingRooms(prev => prev.filter(r => r !== room))
      }
    },
    [addItem]
  )

  const handleDeleteItem = useCallback(
    async (itemId: string) => {
      await deleteItem(itemId)
    },
    [deleteItem]
  )

  const handleDeleteRoom = useCallback(
    (room: string) => {
      // If pending room (no items), just remove from local state
      setPendingRooms(prev => prev.filter(r => r !== room))
    },
    []
  )

  const handleAddRoom = useCallback(() => {
    const name = `Room ${rooms.length + pendingRooms.length + 1}`
    setPendingRooms(prev => [...prev, name])
  }, [rooms.length, pendingRooms.length])

  const handleRenamePendingRoom = useCallback((oldName: string, newName: string) => {
    if (!newName.trim() || newName === oldName) return
    setPendingRooms(prev => prev.map(r => (r === oldName ? newName.trim() : r)))
  }, [])

  const isLocked = quote?.is_locked ?? false

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 200,
          fontFamily: 'DM Sans, sans-serif',
          fontSize: 13,
          color: '#9e998f',
        }}
      >
        Loading quote…
      </div>
    )
  }

  if (error || !quote) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: 200,
          gap: 12,
          fontFamily: 'DM Sans, sans-serif',
        }}
      >
        <p style={{ fontSize: 13, color: '#c5221f' }}>{error ?? 'Quote not found'}</p>
        <Link
          href={`/dashboard/jobs/${jobId}?tab=quotes`}
          style={{ fontSize: 12, color: '#9e998f' }}
        >
          ← Back to quotes
        </Link>
      </div>
    )
  }

  return (
    <div
      style={{
        background: '#f5f2ee',
        minHeight: '100%',
        fontFamily: 'DM Sans, sans-serif',
      }}
    >
      {/* Top nav bar — hidden in inline accordion mode */}
      {!inline && (
        <div
          style={{
            background: '#ffffff',
            borderBottom: '1px solid #e0dbd4',
            padding: '8px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <Link
            href={`/dashboard/jobs/${jobId}?tab=quotes`}
            style={{
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 12,
              color: '#9e998f',
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            ← {job.job_number}
          </Link>
          <span style={{ color: '#e0dbd4', fontSize: 12 }}>/</span>
          <span style={{ fontSize: 12, color: '#3a3530' }}>
            {quote.quote_ref ?? 'Quote'}
          </span>
        </div>
      )}

      {/* Quote header */}
      <QuoteHeader quote={quote} total={total} insurer={job.insurer} />

      {/* Content */}
      <div style={{ background: '#f5f2ee' }}>
        {/* Rooms with items */}
        {rooms.map(room => (
          <RoomSection
            key={room.name}
            name={room.name}
            items={room.items}
            onUpdateItem={updateItemLocal}
            onDeleteItem={handleDeleteItem}
            onAddItem={handleAddItem}
            onUpdateDimensions={updateRoomDimensions}
            onRenameRoom={renameRoom}
            onDeleteRoom={() => {
              if (!window.confirm(`Delete room "${room.name}" and all items?`)) return
              room.items.forEach(i => deleteItem(i.id))
            }}
            search={search}
            isLocked={isLocked}
            insurer={job.insurer}
          />
        ))}

        {/* Pending rooms (added locally, no items yet) */}
        {pendingRooms.map(roomName => (
          <RoomSection
            key={`pending-${roomName}`}
            name={roomName}
            items={[]}
            onUpdateItem={updateItemLocal}
            onDeleteItem={handleDeleteItem}
            onAddItem={handleAddItem}
            onUpdateDimensions={() => {}}
            onRenameRoom={handleRenamePendingRoom}
            onDeleteRoom={() => handleDeleteRoom(roomName)}
            search={search}
            isLocked={isLocked}
            insurer={job.insurer}
          />
        ))}

        {/* Add room */}
        {!isLocked && (
          <div style={{ padding: '14px 16px' }}>
            <button
              onClick={handleAddRoom}
              style={{
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 13,
                color: '#9e998f',
                background: '#ffffff',
                border: '1px solid #e0dbd4',
                borderRadius: 6,
                padding: '8px 18px',
                cursor: 'pointer',
                transition: 'border-color 0.15s, color 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = '#c8b89a'
                e.currentTarget.style.color = '#3a3530'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = '#e0dbd4'
                e.currentTarget.style.color = '#9e998f'
              }}
            >
              + Add New Room
            </button>
          </div>
        )}
      </div>

      {/* Footer totals */}
      <QuoteFooter
        quote={quote}
        subtotal={subtotal}
        markup={markup}
        gst={gst}
        total={total}
        onUpdateMarkup={pct => updateQuoteMeta({ markup_pct: pct })}
        isLocked={isLocked}
        saveStatus={saveStatus}
      />
    </div>
  )
}
