'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

type JobType = 'insurance' | 'private'

const FIELD_STYLE: React.CSSProperties = {
  fontSize: 13,
  color: '#1a1a1a',
  border: '0.5px solid #e4dfd8',
  borderRadius: 5,
  padding: '7px 10px',
  background: '#fdfcfb',
  fontFamily: 'inherit',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
  transition: 'border-color 0.15s',
}

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: '#9e998f',
  fontWeight: 600,
  marginBottom: 5,
  display: 'block',
}

function Field({
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string
  type?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  required?: boolean
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={LABEL_STYLE}>
        {label}
        {required && <span style={{ color: '#c85a4a', marginLeft: 3 }}>*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        style={FIELD_STYLE}
        onFocus={e => ((e.target as HTMLInputElement).style.borderColor = '#c8b89a')}
        onBlur={e => ((e.target as HTMLInputElement).style.borderColor = '#e4dfd8')}
      />
    </div>
  )
}

function TextareaField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={LABEL_STYLE}>{label}</label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        style={{ ...FIELD_STYLE, resize: 'vertical', lineHeight: 1.6 }}
        onFocus={e => ((e.target as HTMLTextAreaElement).style.borderColor = '#c8b89a')}
        onBlur={e => ((e.target as HTMLTextAreaElement).style.borderColor = '#e4dfd8')}
      />
    </div>
  )
}

export default function NewJobPage() {
  const router = useRouter()
  const [jobType, setJobType] = useState<JobType>('insurance')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Shared fields
  const [insuredName, setInsuredName] = useState('')
  const [insuredPhone, setInsuredPhone] = useState('')
  const [insuredEmail, setInsuredEmail] = useState('')
  const [propertyAddress, setPropertyAddress] = useState('')
  const [notes, setNotes] = useState('')

  // Insurance-only fields
  const [insurer, setInsurer] = useState('')
  const [invoiceTo, setInvoiceTo] = useState('')
  const [claimNumber, setClaimNumber] = useState('')
  const [adjuster, setAdjuster] = useState('')
  const [adjusterRef, setAdjusterRef] = useState('')
  const [lossType, setLossType] = useState('')
  const [dateOfLoss, setDateOfLoss] = useState('')
  const [claimDescription, setClaimDescription] = useState('')
  const [specialInstructions, setSpecialInstructions] = useState('')
  const [sumInsured, setSumInsured] = useState('')
  const [excess, setExcess] = useState('')

  // Private-only field
  const [workDescription, setWorkDescription] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!insuredName.trim() || !propertyAddress.trim()) return
    setSubmitting(true)
    setError(null)

    const body =
      jobType === 'private'
        ? {
            job_type: 'private',
            insured_name: insuredName,
            insured_phone: insuredPhone,
            insured_email: insuredEmail,
            property_address: propertyAddress,
            insurer: insuredName,
            invoice_to: insuredName,
            claim_description: workDescription,
            notes,
          }
        : {
            job_type: 'insurance',
            insured_name: insuredName,
            insured_phone: insuredPhone,
            insured_email: insuredEmail,
            property_address: propertyAddress,
            insurer,
            invoice_to: invoiceTo,
            claim_number: claimNumber,
            adjuster,
            adjuster_reference: adjusterRef,
            loss_type: lossType,
            date_of_loss: dateOfLoss,
            claim_description: claimDescription,
            special_instructions: specialInstructions,
            sum_insured: sumInsured,
            excess,
            notes,
          }

    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Failed to create job')
        setSubmitting(false)
        return
      }
      router.push(`/dashboard/jobs/${json.id}`)
    } catch {
      setError('Unexpected error — please try again')
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{
        fontFamily: 'DM Sans, sans-serif',
        minHeight: '100vh',
        background: '#faf9f7',
        padding: '32px 24px',
      }}
    >
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        {/* Back link */}
        <Link
          href="/dashboard/jobs"
          style={{ fontSize: 13, color: '#9e998f', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 24 }}
        >
          ← Jobs
        </Link>

        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1a1a1a', marginBottom: 6, letterSpacing: -0.5 }}>
          New Job
        </h1>
        <p style={{ fontSize: 13, color: '#9e998f', marginBottom: 28 }}>
          Create a job manually. Insurance jobs come from insurer orders; use this for private homeowner work.
        </p>

        {/* Job type toggle */}
        <div
          style={{
            display: 'flex',
            gap: 0,
            background: '#fff',
            border: '0.5px solid #e4dfd8',
            borderRadius: 8,
            padding: 4,
            marginBottom: 28,
            width: 'fit-content',
          }}
        >
          {(['insurance', 'private'] as JobType[]).map(type => (
            <button
              key={type}
              type="button"
              onClick={() => setJobType(type)}
              style={{
                padding: '7px 20px',
                borderRadius: 6,
                border: 'none',
                fontSize: 13,
                fontWeight: 600,
                fontFamily: 'inherit',
                cursor: 'pointer',
                transition: 'all 0.15s',
                background: jobType === type ? '#1a1a1a' : 'transparent',
                color: jobType === type ? '#f5f0e8' : '#9e998f',
              }}
            >
              {type === 'insurance' ? 'Insurance' : 'Private / Homeowner'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          <div
            style={{
              background: '#fff',
              border: '0.5px solid #e4dfd8',
              borderRadius: 8,
              padding: '24px',
              marginBottom: 16,
            }}
          >
            {/* Private mode notice */}
            {jobType === 'private' && (
              <div
                style={{
                  background: '#faf5ee',
                  border: '0.5px solid #e8ddd0',
                  borderRadius: 6,
                  padding: '10px 14px',
                  marginBottom: 20,
                  fontSize: 12,
                  color: '#7a6040',
                  lineHeight: 1.5,
                }}
              >
                Quotes and invoices will be addressed to the homeowner&apos;s name.
              </div>
            )}

            {/* Homeowner / Insured section */}
            <div
              style={{
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.07em',
                color: '#9e998f',
                fontWeight: 600,
                marginBottom: 14,
              }}
            >
              {jobType === 'private' ? 'Homeowner' : 'Insured'}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}>
              <Field
                label="Name"
                value={insuredName}
                onChange={setInsuredName}
                placeholder={jobType === 'private' ? 'Full name' : 'Insured name'}
                required
              />
              <Field
                label="Phone"
                type="tel"
                value={insuredPhone}
                onChange={setInsuredPhone}
                placeholder="04xx xxx xxx"
              />
              <Field
                label="Email"
                type="email"
                value={insuredEmail}
                onChange={setInsuredEmail}
                placeholder="email@example.com"
              />
            </div>

            <Field
              label="Property Address"
              value={propertyAddress}
              onChange={setPropertyAddress}
              placeholder="123 Example St, Suburb VIC 3000"
              required
            />

            {/* Insurance-specific fields */}
            {jobType === 'insurance' && (
              <>
                <div
                  style={{
                    fontSize: 10,
                    textTransform: 'uppercase',
                    letterSpacing: '0.07em',
                    color: '#9e998f',
                    fontWeight: 600,
                    marginTop: 8,
                    marginBottom: 14,
                  }}
                >
                  Insurance Details
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}>
                  <Field label="Insurer" value={insurer} onChange={setInsurer} placeholder="Insurer name" />
                  <Field label="Invoice To" value={invoiceTo} onChange={setInvoiceTo} placeholder="Trading name to invoice" />
                  <Field label="Claim Number" value={claimNumber} onChange={setClaimNumber} placeholder="CLM-000000" />
                  <Field label="Loss Type" value={lossType} onChange={setLossType} placeholder="e.g. Water, Fire, Storm" />
                  <Field label="Adjuster" value={adjuster} onChange={setAdjuster} placeholder="Adjuster name" />
                  <Field label="Adjuster Reference" value={adjusterRef} onChange={setAdjusterRef} placeholder="Reference number" />
                  <Field label="Date of Loss" type="date" value={dateOfLoss} onChange={setDateOfLoss} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}>
                  <Field label="Sum Insured" type="number" value={sumInsured} onChange={setSumInsured} placeholder="0.00" />
                  <Field label="Excess" type="number" value={excess} onChange={setExcess} placeholder="0.00" />
                </div>

                <TextareaField
                  label="Claim Description"
                  value={claimDescription}
                  onChange={setClaimDescription}
                  placeholder="Describe the claim…"
                />

                <TextareaField
                  label="Special Instructions"
                  value={specialInstructions}
                  onChange={setSpecialInstructions}
                  placeholder="Any special instructions…"
                />
              </>
            )}

            {/* Private-specific fields */}
            {jobType === 'private' && (
              <TextareaField
                label="Work Description"
                value={workDescription}
                onChange={setWorkDescription}
                placeholder="Describe the work required…"
              />
            )}

            <TextareaField
              label="Notes"
              value={notes}
              onChange={setNotes}
              placeholder="Internal notes…"
            />
          </div>

          {error && (
            <div
              style={{
                background: '#fdecea',
                border: '0.5px solid #f5c6c2',
                borderRadius: 6,
                padding: '10px 14px',
                marginBottom: 16,
                fontSize: 13,
                color: '#b91c1c',
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Link
              href="/dashboard/jobs"
              style={{
                fontSize: 13,
                color: '#9a9088',
                background: 'transparent',
                border: '1px solid #e8e3dc',
                borderRadius: 20,
                padding: '8px 20px',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontWeight: 600,
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={submitting || !insuredName.trim() || !propertyAddress.trim()}
              style={{
                fontSize: 13,
                color: '#fff',
                background: '#2a6b50',
                border: '1px solid #2a6b50',
                borderRadius: 20,
                padding: '8px 24px',
                cursor: submitting ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                fontWeight: 600,
                opacity: submitting || !insuredName.trim() || !propertyAddress.trim() ? 0.6 : 1,
                transition: 'all 0.15s',
              }}
            >
              {submitting ? 'Creating…' : 'Create Job'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
