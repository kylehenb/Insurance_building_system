// What's worth knowing about an insurer order before it's lodged and
// acknowledged — one entry per situation (no phone number, landline only…).
// Each check can tell the office something (shown on the order and noted on
// the job when it's lodged), add a paragraph to the acknowledgement emailed
// to the sender, or hold the acknowledgement back.
//
// To handle a new situation — an order outside the service area, say — add a
// check to ORDER_CHECKS. Nothing else needs to change. Client-safe: the
// Insurer Orders page runs the same checks.

/** The order fields the checks read */
export interface OrderFacts {
  insured_phone?: string | null
  insured_name?: string | null
  property_address?: string | null
  insurer?: string | null
}

export interface OrderCheckResult {
  key: string
  /** For the office: on the order, and as a note on the job once lodged */
  message: string
  /** A paragraph added to the acknowledgement, above the sign-off */
  acknowledgementLine?: string
  /** Don't send the acknowledgement; the reason is shown to the office */
  holdAcknowledgement?: string
}

export interface OrderCheck {
  key: string
  run(order: OrderFacts): OrderCheckResult | null
}

export type PhoneKind = 'mobile' | 'landline' | 'none'

/**
 * What kind of number the order gives for the insured. An Australian mobile
 * (04…, +61 4…) anywhere in the field counts; any other 8+ digit number is a
 * landline — often the broker's. Names typed into the field count as none.
 */
export function phoneKind(phone: string | null | undefined): PhoneKind {
  const numbers = (phone ?? '').match(/\+?\d[\d\s().-]{6,}\d/g) ?? []
  const digits = numbers.map(n => n.replace(/\D/g, '')).filter(d => d.length >= 8)
  if (!digits.length) return 'none'
  return digits.some(d => /^(?:0|61|610)4\d{8}$/.test(d)) ? 'mobile' : 'landline'
}

export const ORDER_CHECKS: OrderCheck[] = [
  {
    key: 'no_phone',
    run: o => phoneKind(o.insured_phone) === 'none'
      ? {
          key: 'no_phone',
          message: 'No phone number for the insured on the order.',
          acknowledgementLine: 'There was no contact number for the insured on the order. Could you please send through the best phone number to reach them, so we can arrange the appointment?',
        }
      : null,
  },
  {
    key: 'landline_only',
    run: o => phoneKind(o.insured_phone) === 'landline'
      ? { key: 'landline_only', message: `The only phone number on the order is a landline (${o.insured_phone?.trim()}). It may be the broker's rather than the insured's.` }
      : null,
  },
]

export function runOrderChecks(order: OrderFacts, checks: OrderCheck[] = ORDER_CHECKS): OrderCheckResult[] {
  return checks.map(c => c.run(order)).filter((r): r is OrderCheckResult => r !== null)
}
