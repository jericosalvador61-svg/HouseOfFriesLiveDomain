-- REQ-068 M4-1: guard orders.reference_number with a UNIQUE key so the ref
-- can never repeat. Idempotent: information_schema guard skips the ALTER when
-- the index already exists (same SET @c / PREPARE pattern as REQ-067).
-- WARNING: if existing live data already contains duplicate reference_numbers,
-- this ALTER will fail until the dupes are fixed (see MIGRATIONS_REQ-068_fix_99999999.sql).
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND INDEX_NAME='uniq_ref');
SET @d := IF(@c=0,'ALTER TABLE orders ADD UNIQUE KEY uniq_ref (reference_number)','SELECT 1');
PREPARE s FROM @d; EXECUTE s; DEALLOCATE PREPARE s;
SET FOREIGN_KEY_CHECKS = 1; COMMIT;
