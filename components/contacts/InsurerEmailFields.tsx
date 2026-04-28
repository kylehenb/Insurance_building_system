'use client'

import React from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface InsurerEmailFieldsProps {
  orderSenderName: string
  orderSenderEmail: string
  adjusterReference: string
  adjusterSubmissionEmail?: string
  insurerSubmissionEmail?: string
  onChange: (field: string, value: string) => void
  readOnly?: boolean
}

export default function InsurerEmailFields({
  orderSenderName,
  orderSenderEmail,
  adjusterReference,
  adjusterSubmissionEmail,
  insurerSubmissionEmail,
  onChange,
  readOnly = false,
}: InsurerEmailFieldsProps) {
  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ 
        fontSize: 10, 
        fontWeight: 600, 
        color: '#9e998f', 
        textTransform: 'uppercase', 
        letterSpacing: '0.07em',
        marginBottom: 12 
      }}>
        Order Sender & Adjuster
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: 12 }}>
        <div>
          <Label style={{ fontSize: 11, color: '#b0a898', marginBottom: 4, display: 'block' }}>
            Order Sender Name
          </Label>
          <Input
            value={orderSenderName}
            onChange={e => onChange('orderSenderName', e.target.value)}
            disabled={readOnly}
            placeholder="e.g. James Hollis"
            style={{ fontSize: 13, border: '0.5px solid #e4dfd8' }}
          />
        </div>
        <div>
          <Label style={{ fontSize: 11, color: '#b0a898', marginBottom: 4, display: 'block' }}>
            Order Sender Email
          </Label>
          <Input
            type="email"
            value={orderSenderEmail}
            onChange={e => onChange('orderSenderEmail', e.target.value)}
            disabled={readOnly}
            placeholder="e.g. james.hollis@sedgwick.com"
            style={{ fontSize: 13, border: '0.5px solid #e4dfd8' }}
          />
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <Label style={{ fontSize: 11, color: '#b0a898', marginBottom: 4, display: 'block' }}>
          Adjuster Reference
        </Label>
        <Input
          value={adjusterReference}
          onChange={e => onChange('adjusterReference', e.target.value)}
          disabled={readOnly}
          placeholder="Adjuster's own reference/claim number"
          style={{ fontSize: 13, border: '0.5px solid #e4dfd8' }}
        />
      </div>

      {/* Read-only submission email fields */}
      {(adjusterSubmissionEmail || insurerSubmissionEmail) && (
        <div style={{ 
          marginTop: 16, 
          padding: '12px', 
          background: '#faf9f7', 
          border: '0.5px solid #e4dfd8', 
          borderRadius: 6 
        }}>
          <div style={{ 
            fontSize: 9, 
            fontWeight: 600, 
            color: '#b0a898', 
            textTransform: 'uppercase', 
            letterSpacing: '0.06em',
            marginBottom: 8 
          }}>
            Submission Emails (from client config)
          </div>

          {adjusterSubmissionEmail && (
            <div style={{ marginBottom: 8 }}>
              <Label style={{ fontSize: 11, color: '#b0a898', marginBottom: 4, display: 'block' }}>
                Adjuster Firm Submission Email
              </Label>
              <Input
                value={adjusterSubmissionEmail}
                disabled
                style={{ 
                  fontSize: 13, 
                  border: '0.5px solid #e4dfd8',
                  background: '#f5f2ee',
                  color: '#6b6763',
                }}
              />
            </div>
          )}

          {insurerSubmissionEmail && (
            <div>
              <Label style={{ fontSize: 11, color: '#b0a898', marginBottom: 4, display: 'block' }}>
                Insurer Submission Email
              </Label>
              <Input
                value={insurerSubmissionEmail}
                disabled
                style={{ 
                  fontSize: 13, 
                  border: '0.5px solid #e4dfd8',
                  background: '#f5f2ee',
                  color: '#6b6763',
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
