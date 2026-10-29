-- The learning module (tech spec §24): every AI feature records what it
-- proposed and what the person actually did, in the situation it was in;
-- new proposals are shown the most alike past cases, and the lessons learned
-- from them. It replaces the Brain (brain_entries) and the Teach / playbook
-- tables: their two workflows move across here, and the tables are dropped by
-- 20261113_retire_brain.sql once no deployed code reads them.

-- What the AI proposed and what the person did with it — one row per decision
CREATE TABLE IF NOT EXISTS learning_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Which AI feature: 'action_card' (later 'order_parse', 'report', 'quote'…)
  feature TEXT NOT NULL,
  -- The record it was about, e.g. action_queue / the card's id
  source_table TEXT,
  source_id UUID,
  -- The situation, as flat facts the feature chooses (insurer, sender, job stage…), for matching
  situation JSONB NOT NULL DEFAULT '{}',
  -- One line saying what it was, for the AI to read
  situation_text TEXT,
  proposed JSONB,
  final JSONB,
  -- What changed, one plain line each ("Dropped: Add job note", "Reply: cc changed from …")
  changes JSONB NOT NULL DEFAULT '[]',
  outcome TEXT NOT NULL CHECK (outcome IN ('accepted', 'edited', 'skipped', 'instructed')),
  -- What the person told the AI ("Tell the AI what to change")
  instruction TEXT,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_learning_events_feature ON learning_events (tenant_id, feature, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_learning_events_source ON learning_events (source_id);
CREATE INDEX IF NOT EXISTS idx_learning_events_user ON learning_events (user_id);

-- Lessons distilled from the events: when it applies, and what to do
CREATE TABLE IF NOT EXISTS learning_lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  -- The situation it applies to, in words ("Allianz make safes with an assessor on the job")
  applies_when TEXT NOT NULL,
  lesson TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  -- learned: by the nightly review; migrated: from the Brain
  source TEXT NOT NULL DEFAULT 'learned' CHECK (source IN ('learned', 'migrated')),
  -- Its track record: cases that bore it out, and ones that went against it
  support_count INTEGER NOT NULL DEFAULT 0,
  contradict_count INTEGER NOT NULL DEFAULT 0,
  evidence_ids UUID[] NOT NULL DEFAULT '{}',
  retired_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_learning_lessons_feature ON learning_lessons (tenant_id, feature, status);

-- Server only (the service role): no browser policies
ALTER TABLE learning_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_lessons ENABLE ROW LEVEL SECURITY;

-- An action card keeps the AI's own proposal (its steps as first suggested)
-- and the situation it was made in, so what the person changed can be told
ALTER TABLE action_queue ADD COLUMN IF NOT EXISTS ai_steps JSONB;
ALTER TABLE action_queue ADD COLUMN IF NOT EXISTS situation JSONB;

-- The Brain's workflows become action card lessons (its one rule had no rule in it)
DO $$
BEGIN
  IF to_regclass('public.brain_entries') IS NOT NULL THEN
    INSERT INTO learning_lessons (tenant_id, feature, applies_when, lesson, source, created_at)
    SELECT tenant_id, 'action_card', title, content, 'migrated', created_at
    FROM brain_entries
    WHERE category = 'workflow' AND status = 'approved'
      AND NOT EXISTS (SELECT 1 FROM learning_lessons l WHERE l.tenant_id = brain_entries.tenant_id AND l.source = 'migrated' AND l.applies_when = brain_entries.title);
  END IF;
END $$;
