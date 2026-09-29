-- ghost_agency_email_log tracking columns (run in Supabase SQL editor)
ALTER TABLE ghost_agency_email_log ADD COLUMN IF NOT EXISTS opened_at timestamptz;
ALTER TABLE ghost_agency_email_log ADD COLUMN IF NOT EXISTS clicked_at timestamptz;
ALTER TABLE ghost_agency_email_log ADD COLUMN IF NOT EXISTS report_viewed_at timestamptz;
CREATE INDEX IF NOT EXISTS ghost_agency_email_log_prospect_id_idx ON ghost_agency_email_log (prospect_id);
