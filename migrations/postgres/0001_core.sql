CREATE TABLE workspace (
 id INTEGER PRIMARY KEY CHECK (id=1),
 revision BIGINT NOT NULL DEFAULT 0,
 mutation_id TEXT NOT NULL DEFAULT ''
);
INSERT INTO workspace(id) VALUES(1);
-- Keep JSON as text at the storage boundary to preserve the D1 record format.
-- PostgreSQL validates and indexes it with native jsonb operators.
CREATE TABLE records (
 collection TEXT NOT NULL,
 id TEXT NOT NULL,
 data TEXT NOT NULL CHECK (jsonb_typeof(data::jsonb) = 'object'),
 PRIMARY KEY(collection,id)
);
CREATE UNIQUE INDEX account_username ON records (lower(data::jsonb->>'username'))
 WHERE collection IN ('admin','people');
CREATE UNIQUE INDEX profile_meta ON records ((data::jsonb->>'meta')) WHERE collection='profiles';
CREATE UNIQUE INDEX bm_meta ON records ((data::jsonb->>'meta')) WHERE collection='bms';
CREATE UNIQUE INDEX sale_bm ON records ((data::jsonb->>'bm')) WHERE collection='sales';
CREATE TABLE auth_sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, credential_version TEXT NOT NULL,
 expires BIGINT NOT NULL, csrf TEXT NOT NULL
);
CREATE INDEX session_expiry ON auth_sessions(expires);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires BIGINT NOT NULL);
CREATE TABLE requests (id TEXT PRIMARY KEY, actor TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, created BIGINT NOT NULL);
CREATE INDEX request_age ON requests(created);
CREATE TABLE external_locks (id TEXT PRIMARY KEY, lease TEXT NOT NULL, expires BIGINT NOT NULL);

-- This view is the sole database permission granted to the public Farm service.
-- A draft edit cannot change the live snapshot; no account or credential is exposed.
CREATE VIEW public_farm_sites WITH (security_barrier=true) AS
 SELECT s.id, s.data::jsonb->'snapshot' AS snapshot
 FROM records s JOIN records d
 ON d.collection='farm_domains' AND d.id=s.data::jsonb->>'domain_id'
 WHERE s.collection='farm_sites'
 AND s.data::jsonb->'snapshot'->>'hostname' IS NOT NULL
 AND d.data::jsonb->>'active'='true';
