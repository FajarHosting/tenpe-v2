-- Tenpe V2 PostgreSQL bootstrap for Neon.
-- Application documents and sessions are persisted in PostgreSQL only.
CREATE TABLE IF NOT EXISTS app_documents (
  collection text NOT NULL,
  id text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, id)
);
CREATE INDEX IF NOT EXISTS app_documents_collection_idx ON app_documents(collection);
-- connect-pg-simple creates the user_sessions / legacy_sessions table at startup.
