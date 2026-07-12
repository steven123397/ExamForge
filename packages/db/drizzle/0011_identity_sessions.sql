CREATE TABLE users (
  id text PRIMARY KEY,
  username text NOT NULL,
  display_name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  password_hash text NOT NULL,
  password_salt text NOT NULL,
  scrypt_n integer NOT NULL,
  scrypt_r integer NOT NULL,
  scrypt_p integer NOT NULL,
  scrypt_key_length integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_username_unique UNIQUE (username),
  CONSTRAINT users_scrypt_parameters_positive CHECK (
    scrypt_n > 1 AND scrypt_r > 0 AND scrypt_p > 0 AND scrypt_key_length > 0
  )
);

CREATE TABLE roles (
  id text PRIMARY KEY,
  name text NOT NULL,
  CONSTRAINT roles_name_unique UNIQUE (name)
);

INSERT INTO roles (id, name) VALUES
  ('admin', 'Administrator'),
  ('operator', 'Scheduling operator'),
  ('teacher', 'Teacher'),
  ('student', 'Student');

CREATE TABLE user_roles (
  user_id text NOT NULL,
  role_id text NOT NULL,
  CONSTRAINT user_roles_pk PRIMARY KEY (user_id, role_id),
  CONSTRAINT user_roles_user_id_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT user_roles_role_id_fk
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT
);

CREATE TABLE sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  token_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  user_agent text,
  ip_address text,
  CONSTRAINT sessions_user_id_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT sessions_token_digest_unique UNIQUE (token_digest),
  CONSTRAINT sessions_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX sessions_user_expires_at_idx ON sessions (user_id, expires_at);

ALTER TABLE audit_events
  ADD COLUMN actor_user_id text,
  ADD COLUMN actor_roles jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT audit_events_actor_user_id_fk
    FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL;
