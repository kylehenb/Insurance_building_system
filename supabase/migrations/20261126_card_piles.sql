-- Piles instead of stars (tech spec §23.11). The three coloured stars
-- (Invoices to pay / Attend and Submit / Everything else) become five fixed
-- piles of work, still in action_queue.category:
--   new_work        New work — orders to lodge, inspections and make safes to book
--   insurer         Insurer & client — replies, updates, approvals and variations for the insurer; the homeowner's sign-offs
--   trades          Trades — chasing, booking and sending work to trades, trade quotes
--   reports_quotes  Reports & quotes — reports and quotes to write, finish or send
--   money           Money — bills to pay, invoices to raise, excess and payments
--
-- pile_by: the person who put the card in its pile; the AI then leaves it
-- there. (starred_by still means the person put it on the list themselves,
-- so it stays until they take it off.)
-- ai_category: the pile the AI picked, kept so a move is learned from.

ALTER TABLE action_queue DROP CONSTRAINT IF EXISTS action_queue_category_check;
ALTER TABLE action_queue ADD COLUMN IF NOT EXISTS pile_by UUID REFERENCES users(id);
ALTER TABLE action_queue ADD COLUMN IF NOT EXISTS ai_category TEXT;

-- The old symbols onto the piles, by what the card says
UPDATE action_queue SET category = CASE
  WHEN category = 'invoice' THEN 'money'
  WHEN category = 'attend_submit' AND title ~* '(lodge|new order|instruction|book.*(inspection|assessment|make safe)|make safe)' THEN 'new_work'
  WHEN category = 'attend_submit' THEN 'reports_quotes'
  WHEN title ~* '(invoice|bill |pay |payment|excess)' THEN 'money'
  WHEN title ~* '(castle|insurer|sedgwick|allianz|claim|BMS|homeowner|insured|sign)' THEN 'insurer'
  WHEN title ~* '(waiting on|chase|work order|trade|painting|carpet|electric|plumb|roof|blinds|cabinet|floor|glaz|book)' THEN 'trades'
  WHEN title ~* '(report|quote|BAR\b)' THEN 'reports_quotes'
  ELSE 'insurer'
END
WHERE category IN ('invoice', 'attend_submit', 'other');

ALTER TABLE action_queue ALTER COLUMN category SET DEFAULT 'insurer';
ALTER TABLE action_queue ADD CONSTRAINT action_queue_category_check
  CHECK (category IN ('new_work', 'insurer', 'trades', 'reports_quotes', 'money'));
ALTER TABLE action_queue ADD CONSTRAINT action_queue_ai_category_check
  CHECK (ai_category IS NULL OR ai_category IN ('new_work', 'insurer', 'trades', 'reports_quotes', 'money'));

-- What was learned and switched on per kind follows the piles
UPDATE learning_events SET kind = CASE kind WHEN 'invoice' THEN 'money' WHEN 'attend_submit' THEN 'reports_quotes' ELSE 'insurer' END
WHERE feature = 'action_card' AND kind IN ('invoice', 'attend_submit', 'other');
UPDATE learning_auto_confirm SET kind = CASE kind WHEN 'invoice' THEN 'money' WHEN 'attend_submit' THEN 'reports_quotes' ELSE 'insurer' END
WHERE feature = 'action_card' AND kind IN ('invoice', 'attend_submit', 'other');
