import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function applyMigration() {
  try {
    console.log('Applying migration: Add sequence_order to work_order_visits')

    // We can't execute arbitrary SQL directly via the client without RPC
    // So we'll just inform the user
    console.log('\n⚠️  Could not apply migration automatically via the client.')
    console.log('Please run the following SQL manually in your Supabase SQL Editor:')
    console.log('\n' + '='.repeat(80))
    console.log(`
ALTER TABLE work_order_visits
ADD COLUMN IF NOT EXISTS sequence_order INTEGER;

CREATE INDEX IF NOT EXISTS idx_work_order_visits_sequence_order
ON work_order_visits(sequence_order);

COMMENT ON COLUMN work_order_visits.sequence_order IS 'Sequence order for independent visit positioning in the blueprint. Allows visits from the same work order to be interleaved with other work orders.';
    `.trim())
    console.log('='.repeat(80) + '\n')
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
}

applyMigration()
