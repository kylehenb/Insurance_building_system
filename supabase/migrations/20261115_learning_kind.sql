-- The learning module's accuracy (tech spec §24.6): what sort of proposal
-- each decision was about, so how often the AI got it right can be told by
-- kind (an action card's category: invoice / attend_submit / other).

ALTER TABLE learning_events ADD COLUMN IF NOT EXISTS kind TEXT;
