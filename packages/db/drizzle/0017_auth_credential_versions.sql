ALTER TABLE users
  ADD COLUMN credential_version integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT users_credential_version_check CHECK (credential_version > 0);

ALTER TABLE sessions
  ADD COLUMN credential_version integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT sessions_credential_version_check CHECK (credential_version > 0);
