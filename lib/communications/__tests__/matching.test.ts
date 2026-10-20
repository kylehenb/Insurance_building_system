import { describe, it, expect } from 'vitest'
import { compareAddresses, findAddressesInText, parseAddress } from '../address'
import { extractReferenceTokens } from '../references'
import { isAdminEmail } from '../admin-filter'

describe('parseAddress', () => {
  it.each([
    ['3 Redheart Way, Beeliar, WA 6164', { number: '3', street: 'redheart', type: 'way', suburb: 'beeliar' }],
    ['2 Laurina Way Beeliar 6164', { number: '2', street: 'laurina', type: 'way', suburb: 'beeliar' }],
    ['37a Chadwick Street, Hilton 6163', { number: '37a', street: 'chadwick', type: 'st', suburb: 'hilton' }],
    ['4b Wandarrie Avenue, Yokine, WA 6060', { number: '4b', street: 'wandarrie', type: 'ave', suburb: 'yokine' }],
    ['2/15 Smith St, Banksia Grove WA', { number: '15', street: 'smith', type: 'st', suburb: 'banksia grove' }],
    ['14 Overdene Pass, Banksia Grove, WA 6031', { number: '14', street: 'overdene', type: 'pass', suburb: 'banksia grove' }],
  ])('%s', (input, expected) => {
    expect(parseAddress(input)).toMatchObject(expected)
  })

  it('returns null for placeholder addresses', () => {
    expect(parseAddress('Floreat')).toBeNull()
    expect(parseAddress(null)).toBeNull()
  })
})

describe('findAddressesInText', () => {
  it('finds addresses in subjects', () => {
    expect(findAddressesInText('Re: Quote - 13 Pepper Close, Ballajura, WA 6066')[0])
      .toMatchObject({ number: '13', street: 'pepper', type: 'cl', suburb: 'ballajura', suburbIsStrong: true })
    expect(findAddressesInText('Re: [INFO] Quote Request - 2 Cassino Drive, Stirling')[0])
      .toMatchObject({ number: '2', street: 'cassino', type: 'dr', suburb: 'stirling' })
  })

  it('treats prose after the street as a weak suburb', () => {
    const [addr] = findAddressesInText('We will attend 13 Pepper Close tomorrow morning to measure up')
    expect(addr).toMatchObject({ number: '13', street: 'pepper', suburbIsStrong: false })
  })
})

describe('compareAddresses', () => {
  const job = parseAddress('13 Pepper Close, Ballajura, WA 6066')!

  it('matches abbreviations and missing commas', () => {
    expect(compareAddresses(findAddressesInText('13 Pepper Cl Ballajura WA 6066')[0], job)).toBe('exact')
    expect(compareAddresses(findAddressesInText('13 pepper close')[0], job)).toBe('exact')
  })

  it('ignores a weak free-text suburb', () => {
    expect(compareAddresses(findAddressesInText('at 13 Pepper Close for the vanity')[0], job)).toBe('exact')
  })

  it('rejects a conflicting strong suburb', () => {
    expect(compareAddresses(findAddressesInText('13 Pepper Close, Karrinyup')[0], job)).toBeNull()
  })

  it('rejects a different street type', () => {
    expect(compareAddresses(findAddressesInText('13 Pepper Road, Ballajura')[0], job)).toBeNull()
  })

  it('downgrades a different street number to street-only', () => {
    const cassinoJob = parseAddress('20 Cassino Drive, Stirling, WA 6021')!
    expect(compareAddresses(findAddressesInText('2 Cassino Drive, Stirling')[0], cassinoJob)).toBe('street')
  })

  it('does not treat 21 and 21a as the same number', () => {
    const j = parseAddress('21a Oliver Street, Scarborough, WA 6019')!
    expect(compareAddresses(findAddressesInText('21 Oliver St, Scarborough')[0], j)).toBe('street')
  })
})

describe('extractReferenceTokens', () => {
  it('finds job and claim numbers', () => {
    const t = extractReferenceTokens('Quote Request [IRC1048] claim CHCCLM010001934 and CLM-12345')
    expect(t.alnum).toEqual(expect.arrayContaining(['IRC1048', 'CHCCLM010001934', 'CLM12345', 'CLM-12345']))
  })

  it('finds pure digit claim numbers', () => {
    expect(extractReferenceTokens('Claim 1234567 update').digits).toContain('1234567')
  })

  it('ignores short codes', () => {
    expect(extractReferenceTokens('WA6 Q1 code 4141').alnum).toEqual([])
  })
})

describe('isAdminEmail', () => {
  it.each([
    ['dse@aumail.docusign.net', 'Please DocuSign: Agreement'],
    ['noreply@em1.cloudflare.com', 'Your invoice'],
    ['messaging-service@post.xero.com', 'Bill from supplier'],
    ['caitlin@sedgwick.com', 'Insurance Repair Co Pty Ltd & Sedgwick - Expired WC'],
    ['panel@sedgwick.com', 'URGENT ACTION REQUIRED - Sedgwick Panel Expiry of Licence / Insurance'],
    ['someone@sedgwick.com', 'Automatic reply: Insurance Repair Co Pty Ltd & Sedgwick - Expired WC'],
    ['news@sedgwick.com', 'Sedgwick Repair Solutions October WHS Newsletter'],
    ['team@sure-insurance.com.au', 'Quarterly Attestation - Period ending 31/07/2026'],
    ['ap@sedgwick.com', 'Payment Advice Note from 24.09.2026'],
    ['welcome_donotreply@youi.com.au', 'Youi Policy Schedule - OA97511170 Ref:LJT29'],
    ['NRMAInsurance@feedback.nrma.com.au', 'Insurance Repair Co Pty Ltd T/As, how was your experience getting a new policy'],
    ['AU-SED-suppliers@sedgwick.com', 'Sedgwick Repair Solutions - Panel Discussion'],
  ])('%s — %s', (fromEmail, subject) => {
    expect(isAdminEmail({ fromEmail, subject })).toBe(true)
  })

  it.each([
    ['info@pinnaclegaragedoors.com.au', 'Re: [INFO] Quote Request - 2 Cassino Drive, Stirling'],
    ['trufix@gmail.com', 'Tapping vanity'],
    ['adjuster@sedgwick.com', 'CHCCLM010001934 - scope approved'],
    ['sales@damiencole.com.au', 'Insurance Repair Co - 6W x 6L x 3H /Rear End Wall'],
  ])('keeps %s — %s', (fromEmail, subject) => {
    expect(isAdminEmail({ fromEmail, subject })).toBe(false)
  })
})
