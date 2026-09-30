-- REQ-049 Counter-Level Discounts — migration (Jerico APPROVED 2026-09-30)
ALTER TABLE orders
  ADD subtotal_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER total_amount,
  ADD discount_type_id INT NULL AFTER subtotal_amount,
  ADD discount_amount DECIMAL(12,2) NULL AFTER discount_type_id,
  ADD discount_id_number VARCHAR(50) NULL AFTER discount_amount,
  ADD discount_approved_by INT NULL AFTER discount_id_number,
  ADD discount_approved_at DATETIME NULL AFTER discount_approved_by;

CREATE TABLE IF NOT EXISTS discount_types (
  discount_type_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  percent DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO discount_types (name, percent) VALUES ('Senior Citizen', 10.00), ('PWD', 10.00)
  ON DUPLICATE KEY UPDATE name = VALUES(name);
