// Pulls job-number / claim-number shaped tokens out of an email without AI.
//
// Only candidate tokens are produced here — they are confirmed against the
// jobs table by exact (case-insensitive) equality, so a stray token that
// doesn't belong to a job is harmless.

// Letters immediately followed by digits, optional hyphen: IRC1072, J76474,
// CHCCLM010001934, CLM-12345. 3+ digits keeps out things like "Q1", "WA6".
const ALNUM_REF_RE = /\b([a-z]{1,8})-?(\d{3,15})\b/gi

// Pure digit claim numbers (some insurers use these). 6-12 digits.
// Phone numbers are filtered by the DB lookup — a phone number won't equal a claim number.
const DIGIT_REF_RE = /\b(\d{6,12})\b/g

const MAX_TOKENS = 25

export type ReferenceTokens = {
  /** Uppercased tokens that might be a job_number or claim_number, both "CLM12345" and "CLM-12345" forms */
  alnum: string[]
  /** Pure digit tokens that might be a claim_number */
  digits: string[]
}

export function extractReferenceTokens(text: string): ReferenceTokens {
  const alnum = new Set<string>()
  for (const m of text.matchAll(ALNUM_REF_RE)) {
    const prefix = m[1].toUpperCase()
    alnum.add(`${prefix}${m[2]}`)
    if (m[0].includes('-')) alnum.add(`${prefix}-${m[2]}`)
    if (alnum.size >= MAX_TOKENS) break
  }

  const digits = new Set<string>()
  for (const m of text.matchAll(DIGIT_REF_RE)) {
    digits.add(m[1])
    if (digits.size >= MAX_TOKENS) break
  }

  return { alnum: [...alnum], digits: [...digits] }
}
