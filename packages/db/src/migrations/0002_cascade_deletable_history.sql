-- Let a spec be deleted wholesale without weakening the append-only guarantee.
--
-- The 0001 triggers aborted every DELETE on audit_log and approvals. That made the
-- guarantee real, but it also made `ON DELETE CASCADE` from specs unusable: SQLite fires
-- BEFORE DELETE triggers on cascaded child rows too, so deleting a spec failed. The
-- practical symptom was that re-running the fixture seed errored instead of replacing
-- its specs.
--
-- The fix narrows the triggers with a WHEN clause: abort only while the parent spec
-- still exists. During a cascade SQLite removes the parent row first, so by the time the
-- child trigger runs the spec is gone and the delete is allowed.
--
-- The guarantee that matters is unchanged, and is asserted by
-- packages/orchestrator/test/approvals.test.ts:
--
--   * deleting or editing an individual entry for a live spec is still refused, so
--     history cannot be selectively rewritten;
--   * the only way to remove history is to delete the entire spec, which removes every
--     artifact, approval and audit entry with it. That is a wholesale, obvious act, not
--     a quiet edit.
--
-- UPDATE triggers are deliberately left unconditional: there is no legitimate reason to
-- edit an audit entry or a recorded decision, ever.

DROP TRIGGER audit_log_no_delete;

CREATE TRIGGER audit_log_no_delete
BEFORE DELETE ON audit_log
WHEN EXISTS (SELECT 1 FROM specs WHERE id = OLD.spec_id)
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

DROP TRIGGER approvals_no_delete;

CREATE TRIGGER approvals_no_delete
BEFORE DELETE ON approvals
WHEN EXISTS (SELECT 1 FROM specs WHERE id = OLD.spec_id)
BEGIN
  SELECT RAISE(ABORT, 'approvals are append-only');
END;
