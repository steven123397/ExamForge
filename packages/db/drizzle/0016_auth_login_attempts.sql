CREATE TABLE auth_login_attempts (
  key_digest text PRIMARY KEY,
  failure_count integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_login_attempts_failure_count_check CHECK (failure_count >= 0)
);

CREATE INDEX auth_login_attempts_updated_at_idx ON auth_login_attempts (updated_at);
