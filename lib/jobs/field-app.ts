// Midcity is a separate business run from the same system: the Midcity field
// app (app/midcity, /api/midcity) writes inspection reports for another
// insurance builder. Its jobs are saved with insurer 'Midcity'. They're not
// IRC jobs and stay out of everything that reads, counts or reports on IRC's
// work: the job list, inspections and calendar, the morning review, the lapse
// safety net, the old-jobs clean-up and the unscheduled-inspections count.
// Its AI use is recorded under features starting "midcity-" so the health
// check (tech spec §25) can show it apart from IRC's.

export const FIELD_APP_INSURER = 'Midcity'

/** True for a job made by the Midcity field app */
export const isFieldAppJob = (job: { insurer?: string | null } | null | undefined): boolean => job?.insurer === FIELD_APP_INSURER

/** The AI feature name for work on this job: "midcity-…" for Midcity's */
export const aiFeature = (feature: string, job: { insurer?: string | null } | null | undefined): string =>
  isFieldAppJob(job) && !feature.startsWith('midcity-') ? `midcity-${feature}` : feature
