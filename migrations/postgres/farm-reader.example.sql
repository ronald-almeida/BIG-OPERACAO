-- Run separately after 0001_core. Set a fresh password through your secret manager.
-- Do not commit the populated statement or reuse the panel/database owner role.
CREATE ROLE big_farm_reader LOGIN PASSWORD 'REPLACE_WITH_A_RANDOM_SECRET';
GRANT USAGE ON SCHEMA public TO big_farm_reader;
GRANT SELECT ON public.public_farm_sites TO big_farm_reader;
-- Verify with this role: SELECT * FROM records/auth_sessions MUST be denied.
-- FARM_DATABASE_URL uses big_farm_reader. Never use DATABASE_URL on this Worker.
