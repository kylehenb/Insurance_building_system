// Chases kept off the action cards for now (tech spec §23.11 "Set aside"):
// the cards are the office's urgent, day-to-day work, and these three only
// clog them up. Waiting on a decision on a quote or variation, payment of an
// invoice IRC sent, and a signature on a scope of works or building contract
// are left for a later build. IRC never plans a check, sets a wait or
// suggests a reminder for them by itself; a reminder or to-do a person sets
// for one still comes up, as they asked.

export const SET_ASIDE_KINDS = ['quote_decision', 'payment', 'signature'] as const
export type SetAsideKind = (typeof SET_ASIDE_KINDS)[number]

export const isSetAsideKind = (kind: unknown): kind is SetAsideKind =>
  typeof kind === 'string' && (SET_ASIDE_KINDS as readonly string[]).includes(kind)

/** The rule as every prompt that can put something on the action cards says it */
export const SET_ASIDE_RULE = `Three things never go on the action cards by themselves, however long they've waited — the office deals with them separately: (1) an insurer's or homeowner's decision on a quote, variation or revised scope; (2) payment of an invoice IRC sent (to an insurer, homeowner or anyone else); (3) a signature on a scope of works, building contract or other document sent for signing. Don't plan a check, a wait, a reminder or a chase for them.`
