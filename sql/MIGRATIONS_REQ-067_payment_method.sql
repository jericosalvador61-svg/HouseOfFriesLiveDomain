-- REQ-067 F2: add orders.payment_method ENUM('CASH','GCASH') NOT NULL DEFAULT 'CASH' AFTER payment_status
-- Idempotent: information_schema guard skips the ALTER when the column already exists.
-- DEFAULT 'CASH' backfills historical rows; only new GCASH orders differ.
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='payment_method');
SET @d := IF(@c=0,'ALTER TABLE orders ADD COLUMN payment_method ENUM(''CASH'',''GCASH'') NOT NULL DEFAULT ''CASH'' AFTER payment_status','SELECT 1');
PREPARE s FROM @d; EXECUTE s; DEALLOCATE PREPARE s;
SET FOREIGN_KEY_CHECKS = 1; COMMIT;
