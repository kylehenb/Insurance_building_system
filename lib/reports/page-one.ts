// The roof report's page one (Midcity field app): the short cause and one line
// per problem letter, written from the cause of damage. Used when the whole
// report is written (/api/midcity/generate-roof-report) and when only page one
// is brought back in step after the cause was edited (/api/midcity/update-page-one).

export const PAGE_ONE_FORMAT = `PAGE ONE SUMMARY (causeSummary, problemSummaries) — the report's first page shows the roof from above with the problem letters pinned on it. Write both from the cause of damage, using the same letters:
- causeSummary: the short version of the cause of damage, one or two sentences (under 45 words), with each problem's letter in brackets where it's mentioned. The assessor may paste it straight into their report. Example: "Stormwater entry through the roof cover at the enclosed patio from 3 defects: (A) roof tiles stop short of the gutter; (B) the gutter falls the wrong way and overflows; (C) 17 broken tiles over the rear roof."
- problemSummaries: one line per problem letter, in letter order: "(A) <where, 2–4 words> - <the problem, under 10 words>". Example: "(A) Enclosed patio - Roof tiles stop short of the gutter". Empty when there are no problems.`

/** The two page one fields from an AI reply, or null when it can't be read */
export function readPageOne(text: string): { causeSummary: string; problemSummaries: string } | null {
  try {
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return null
    const o = JSON.parse(m[0]) as Record<string, unknown>
    if (typeof o.causeSummary !== 'string' || typeof o.problemSummaries !== 'string') return null
    return { causeSummary: o.causeSummary.trim(), problemSummaries: o.problemSummaries.trim() }
  } catch {
    return null
  }
}
