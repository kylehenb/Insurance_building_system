'use client'

import React, { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { JobContact, ContactRole, AdditionalContactType } from '@/lib/types/contacts'
import { applyContactDefaults, getContactsByRole } from '@/lib/contacts/defaults'

interface ContactsEditorProps {
  contacts: JobContact[]
  onChange: (contacts: JobContact[]) => void
  readOnly?: boolean
}

const ROLE_LABELS: Record<ContactRole, string> = {
  insured: 'Insured',
  auth: 'Auth',
  primary_site: 'Primary Site',
  secondary_site: 'Secondary Site',
  broker: 'Broker',
  real_estate: 'Real Estate',
}

const ADDITIONAL_CONTACT_TYPES: { value: AdditionalContactType; label: string }[] = [
  { value: 'tenant', label: 'Tenant' },
  { value: 'real_estate', label: 'Real Estate Agent' },
  { value: 'property_manager', label: 'Property Manager' },
  { value: 'broker', label: 'Broker' },
  { value: 'owner', label: 'Owner' },
  { value: 'other', label: 'Other' },
]

const EXCLUSIVE_ROLES: ContactRole[] = ['auth', 'primary_site', 'secondary_site']

export default function ContactsEditor({ contacts, onChange, readOnly = false }: ContactsEditorProps) {
  const [localContacts, setLocalContacts] = useState<JobContact[]>(contacts)
  const [showAdditional1, setShowAdditional1] = useState(false)
  const [showAdditional2, setShowAdditional2] = useState(false)
  const [showNotice, setShowNotice] = useState(false)

  useEffect(() => {
    setLocalContacts(contacts)
    // Show additional slots if they have data
    setShowAdditional1(contacts.some(c => c.slot === 'additional_1'))
    setShowAdditional2(contacts.some(c => c.slot === 'additional_2'))
  }, [contacts])

  // Validation
  const hasAuth = localContacts.some(c => c.roles.includes('auth'))
  const hasPrimarySite = localContacts.some(c => c.roles.includes('primary_site'))

  function updateContact(index: number, updates: Partial<JobContact>) {
    const updated = [...localContacts]
    updated[index] = { ...updated[index], ...updates }
    const withDefaults = applyContactDefaults(updated)
    setLocalContacts(withDefaults)
    onChange(withDefaults)
  }

  function toggleRole(contactIndex: number, role: ContactRole) {
    const contact = localContacts[contactIndex]
    
    // Insured role is locked to insured slot
    if (role === 'insured' && contact.slot !== 'insured') return
    if (role === 'insured' && contact.slot === 'insured') return // Can't remove insured role from insured slot

    const hasRole = contact.roles.includes(role)
    let newRoles: ContactRole[]

    if (hasRole) {
      // Remove role
      newRoles = contact.roles.filter(r => r !== role)
    } else {
      // Add role - if exclusive, remove from other contacts first
      if (EXCLUSIVE_ROLES.includes(role)) {
        const updated = localContacts.map((c, i) => {
          if (i === contactIndex) return c
          return { ...c, roles: c.roles.filter(r => r !== role) }
        })
        setLocalContacts(updated)
        newRoles = [...contact.roles, role]
      } else {
        newRoles = [...contact.roles, role]
      }
    }

    updateContact(contactIndex, { roles: newRoles })
  }

  function addAdditionalContact() {
    if (!showAdditional1) {
      setShowAdditional1(true)
      const newContact: JobContact = {
        slot: 'additional_1',
        name: '',
        phone: '',
        email: '',
        roles: [],
      }
      const updated = [...localContacts, newContact]
      const withDefaults = applyContactDefaults(updated)
      
      // Check if we need to show the notice (insured had auto-assigned primary_site)
      const insured = withDefaults.find(c => c.slot === 'insured')
      if (insured && insured.roles.includes('primary_site') && withDefaults.length > 1) {
        // Clear primary_site from insured
        const cleared = withDefaults.map(c => 
          c.slot === 'insured' 
            ? { ...c, roles: c.roles.filter(r => r !== 'primary_site') }
            : c
        )
        setLocalContacts(cleared)
        onChange(cleared)
        setShowNotice(true)
      } else {
        setLocalContacts(withDefaults)
        onChange(withDefaults)
      }
    } else if (!showAdditional2) {
      setShowAdditional2(true)
      const newContact: JobContact = {
        slot: 'additional_2',
        name: '',
        phone: '',
        email: '',
        roles: [],
      }
      const updated = [...localContacts, newContact]
      const withDefaults = applyContactDefaults(updated)
      setLocalContacts(withDefaults)
      onChange(withDefaults)
    }
  }

  function removeAdditionalContact(slot: 'additional_1' | 'additional_2') {
    const updated = localContacts.filter(c => c.slot !== slot)
    const withDefaults = applyContactDefaults(updated)
    setLocalContacts(withDefaults)
    onChange(withDefaults)
    
    if (slot === 'additional_1') setShowAdditional1(false)
    if (slot === 'additional_2') setShowAdditional2(false)
  }

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif" }}>
      {/* Validation warnings */}
      <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {!hasAuth && (
          <Badge variant="destructive" style={{ fontSize: 11 }}>
            Warning: No Auth contact assigned
          </Badge>
        )}
        {!hasPrimarySite && (
          <Badge variant="destructive" style={{ fontSize: 11 }}>
            Warning: No Primary Site contact assigned
          </Badge>
        )}
      </div>

      {/* Inline notice */}
      {showNotice && (
        <div style={{
          background: '#fef3c7',
          border: '0.5px solid #f59e0b',
          borderRadius: 6,
          padding: '8px 12px',
          marginBottom: 12,
          fontSize: 12,
          color: '#92400e',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <span>Confirm who is the primary site contact</span>
          <button
            onClick={() => setShowNotice(false)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#92400e', padding: 0, lineHeight: 1 }}
          >
            ×
          </button>
        </div>
      )}

      {/* Insured contact card */}
      <Card style={{ marginBottom: 12, border: '0.5px solid #e4dfd8' }}>
        <CardContent style={{ padding: '16px' }}>
          <div style={{ 
            fontSize: 10, 
            fontWeight: 600, 
            color: '#9e998f', 
            textTransform: 'uppercase', 
            letterSpacing: '0.07em',
            marginBottom: 12 
          }}>
            Insured
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: 12 }}>
            <div>
              <Label style={{ fontSize: 11, color: '#b0a898', marginBottom: 4, display: 'block' }}>Name</Label>
              <Input
                value={localContacts.find(c => c.slot === 'insured')?.name || ''}
                onChange={e => {
                  const idx = localContacts.findIndex(c => c.slot === 'insured')
                  if (idx !== -1) updateContact(idx, { name: e.target.value })
                }}
                disabled={readOnly}
                style={{ fontSize: 13, border: '0.5px solid #e4dfd8' }}
              />
            </div>
            <div>
              <Label style={{ fontSize: 11, color: '#b0a898', marginBottom: 4, display: 'block' }}>Phone</Label>
              <Input
                value={localContacts.find(c => c.slot === 'insured')?.phone || ''}
                onChange={e => {
                  const idx = localContacts.findIndex(c => c.slot === 'insured')
                  if (idx !== -1) updateContact(idx, { phone: e.target.value })
                }}
                disabled={readOnly}
                style={{ fontSize: 13, border: '0.5px solid #e4dfd8' }}
              />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <Label style={{ fontSize: 11, color: '#b0a898', marginBottom: 4, display: 'block' }}>Email</Label>
              <Input
                type="email"
                value={localContacts.find(c => c.slot === 'insured')?.email || ''}
                onChange={e => {
                  const idx = localContacts.findIndex(c => c.slot === 'insured')
                  if (idx !== -1) updateContact(idx, { email: e.target.value })
                }}
                disabled={readOnly}
                style={{ fontSize: 13, border: '0.5px solid #e4dfd8' }}
              />
            </div>
          </div>

          {/* Role pills */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {Object.entries(ROLE_LABELS).map(([role, label]) => {
              const contact = localContacts.find(c => c.slot === 'insured')
              const hasRole = contact?.roles.includes(role as ContactRole)
              const isLocked = role === 'insured'
              
              return (
                <Badge
                  key={role}
                  variant={hasRole ? 'default' : 'outline'}
                  style={{
                    fontSize: 11,
                    cursor: readOnly || isLocked ? 'default' : 'pointer',
                    opacity: isLocked ? 0.7 : 1,
                    background: hasRole ? '#1a1a1a' : 'transparent',
                    color: hasRole ? '#f5f2ee' : '#6b6763',
                    border: hasRole ? 'none' : '0.5px solid #e4dfd8',
                  }}
                  onClick={() => !readOnly && !isLocked && toggleRole(localContacts.findIndex(c => c.slot === 'insured'), role as ContactRole)}
                >
                  {label}
                  {isLocked && ' (locked)'}
                </Badge>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Additional contact 1 */}
      {showAdditional1 && (
        <Card style={{ marginBottom: 12, border: '0.5px solid #e4dfd8' }}>
          <CardContent style={{ padding: '16px' }}>
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              marginBottom: 12 
            }}>
              <div style={{ 
                fontSize: 10, 
                fontWeight: 600, 
                color: '#9e998f', 
                textTransform: 'uppercase', 
                letterSpacing: '0.07em' 
              }}>
                Additional Contact 1
              </div>
              {!readOnly && (
                <button
                  onClick={() => removeAdditionalContact('additional_1')}
                  style={{ 
                    background: 'none', 
                    border: 'none', 
                    cursor: 'pointer', 
                    fontSize: 18, 
                    color: '#b0a898',
                    padding: 0,
                    lineHeight: 1 
                  }}
                >
                  ×
                </button>
              )}
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: 12 }}>
              <div>
                <Label style={{ fontSize: 11, color: '#b0a898', marginBottom: 4, display: 'block' }}>Contact Type</Label>
                <Select
                  value={localContacts.find(c => c.slot === 'additional_1')?.type || ''}
                  onValueChange={(value) => {
                    const idx = localContacts.findIndex(c => c.slot === 'additional_1')
                    if (idx !== -1) updateContact(idx, { type: value as AdditionalContactType })
                  }}
                  disabled={readOnly}
                >
                  <SelectTrigger style={{ fontSize: 13, border: '0.5px solid #e4dfd8' }}>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {ADDITIONAL_CONTACT_TYPES.map(type => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label style={{ fontSize: 11, color: '#b0a898', marginBottom: 4, display: 'block' }}>Name</Label>
                <Input
                  value={localContacts.find(c => c.slot === 'additional_1')?.name || ''}
                  onChange={e => {
                    const idx = localContacts.findIndex(c => c.slot === 'additional_1')
                    if (idx !== -1) updateContact(idx, { name: e.target.value })
                  }}
                  disabled={readOnly}
                  style={{ fontSize: 13, border: '0.5px solid #e4dfd8' }}
                />
              </div>
              <div>
                <Label style={{ fontSize: 11, color: '#b0a898', marginBottom: 4, display: 'block' }}>Phone</Label>
                <Input
                  value={localContacts.find(c => c.slot === 'additional_1')?.phone || ''}
                  onChange={e => {
                    const idx = localContacts.findIndex(c => c.slot === 'additional_1')
                    if (idx !== -1) updateContact(idx, { phone: e.target.value })
                  }}
                  disabled={readOnly}
                  style={{ fontSize: 13, border: '0.5px solid #e4dfd8' }}
                />
              </div>
              <div>
                <Label style={{ fontSize: 11, color: '#b0a898', marginBottom: 4, display: 'block' }}>Email</Label>
                <Input
                  type="email"
                  value={localContacts.find(c => c.slot === 'additional_1')?.email || ''}
                  onChange={e => {
                    const idx = localContacts.findIndex(c => c.slot === 'additional_1')
                    if (idx !== -1) updateContact(idx, { email: e.target.value })
                  }}
                  disabled={readOnly}
                  style={{ fontSize: 13, border: '0.5px solid #e4dfd8' }}
                />
              </div>
            </div>

            {/* Role pills */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {Object.entries(ROLE_LABELS).map(([role, label]) => {
                const contact = localContacts.find(c => c.slot === 'additional_1')
                const hasRole = contact?.roles.includes(role as ContactRole)
                const isLocked = role === 'insured'
                
                return (
                  <Badge
                    key={role}
                    variant={hasRole ? 'default' : 'outline'}
                    style={{
                      fontSize: 11,
                      cursor: readOnly || isLocked ? 'default' : 'pointer',
                      opacity: isLocked ? 0.5 : 1,
                      background: hasRole ? '#1a1a1a' : 'transparent',
                      color: hasRole ? '#f5f2ee' : '#6b6763',
                      border: hasRole ? 'none' : '0.5px solid #e4dfd8',
                    }}
                    onClick={() => !readOnly && !isLocked && toggleRole(localContacts.findIndex(c => c.slot === 'additional_1'), role as ContactRole)}
                  >
                    {label}
                  </Badge>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Additional contact 2 */}
      {showAdditional2 && (
        <Card style={{ marginBottom: 12, border: '0.5px solid #e4dfd8' }}>
          <CardContent style={{ padding: '16px' }}>
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              marginBottom: 12 
            }}>
              <div style={{ 
                fontSize: 10, 
                fontWeight: 600, 
                color: '#9e998f', 
                textTransform: 'uppercase', 
                letterSpacing: '0.07em' 
              }}>
                Additional Contact 2
              </div>
              {!readOnly && (
                <button
                  onClick={() => removeAdditionalContact('additional_2')}
                  style={{ 
                    background: 'none', 
                    border: 'none', 
                    cursor: 'pointer', 
                    fontSize: 18, 
                    color: '#b0a898',
                    padding: 0,
                    lineHeight: 1 
                  }}
                >
                  ×
                </button>
              )}
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: 12 }}>
              <div>
                <Label style={{ fontSize: 11, color: '#b0a898', marginBottom: 4, display: 'block' }}>Contact Type</Label>
                <Select
                  value={localContacts.find(c => c.slot === 'additional_2')?.type || ''}
                  onValueChange={(value) => {
                    const idx = localContacts.findIndex(c => c.slot === 'additional_2')
                    if (idx !== -1) updateContact(idx, { type: value as AdditionalContactType })
                  }}
                  disabled={readOnly}
                >
                  <SelectTrigger style={{ fontSize: 13, border: '0.5px solid #e4dfd8' }}>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {ADDITIONAL_CONTACT_TYPES.map(type => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label style={{ fontSize: 11, color: '#b0a898', marginBottom: 4, display: 'block' }}>Name</Label>
                <Input
                  value={localContacts.find(c => c.slot === 'additional_2')?.name || ''}
                  onChange={e => {
                    const idx = localContacts.findIndex(c => c.slot === 'additional_2')
                    if (idx !== -1) updateContact(idx, { name: e.target.value })
                  }}
                  disabled={readOnly}
                  style={{ fontSize: 13, border: '0.5px solid #e4dfd8' }}
                />
              </div>
              <div>
                <Label style={{ fontSize: 11, color: '#b0a898', marginBottom: 4, display: 'block' }}>Phone</Label>
                <Input
                  value={localContacts.find(c => c.slot === 'additional_2')?.phone || ''}
                  onChange={e => {
                    const idx = localContacts.findIndex(c => c.slot === 'additional_2')
                    if (idx !== -1) updateContact(idx, { phone: e.target.value })
                  }}
                  disabled={readOnly}
                  style={{ fontSize: 13, border: '0.5px solid #e4dfd8' }}
                />
              </div>
              <div>
                <Label style={{ fontSize: 11, color: '#b0a898', marginBottom: 4, display: 'block' }}>Email</Label>
                <Input
                  type="email"
                  value={localContacts.find(c => c.slot === 'additional_2')?.email || ''}
                  onChange={e => {
                    const idx = localContacts.findIndex(c => c.slot === 'additional_2')
                    if (idx !== -1) updateContact(idx, { email: e.target.value })
                  }}
                  disabled={readOnly}
                  style={{ fontSize: 13, border: '0.5px solid #e4dfd8' }}
                />
              </div>
            </div>

            {/* Role pills */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {Object.entries(ROLE_LABELS).map(([role, label]) => {
                const contact = localContacts.find(c => c.slot === 'additional_2')
                const hasRole = contact?.roles.includes(role as ContactRole)
                const isLocked = role === 'insured'
                
                return (
                  <Badge
                    key={role}
                    variant={hasRole ? 'default' : 'outline'}
                    style={{
                      fontSize: 11,
                      cursor: readOnly || isLocked ? 'default' : 'pointer',
                      opacity: isLocked ? 0.5 : 1,
                      background: hasRole ? '#1a1a1a' : 'transparent',
                      color: hasRole ? '#f5f2ee' : '#6b6763',
                      border: hasRole ? 'none' : '0.5px solid #e4dfd8',
                    }}
                    onClick={() => !readOnly && !isLocked && toggleRole(localContacts.findIndex(c => c.slot === 'additional_2'), role as ContactRole)}
                  >
                    {label}
                  </Badge>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Add Contact button */}
      {!readOnly && !showAdditional2 && (
        <Button
          variant="outline"
          onClick={addAdditionalContact}
          style={{
            width: '100%',
            border: '0.5px dashed #c8b89a',
            color: '#7a6a58',
            fontSize: 12,
          }}
        >
          + Add Contact
        </Button>
      )}
    </div>
  )
}
