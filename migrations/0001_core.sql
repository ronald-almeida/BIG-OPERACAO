CREATE TABLE workspace (
 id INTEGER PRIMARY KEY CHECK(id=1),
 revision INTEGER NOT NULL DEFAULT 0,
 mutation_id TEXT NOT NULL DEFAULT ''
);
INSERT INTO workspace(id) VALUES(1);
CREATE TABLE records (
 collection TEXT NOT NULL,
 id TEXT NOT NULL,
 data TEXT NOT NULL CHECK(json_valid(data)),
 PRIMARY KEY(collection,id)
);
CREATE UNIQUE INDEX account_username ON records(lower(json_extract(data,'$.username')))
 WHERE collection IN ('admin','people');
CREATE UNIQUE INDEX profile_meta ON records(json_extract(data,'$.meta')) WHERE collection='profiles';
CREATE UNIQUE INDEX bm_meta ON records(json_extract(data,'$.meta')) WHERE collection='bms';
CREATE UNIQUE INDEX sale_bm ON records(json_extract(data,'$.bm')) WHERE collection='sales';
CREATE TABLE auth_sessions (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL,
 credential_version TEXT NOT NULL,
 expires INTEGER NOT NULL,
 csrf TEXT NOT NULL
);
CREATE INDEX session_expiry ON auth_sessions(expires);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE requests (id TEXT PRIMARY KEY, actor TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, created INTEGER NOT NULL);
CREATE INDEX request_age ON requests(created);
CREATE TABLE external_locks (id TEXT PRIMARY KEY, lease TEXT NOT NULL, expires INTEGER NOT NULL);
