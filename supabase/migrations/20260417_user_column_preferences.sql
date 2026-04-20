-- Create table for user UI preferences including column widths
CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  preference_key TEXT NOT NULL,
  preference_value JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, user_id, preference_key)
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS user_preferences_tenant_user_idx ON user_preferences(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS user_preferences_key_idx ON user_preferences(preference_key);

-- Enable RLS
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- RLS policies
DROP POLICY IF EXISTS "Users can view their own preferences" ON user_preferences;
CREATE POLICY "Users can view their own preferences"
  ON user_preferences FOR SELECT
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid AND user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert their own preferences" ON user_preferences;
CREATE POLICY "Users can insert their own preferences"
  ON user_preferences FOR INSERT
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid AND user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update their own preferences" ON user_preferences;
CREATE POLICY "Users can update their own preferences"
  ON user_preferences FOR UPDATE
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid AND user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete their own preferences" ON user_preferences;
CREATE POLICY "Users can delete their own preferences"
  ON user_preferences FOR DELETE
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid AND user_id = auth.uid());

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_user_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER user_preferences_updated_at_trigger
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_user_preferences_updated_at();
