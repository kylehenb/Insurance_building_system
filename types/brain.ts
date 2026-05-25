export type BrainEntryCategory =
  | 'rule'
  | 'workflow'
  | 'tone'
  | 'classification'
  | 'example'
  | 'correction'
  | 'entity-definition'

export type BrainEntryStatus = 'draft' | 'approved' | 'deprecated'

export type BrainEntryConfidence = 'low' | 'medium' | 'high'

export type BrainEntrySourceType =
  | 'manual'
  | 'approved-output'
  | 'correction'
  | 'ai-structured'
  | 'promoted-audit'

export type BrainEntryPersona = 'gary' | 'client-comms' | 'internal'

export interface BrainEntry {
  id: string
  tenant_id: string
  category: BrainEntryCategory
  persona: BrainEntryPersona | null
  prompt_keys: string[]
  tags: string[]
  title: string
  content: string
  source_type: BrainEntrySourceType
  source_ref_table: string | null
  source_ref_id: string | null
  status: BrainEntryStatus
  confidence: BrainEntryConfidence
  times_applied: number
  times_validated: number
  times_contradicted: number
  last_reviewed_at: string | null
  review_due_at: string | null
  version: number
  previous_content: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

export type BrainEntryInsert = Omit<
  BrainEntry,
  'id' | 'created_at' | 'updated_at' | 'times_applied' | 'times_validated' | 'times_contradicted' | 'version'
> & {
  id?: string
  created_at?: string
  updated_at?: string
  times_applied?: number
  times_validated?: number
  times_contradicted?: number
  version?: number
}

/** Nested snapshot: { tableName: { recordId: { fieldName: originalValue } } } */
export type FieldSnapshot = Record<string, Record<string, Record<string, unknown>>>

export interface PlaybookRun {
  id: string
  tenant_id: string
  playbook_id: string
  job_id: string | null
  triggered_by: string | null
  triggered_via: 'assistant' | 'action_queue' | 'manual' | null
  status: 'pending' | 'running' | 'completed' | 'failed'
  field_snapshots: FieldSnapshot | null
  step_log: Record<string, unknown>[] | null
  error: string | null
  created_at: string
  completed_at: string | null
}

export interface TeachSessionInput {
  dictation: string
  trigger: string
}

export interface StructuredTeachStep {
  order: number
  description: string
}

export interface StructuredTeachOutput {
  type?: 'note' | 'workflow'
  title: string
  trigger_condition: string
  steps: StructuredTeachStep[]
  variables: string[]
  tags: string[]
  prompt_keys: string[]
  category: BrainEntryCategory
  confidence: BrainEntryConfidence
}

export interface SimilarityMatch {
  id: string
  title: string
  category: string
  similarity: 'high' | 'medium'
}

export interface TeachSavePayload {
  structured: StructuredTeachOutput
  tenantId: string
  saveMode?: 'new' | 'example' | 'variant'
  sourceRefId?: string
}

export interface FieldCorrection<T = unknown> {
  fieldName: string
  before: T
  after: T
  sourceType: 'playbook' | 'ai'
  playbookRunId?: string
  aiAuditId?: string
  detectedAt: string
}

export interface BrainReviewQueue {
  draft: BrainEntry[]
  stale: BrainEntry[]
  contradicted: BrainEntry[]
  total: number
}

export interface CorrectionSavePayload {
  fieldName: string
  before: unknown
  after: unknown
  sourceType: 'playbook' | 'ai'
  playbookRunId?: string
  aiAuditId?: string
  detectedAt: string
}
