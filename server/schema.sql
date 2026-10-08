CREATE TABLE IF NOT EXISTS feedback (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('bug', 'suggestion', 'question', 'other')),
  content TEXT NOT NULL,
  contact TEXT,
  allow_contact BOOLEAN NOT NULL DEFAULT FALSE,
  include_diagnostics BOOLEAN NOT NULL DEFAULT TRUE,
  current_page TEXT,
  app_version TEXT,
  platform TEXT,
  user_agent TEXT,
  client_time TIMESTAMPTZ,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS feedback_created_at_idx ON feedback (created_at DESC);
