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
  hideInsured?: boolean
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

export default function ContactsEditor({ contacts, onChange, readOnly = false, hideInsured = false }: ContactsEditorProps) {
  const [localContacts, setLocalContacts] = useState<JobContact[]>(contacts)
  const [showAdditional1, setShowAdditional1] = useState(hideInsured)
  const [showAdditional2, setShowAdditional2] = useState(false)

  useEffect(() => {
    setLocalContacts(contacts)
    // Show additional slots if they have data
    setShowAdditional1(contacts.some(c => c.slot === 'additional_1') || hideInsured)
    setShowAdditional2(contacts.some(c => c.slot === 'additional_2'))
  }, [contacts, hideInsured])

  // Ensure insured always has auth and primary_site roles
  useEffect(() => {
    const insured = localContacts.find(c => c.slot === 'insured')
    if (insured) {
      const hasAuth = insured.roles.includes('auth')
      const hasPrimarySite = insured.roles.includes('primary_site')
      
      // Check if any other contact has these roles
      const otherHasAuth = localContacts.some(c => c.slot !== 'insured' && c.roles.includes('auth'))
      const otherHasPrimarySite = localContacts.some(c => c.slot !== 'insured' && c.roles.includes('primary_site'))
      
      // If no other contact has these roles, ensure insured has them
      if (!otherHasAuth && !hasAuth) {
        updateContact(localContacts.findIndex(c => c.slot === 'insured'), { roles: [...insured.roles, 'auth'] })
      }
      if (!otherHasPrimarySite && !hasPrimarySite) {
        updateContact(localContacts.findIndex(c => c.slot === 'insured'), { roles: [...insured.roles, 'primary_site'] })
      }
    }
  }, [localContacts])

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
      // Remove role - if it's auth or primary_site and being removed from insured, keep it on insured
      if ((role === 'auth' || role === 'primary_site') && contact.slot === 'insured') {
        // Don't allow removing these from insured if no one else has them
        const otherHasRole = localContacts.some((c, i) => i !== contactIndex && c.roles.includes(role))
        if (!otherHasRole) return // Can't remove - must be assigned to someone
      }
      newRoles = contact.roles.filter(r => r !== role)
    } else {
      // Add role - if exclusive, remove from other contacts first (role stealing)
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
      setLocalContacts(withDefaults)
      onChange(withDefaults)
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

      {/* Insured contact */}
      {!hideInsured && (
        <div style={{ borderBottom: '0.5px solid #f0ece6', paddingBottom: 16, marginBottom: 16 }}>
          <div style={{ 
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 12 
          }}>
            <div style={{ 
              fontSize: 10, 
              fontWeight: 600, 
              color: '#9e998f', 
              textTransform: 'uppercase', 
              letterSpacing: '0.07em'
            }}>
              Insured
            </div>
            {/* Role checkboxes */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              {(['auth', 'primary_site'] as ContactRole[]).map(role => {
                const contact = localContacts.find(c => c.slot === 'insured')
                const hasRole = contact?.roles.includes(role)
                return (
                  <label key={role} style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 4, 
                    fontSize: 11, 
                    color: '#7a6a58',
                    cursor: readOnly ? 'default' : 'pointer'
                  }}>
                    <input
                      type="checkbox"
                      checked={hasRole}
                      onChange={() => !readOnly && toggleRole(localContacts.findIndex(c => c.slot === 'insured'), role)}
                      disabled={readOnly}
                      style={{ accentColor: '#c8b89a' }}
                    />
                    {ROLE_LABELS[role]}
                  </label>
                )
              })}
            </div>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
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
        </div>
      )}

      {/* Additional contact 1 */}
      {showAdditional1 && (
        <div style={{ borderBottom: '0.5px solid #f0ece6', paddingBottom: 16, marginBottom: 16 }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            marginBottom: 12 
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ 
                fontSize: 10, 
                fontWeight: 600, 
                color: '#9e998f', 
                textTransform: 'uppercase', 
                letterSpacing: '0.07em' 
              }}>
                {localContacts.find(c => c.slot === 'additional_1')?.type 
                  ? ADDITIONAL_CONTACT_TYPES.find(t => t.value === localContacts.find(c => c.slot === 'additional_1')?.type)?.label || 'Additional Contact 1'
                  : 'Additional Contact 1'}
              </div>
              {/* Role checkboxes */}
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                {(['auth', 'primary_site', 'secondary_site'] as ContactRole[]).map(role => {
                  const contact = localContacts.find(c => c.slot === 'additional_1')
                  const hasRole = contact?.roles.includes(role)
                  return (
                    <label key={role} style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 4, 
                      fontSize: 11, 
                      color: '#7a6a58',
                      cursor: readOnly ? 'default' : 'pointer'
                    }}>
                      <input
                        type="checkbox"
                        checked={hasRole}
                        onChange={() => !readOnly && toggleRole(localContacts.findIndex(c => c.slot === 'additional_1'), role)}
                        disabled={readOnly}
                        style={{ accentColor: '#c8b89a' }}
                      />
                      {ROLE_LABELS[role]}
                    </label>
                  )
                })}
              </div>
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
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
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
        </div>
      )}

      {/* Additional contact 2 */}
      {showAdditional2 && (
        <div style={{ borderBottom: '0.5px solid #f0ece6', paddingBottom: 16, marginBottom: 16 }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            marginBottom: 12 
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ 
                fontSize: 10, 
                fontWeight: 600, 
                color: '#9e998f', 
                textTransform: 'uppercase', 
                letterSpacing: '0.07em' 
              }}>
                {localContacts.find(c => c.slot === 'additional_2')?.type 
                  ? ADDITIONAL_CONTACT_TYPES.find(t => t.value === localContacts.find(c => c.slot === 'additional_2')?.type)?.label || 'Additional Contact 2'
                  : 'Additional Contact 2'}
              </div>
              {/* Role checkboxes */}
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                {(['auth', 'primary_site', 'secondary_site'] as ContactRole[]).map(role => {
                  const contact = localContacts.find(c => c.slot === 'additional_2')
                  const hasRole = contact?.roles.includes(role)
                  return (
                    <label key={role} style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 4, 
                      fontSize: 11, 
                      color: '#7a6a58',
                      cursor: readOnly ? 'default' : 'pointer'
                    }}>
                      <input
                        type="checkbox"
                        checked={hasRole}
                        onChange={() => !readOnly && toggleRole(localContacts.findIndex(c => c.slot === 'additional_2'), role)}
                        disabled={readOnly}
                        style={{ accentColor: '#c8b89a' }}
                      />
                      {ROLE_LABELS[role]}
                    </label>
                  )
                })}
              </div>
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
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
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
        </div>
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
