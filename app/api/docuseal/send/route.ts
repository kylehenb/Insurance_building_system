import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateSowHtml } from '@/lib/documents/sow-html'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single()

    if (userError || !userData) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const tenantId = userData.tenant_id

    const { quoteId } = await req.json() as { quoteId: string }

    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .select('*')
      .eq('id', quoteId)
      .eq('tenant_id', tenantId)
      .single()

    if (quoteError || !quote) {
      return NextResponse.json({ error: 'Quote not found' }, { status: 400 })
    }

    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .select('*')
      .eq('id', quote.job_id)
      .eq('tenant_id', tenantId)
      .single()

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 400 })
    }

    const { data: scopeItems } = await supabase
      .from('scope_items')
      .select('*')
      .eq('quote_id', quoteId)
      .eq('tenant_id', tenantId)
      .order('sort_order', { ascending: true })

    if (!job.insured_email) {
      return NextResponse.json(
        { error: 'No insured email on file. Please add one before sending.' },
        { status: 400 }
      )
    }

    const html = generateSowHtml({ quote, job, scopeItems: scopeItems || [] })

    const puppeteerRes = await fetch(`${process.env.PDF_SERVICE_URL}/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-secret': process.env.PDF_SERVICE_SECRET!,
      },
      body: JSON.stringify({
        html,
        filename: `${job.job_number}-SOW.pdf`,
      }),
    })

    console.log('Puppeteer response status:', puppeteerRes.status)

    if (!puppeteerRes.ok) {
      const err = await puppeteerRes.text()
      console.error('Puppeteer error:', err)
      return NextResponse.json(
        { error: 'Failed to generate PDF. Please try again.' },
        { status: 500 }
      )
    }

    const pdfBuffer = await puppeteerRes.arrayBuffer()
    console.log('PDF buffer size:', pdfBuffer.byteLength)
    const pdfBase64 = Buffer.from(pdfBuffer).toString('base64')

    const templateRes = await fetch('https://api.docuseal.com/templates/pdf', {
      method: 'POST',
      headers: {
        'X-Auth-Token': process.env.DOCUSEAL_API_KEY!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `${job.job_number} — Scope of Works`,
        documents: [
          {
            name: `${job.job_number}-SOW`,
            file: pdfBase64,
          }
        ],
        submitters: [
          { name: 'Owner / Insured' }
        ],
        fields: [
          {
            name: 'Signature',
            type: 'signature',
            submitter_index: 0,
            required: true,
          },
          {
            name: 'Full name',
            type: 'text',
            submitter_index: 0,
            required: true,
          },
          {
            name: 'Date',
            type: 'date',
            submitter_index: 0,
            required: true,
          }
        ],
      }),
    })

    const templateBody = await templateRes.text()
    console.log('DocuSeal template response status:', templateRes.status)
    console.log('DocuSeal template response body:', templateBody)

    if (!templateRes.ok) {
      return NextResponse.json(
        { error: `DocuSeal template error ${templateRes.status}: ${templateBody}` },
        { status: 500 }
      )
    }

    const templateData = JSON.parse(templateBody)
    const templateId = templateData.id

    const docusealRes = await fetch('https://api.docuseal.com/submissions', {
      method: 'POST',
      headers: {
        'X-Auth-Token': process.env.DOCUSEAL_API_KEY!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        template_id: templateId,
        send_email: true,
        submitters: [
          {
            role: 'Owner / Insured',
            email: job.insured_email,
            name: job.insured_name || '',
          }
        ],
        message: {
          subject: `Please sign your Scope of Works — ${job.job_number}`,
          body: `Hi ${job.insured_name || 'there'},\n\nPlease review and sign the attached Scope of Works for your insurance repair at ${job.property_address}.\n\nThis document authorises Insurance Repair Co to proceed with your approved repairs. You can sign directly from this email on your phone or computer — no account needed.\n\nKind regards,\nKyle Bindon\nInsurance Repair Co\n0431 132 077`,
        },
      }),
    })

    const docusealBody = await docusealRes.text()
    console.log('DocuSeal submission response status:', docusealRes.status)
    console.log('DocuSeal submission response body:', docusealBody)

    if (!docusealRes.ok) {
      return NextResponse.json(
        { error: `DocuSeal error ${docusealRes.status}: ${docusealBody}` },
        { status: 500 }
      )
    }

    const docusealData = JSON.parse(docusealBody)

    await supabase.from('communications').insert({
      tenant_id: tenantId,
      job_id: job.id,
      type: 'email',
      direction: 'outbound',
      contact_type: 'insured',
      contact_name: job.insured_name,
      contact_detail: job.insured_email,
      subject: `Scope of Works sent for signing — ${job.job_number}`,
      content: `SOW sent via DocuSeal. Submission ID: ${docusealData.id ?? 'unknown'}`,
      persona: 'human',
      created_by: user.id,
    })

    return NextResponse.json({ success: true, submissionId: docusealData.id })
  } catch (err) {
    console.error('Unhandled error in docuseal/send:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
