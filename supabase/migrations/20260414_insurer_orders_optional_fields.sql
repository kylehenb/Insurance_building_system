-- Make all insurer_orders fields optional to prevent failures when AI/parsing misses details
-- This removes the NOT NULL constraint from claim_number

ALTER TABLE insurer_orders 
ALTER COLUMN claim_number DROP NOT NULL;
