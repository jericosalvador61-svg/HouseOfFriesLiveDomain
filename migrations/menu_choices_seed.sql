-- ============================================================
-- REQ-040 Menu Choices & Add-ons
-- APPROVED by Jerico 2026-09-30
-- Run this in phpMyAdmin on the SAME database backend/db.php points at.
-- Two NEW tables only. NO ALTER on existing tables.
-- Rollback: DROP TABLE menu_item_choices, menu_item_addons;
-- ============================================================

CREATE TABLE IF NOT EXISTS menu_item_choices (
    menu_choice_id INT AUTO_INCREMENT PRIMARY KEY,
    menu_item_id   INT NOT NULL,
    group_name     VARCHAR(80) NOT NULL,
    choice_name    VARCHAR(80) NOT NULL,
    sort_order     INT NOT NULL DEFAULT 0,
    status         ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_choice_item (menu_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS menu_item_addons (
    menu_addon_id INT AUTO_INCREMENT PRIMARY KEY,
    addon_name    VARCHAR(80) NOT NULL,
    price         DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    sort_order    INT NOT NULL DEFAULT 0,
    status        ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- SEED DATA
-- Choices are attached to menu items by NAME to be idempotent.
-- The menu items ("Fries", "Iced Tea", "Pineapple Juice" and the
-- combo) must already exist in menu_items for the seeds to bind.
-- ============================================================

-- ── Per-item choices: DRINK TYPE (Pineapple / Lemon Tea) ──
-- Bound to the drink items AND the combo/meal items that include a drink
-- (R1C/R2C/BS1/BS2/F1C/F2C), per the canonical menu in deploy_with_data.sql.
INSERT INTO menu_item_choices (menu_item_id, group_name, choice_name, sort_order, status)
SELECT m.menu_item_id, 'Drink Type', c.choice_name, c.sort_order, 'Active'
FROM (
    SELECT 'Pineapple' AS choice_name, 1 AS sort_order
    UNION ALL SELECT 'Lemon Tea', 2
) c
CROSS JOIN menu_items m
WHERE m.item_name IN (
        'Pineapple Juice', 'Lemon tea Juice',
        'R1C', 'R2C', 'BS1', 'BS2', 'F1C', 'F2C'
      )
  AND NOT EXISTS (
      SELECT 1 FROM menu_item_choices mic
      WHERE mic.menu_item_id = m.menu_item_id AND mic.choice_name = c.choice_name
  );

-- ── Per-item choices: FRIES FLAVOR (BBQ / Cheese / Plain) ──
-- Bound to the fries items (Cheesy Fries) AND the combo items that include
-- fries (F1C/F2C).
INSERT INTO menu_item_choices (menu_item_id, group_name, choice_name, sort_order, status)
SELECT m.menu_item_id, 'Fries Flavor', c.choice_name, c.sort_order, 'Active'
FROM (
    SELECT 'BBQ' AS choice_name, 1 AS sort_order
    UNION ALL SELECT 'Cheese', 2
    UNION ALL SELECT 'Plain', 3
) c
CROSS JOIN menu_items m
WHERE m.item_name IN ('Cheesy Fries', 'F1C', 'F2C')
  AND NOT EXISTS (
      SELECT 1 FROM menu_item_choices mic
      WHERE mic.menu_item_id = m.menu_item_id AND mic.choice_name = c.choice_name
  );

-- ── Global add-ons catalog (auto-shown on EVERY item popup) ──
INSERT INTO menu_item_addons (addon_name, price, sort_order, status)
SELECT c.addon_name, c.price, c.sort_order, 'Active'
FROM (
    SELECT 'Gravy' AS addon_name, 15.00 AS price, 1 AS sort_order
    UNION ALL SELECT 'Ketchup', 5.00, 2
    UNION ALL SELECT 'Extra Cheese', 20.00, 3
) c
WHERE NOT EXISTS (
    SELECT 1 FROM menu_item_addons mia WHERE mia.addon_name = c.addon_name
);
