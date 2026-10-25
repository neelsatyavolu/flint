-- Flint receipts service. No raw IP addresses are ever stored: only HMAC fingerprints.

CREATE TABLE installs (
  id          TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,          -- hex sha256 of the install secret
  created_at  INTEGER NOT NULL        -- epoch ms
);

CREATE TABLE messages (
  install_id    TEXT NOT NULL REFERENCES installs(id) ON DELETE CASCADE,
  ref           TEXT NOT NULL,        -- client-chosen message reference
  registered_at INTEGER NOT NULL,     -- epoch ms
  PRIMARY KEY (install_id, ref)
);
CREATE INDEX messages_registered_at ON messages(registered_at);

CREATE TABLE tokens (
  token         TEXT PRIMARY KEY,     -- 22 char base64url
  install_id    TEXT NOT NULL,
  ref           TEXT NOT NULL,
  registered_at INTEGER NOT NULL,
  FOREIGN KEY (install_id, ref) REFERENCES messages(install_id, ref) ON DELETE CASCADE
);
CREATE INDEX tokens_message ON tokens(install_id, ref);

CREATE TABLE events (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  token              TEXT NOT NULL,
  install_id         TEXT NOT NULL,
  at                 INTEGER NOT NULL,  -- epoch ms
  kind               TEXT NOT NULL CHECK (kind IN ('open','prefetch','scanner','self','bot','duplicate')),
  client             TEXT,
  device             TEXT,
  country            TEXT,
  city               TEXT,
  fingerprint        TEXT NOT NULL,     -- truncated HMAC-SHA256 of the request IP
  possibly_forwarded INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX events_install_id ON events(install_id, id);
CREATE INDEX events_token_kind ON events(token, kind, at);
CREATE INDEX events_at ON events(at);

CREATE TABLE sender_fingerprints (
  install_id  TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  seen_at     INTEGER NOT NULL,        -- epoch ms
  PRIMARY KEY (install_id, fingerprint)
);
CREATE INDEX sender_fingerprints_seen_at ON sender_fingerprints(seen_at);

CREATE TABLE rate_limits (
  key          TEXT NOT NULL,          -- e.g. install:<ip fingerprint>
  window_start INTEGER NOT NULL,       -- epoch ms, start of the hour
  count        INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);
