// Repeated manual steps (tech spec §25.5): staff doing the same few actions,
// one after another, on the same job, again and again — the best candidates
// for an automation. Read from the who-did-what log (activity_log): a run is
// one person's actions on one job with no more than 30 minutes between them;
// every 2- and 3-step sequence in a run is counted, and the ones done most
// (by enough times and people) become facts for the review.

export interface ActivityStep {
  user_id: string | null
  job_id: string | null
  action: string
  created_at: string
  outcome?: string | null
}

export interface RepeatedSequence {
  steps: string[]
  times: number
  people: number
  jobs: number
}

/** Opening a page, or reading or deciding on the health check, isn't a step anyone could automate */
const IGNORED = new Set(['mail.view', 'health.view'])
const GAP_MS = 30 * 60 * 1000

export function repeatedSequences(rows: ActivityStep[], opts: { minTimes?: number; limit?: number } = {}): RepeatedSequence[] {
  const minTimes = opts.minTimes ?? 3
  // One person's steps on one job, in time order
  const groups = new Map<string, ActivityStep[]>()
  for (const r of rows) {
    if (!r.user_id || !r.job_id || IGNORED.has(r.action) || r.outcome === 'failed' || r.outcome === 'requested') continue
    const key = `${r.user_id}|${r.job_id}`
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  const counts = new Map<string, { times: number; people: Set<string>; jobs: Set<string> }>()
  for (const steps of groups.values()) {
    steps.sort((a, b) => a.created_at.localeCompare(b.created_at))
    // Split into runs at gaps over 30 minutes
    const runs: ActivityStep[][] = []
    for (const s of steps) {
      const run = runs[runs.length - 1]
      const prev = run?.[run.length - 1]
      if (prev && Date.parse(s.created_at) - Date.parse(prev.created_at) <= GAP_MS) run.push(s)
      else runs.push([s])
    }
    for (const run of runs) {
      // The same action twice in a row is one step (e.g. two notes)
      const actions = run.map(s => s.action).filter((a, i, all) => i === 0 || a !== all[i - 1])
      const seen = new Set<string>()
      for (const n of [2, 3]) {
        for (let i = 0; i + n <= actions.length; i++) {
          const key = actions.slice(i, i + n).join(' → ')
          if (seen.has(key)) continue // once per run
          seen.add(key)
          const c = counts.get(key) ?? { times: 0, people: new Set(), jobs: new Set() }
          c.times++
          c.people.add(run[0].user_id!)
          c.jobs.add(run[0].job_id!)
          counts.set(key, c)
        }
      }
    }
  }
  const all = [...counts].map(([key, c]) => ({ steps: key.split(' → '), times: c.times, people: c.people.size, jobs: c.jobs.size }))
    .filter(s => s.times >= minTimes)
  // A 2-step sequence that only ever happens inside a 3-step one adds nothing
  const kept = all.filter(s => s.steps.length === 3 || !all.some(l => l.steps.length === 3 && l.times >= s.times && l.steps.join('|').includes(s.steps.join('|'))))
  return kept.sort((a, b) => b.times - a.times || b.steps.length - a.steps.length).slice(0, opts.limit ?? 5)
}
