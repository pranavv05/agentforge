-- Make the module-summary cache repo-scoped rather than spec-scoped.
--
-- `repo_modules` was keyed by spec, so a second feature against the same repository
-- re-summarised every module and paid for it again. That defeats the point of the
-- stage: the summaries are a property of the code, not of the feature request, and the
-- git hash already tells us exactly when they go stale.
--
-- `spec_id` is kept for provenance and for the cascade delete, but the cache *lookup*
-- is on (repo_path, module_path, git_hash), so any spec pointed at the same checkout
-- re-uses what an earlier scan already paid for.

ALTER TABLE repo_modules ADD COLUMN repo_path TEXT NOT NULL DEFAULT '';

-- The lookup index. Not unique: two specs may legitimately each hold a row for the same
-- module while one is being scanned, and a unique constraint would turn that race into
-- an error rather than a redundant row that the next write replaces.
CREATE INDEX IF NOT EXISTS idx_repo_modules_cache
  ON repo_modules (repo_path, module_path, git_hash);
