-- ============================================================

-- The House of Fries - Tagoloan Branch

-- DATABASE SCHEMA ONLY (NO SAMPLE/TRANSACTION DATA)

-- Database: house_of_fries_db

-- Generated from the supplied August 31, 2026 SQL dump.

-- Does NOT create/select a database, to avoid hosting permission errors.
-- UPDATED: Added 5 logical foreign-key relationships for referential integrity.

-- ============================================================


SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";

SET AUTOCOMMIT = 0;

SET FOREIGN_KEY_CHECKS = 0;


CREATE TABLE `adjustments` (
  `adjustment_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `adjustment_date` date NOT NULL,
  `adjustment_type` enum('ADD','REMOVE') NOT NULL,
  `reason` text DEFAULT NULL,
  `status` enum('PENDING','APPROVED','REJECTED') DEFAULT 'PENDING',
  `approved_by` int(11) DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `approval_remarks` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `adjustment_items` (
  `adjustment_item_id` int(11) NOT NULL,
  `adjustment_id` int(11) NOT NULL,
  `raw_material_id` int(11) NOT NULL,
  `quantity` decimal(10,2) DEFAULT 0.00,
  `is_deleted` tinyint(1) DEFAULT 0,
  `deleted_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `menu_categories` (
  `category_id` int(11) NOT NULL,
  `category_name` varchar(50) NOT NULL,
  `status` enum('Active','Inactive') DEFAULT 'Active'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `menu_items` (
  `menu_item_id` int(11) NOT NULL,
  `item_name` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `image_url` varchar(100) DEFAULT NULL,
  `category_id` int(11) NOT NULL,
  `price` decimal(10,2) NOT NULL,
  `status` enum('Available','Unavailable') DEFAULT 'Available',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `estimated_prep_time_minutes` int(11) DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


-- ============================================================
-- REQ-040: MENU CHOICES & ADD-ONS (approved 2026-09-30)
-- Additive tables only — NO ALTER on existing tables.
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
-- REQ-049: COUNTER-LEVEL DISCOUNTS (approved 2026-09-30)
-- ============================================================
CREATE TABLE IF NOT EXISTS discount_types (
  discount_type_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  percent DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ============================================================
-- CUSTOMER ACCOUNTS (approved — register by phone + password)
-- Separate from staff users; orders link is nullable so all
-- historical guest/QR orders stay valid.
-- ============================================================
CREATE TABLE IF NOT EXISTS `customers` (
  `customer_id`   int(11)      NOT NULL AUTO_INCREMENT,
  `phone_number`  varchar(20)  NOT NULL,
  `name`          varchar(100) NOT NULL,
  `password_hash` varchar(255) NOT NULL,   -- password_hash(PASSWORD_DEFAULT)
  `is_active`     tinyint(1)   NOT NULL DEFAULT 1,
  `last_login_at` datetime     DEFAULT NULL,
  `created_at`    timestamp    NOT NULL DEFAULT current_timestamp(),
  `updated_at`    timestamp    NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`customer_id`),
  UNIQUE KEY `uq_customers_phone` (`phone_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `notifications` (
  `notification_id` int(11) NOT NULL,
  `target_role_id` int(11) DEFAULT NULL COMMENT 'NULL = broadcast to all roles',
  `target_user_id` int(11) DEFAULT NULL COMMENT 'NULL = whole role; set = one user',
  `type` varchar(50) NOT NULL DEFAULT 'info',
  `title` varchar(150) NOT NULL,
  `message` varchar(255) NOT NULL,
  `link_url` varchar(255) DEFAULT NULL,
  `is_read` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `orders` (
  `order_id` int(11) NOT NULL,
  `table_id` int(11) DEFAULT NULL,
  `customer_name` varchar(100) DEFAULT NULL,
  `user_id` int(11) DEFAULT NULL,
  `status` enum('PENDING','IN-PROGRESS','COOKING','COMPLETED','CANCELLED','SERVED') DEFAULT 'PENDING',
  `payment_intent_id` varchar(255) DEFAULT NULL,
  `payment_intent_status` varchar(50) DEFAULT NULL,
  `payment_status` enum('PENDING','COMPLETED','FAILED') DEFAULT 'PENDING',
  `ordered_at` datetime NOT NULL,
  `completed_at` datetime DEFAULT NULL,
  `cooking_started_at` datetime DEFAULT NULL,
  `total_estimated_prep_time` int(11) DEFAULT 15,
  `reference_number` varchar(50) DEFAULT NULL,
  `order_type` enum('DINE_IN','TAKE_OUT') DEFAULT 'DINE_IN',
  `total_amount` decimal(12,2) DEFAULT 0.00,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- REQ-049 + customer accounts: additive columns on orders
ALTER TABLE `orders`
  ADD subtotal_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER total_amount,
  ADD discount_type_id INT NULL AFTER subtotal_amount,
  ADD discount_amount DECIMAL(12,2) NULL AFTER discount_type_id,
  ADD discount_id_number VARCHAR(50) NULL AFTER discount_amount,
  ADD discount_approved_by INT NULL AFTER discount_id_number,
  ADD discount_approved_at DATETIME NULL AFTER discount_approved_by;

ALTER TABLE `orders`
  ADD COLUMN `customer_account_id` int(11) DEFAULT NULL AFTER `customer_name`,
  ADD KEY `idx_orders_customer_account` (`customer_account_id`),
  ADD CONSTRAINT `fk_orders_customer_account`
    FOREIGN KEY (`customer_account_id`) REFERENCES `customers` (`customer_id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `order_items` (
  `order_item_id` int(11) NOT NULL,
  `order_id` int(11) NOT NULL,
  `menu_item_id` int(11) NOT NULL,
  `quantity` int(11) DEFAULT 1,
  `price` decimal(12,2) DEFAULT 0.00,
  `subtotal` decimal(12,2) GENERATED ALWAYS AS (`quantity` * `price`) STORED,
  `is_deleted` tinyint(1) DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `special_instructions` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `payments` (
  `payment_id` int(11) NOT NULL,
  `order_id` int(11) NOT NULL,
  `user_id` int(11) DEFAULT NULL,
  `amount_paid` decimal(12,2) NOT NULL,
  `payment_method` enum('CASH','CARD','GCASH','ONLINE') DEFAULT 'CASH',
  `payment_status` enum('PENDING','COMPLETED','FAILED') DEFAULT 'PENDING',
  `paid_at` datetime NOT NULL,
  `transaction_reference` varchar(50) DEFAULT NULL,
  `change_given` decimal(12,2) DEFAULT 0.00,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `purchase_plans` (
  `plan_id` int(11) NOT NULL,
  `created_by` int(11) NOT NULL,
  `status` enum('Pending','Approved','Rejected','Cancelled') DEFAULT 'Pending',
  `remarks` text DEFAULT NULL,
  `total_cost` decimal(10,2) DEFAULT 0.00,
  `admin_remarks` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `purchase_plan_items` (
  `id` int(11) NOT NULL,
  `plan_id` int(11) NOT NULL,
  `raw_material_id` int(11) NOT NULL,
  `current_quantity` decimal(10,2) NOT NULL,
  `snapshot_unit_cost` decimal(10,2) DEFAULT 0.00,
  `reorder_level` decimal(10,2) NOT NULL,
  `suggested_quantity` decimal(10,2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `raw_materials` (
  `raw_material_id` int(11) NOT NULL,
  `raw_material_name` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `img_url` varchar(255) DEFAULT NULL,
  `unit` varchar(20) NOT NULL,
  `current_quantity` decimal(10,2) DEFAULT 0.00,
  `reorder_level` decimal(10,2) DEFAULT 0.00,
  `status` enum('ACTIVE','INACTIVE') DEFAULT 'ACTIVE',
  `cost_per_unit` decimal(10,2) DEFAULT 0.00,
  `expiration_tracking` tinyint(1) DEFAULT 0,
  `is_perishable` tinyint(1) DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `raw_material_supplier` (
  `raw_material_supplier_id` int(11) NOT NULL,
  `raw_material_id` int(11) NOT NULL,
  `supplier_id` int(11) NOT NULL,
  `supply_price` decimal(12,2) DEFAULT 0.00,
  `lead_time_days` int(11) DEFAULT 0,
  `min_order_quantity` decimal(10,2) DEFAULT 0.00,
  `status` enum('ACTIVE','INACTIVE') DEFAULT 'ACTIVE',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `restaurant_table` (
  `table_id` int(11) NOT NULL,
  `table_number` varchar(20) NOT NULL,
  `table_type` enum('DINE_IN','TAKEOUT') DEFAULT 'DINE_IN',
  `status` enum('AVAILABLE','OCCUPIED','MAINTENANCE') NOT NULL DEFAULT 'AVAILABLE',
  `qr_code` longtext DEFAULT NULL,
  `is_deleted` tinyint(1) DEFAULT 0,
  `deleted_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `returns` (
  `return_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `status` enum('PENDING','APPROVED','REJECTED') DEFAULT 'PENDING',
  `approved_by` int(11) DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `approval_remarks` text DEFAULT NULL,
  `reference_number` varchar(50) DEFAULT NULL,
  `return_date` date NOT NULL,
  `reason` text DEFAULT NULL,
  `return_type` enum('DAMAGED','EXCESS','OTHER') DEFAULT 'OTHER',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `return_items` (
  `return_item_id` int(11) NOT NULL,
  `return_id` int(11) NOT NULL,
  `raw_material_id` int(11) NOT NULL,
  `quantity` decimal(10,2) DEFAULT 0.00,
  `unit_cost` decimal(12,2) DEFAULT 0.00,
  `is_deleted` tinyint(1) DEFAULT 0,
  `deleted_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `roles` (
  `role_id` int(11) NOT NULL,
  `role_name` varchar(50) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `spoilage` (
  `spoilage_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `raw_material_id` int(11) NOT NULL,
  `spoilage_type` enum('SPOILAGE','WASTE') NOT NULL,
  `quantity_lost` decimal(10,2) DEFAULT 0.00,
  `source` enum('KITCHEN','RAW') DEFAULT 'RAW',
  `estimated_loss_cost` decimal(12,2) DEFAULT 0.00,
  `status` enum('PENDING','APPROVED','REJECTED') DEFAULT 'PENDING',
  `approved_by` int(11) DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `approval_remarks` text DEFAULT NULL,
  `reference_number` varchar(50) DEFAULT NULL,
  `remarks` text DEFAULT NULL,
  `spoilage_date` date NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `stock_in` (
  `stock_in_id` int(11) NOT NULL,
  `supplier_id` int(11) DEFAULT NULL,
  `user_id` int(11) NOT NULL,
  `stock_in_date` date NOT NULL,
  `total_cost` decimal(12,2) DEFAULT 0.00,
  `remarks` text DEFAULT NULL,
  `status` enum('PENDING','APPROVED','REJECTED') DEFAULT 'PENDING',
  `approved_by` int(11) DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `approval_remarks` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `stock_in_items` (
  `stock_in_item_id` int(11) NOT NULL,
  `stock_in_id` int(11) NOT NULL,
  `raw_material_id` int(11) NOT NULL,
  `quantity` decimal(10,2) DEFAULT 0.00,
  `unit_cost` decimal(12,2) DEFAULT 0.00,
  `subtotal` decimal(12,2) GENERATED ALWAYS AS (`quantity` * `unit_cost`) STORED,
  `expiration_date` date DEFAULT NULL,
  `is_deleted` tinyint(1) DEFAULT 0,
  `deleted_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `stock_out` (
  `stock_out_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `stock_out_date` date NOT NULL,
  `remarks` text DEFAULT NULL,
  `status` enum('PENDING','APPROVED','REJECTED') DEFAULT 'PENDING',
  `approved_by` int(11) DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `approval_remarks` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `stock_out_items` (
  `stock_out_item_id` int(11) NOT NULL,
  `stock_out_id` int(11) NOT NULL,
  `raw_material_id` int(11) NOT NULL,
  `quantity` decimal(10,2) DEFAULT 0.00,
  `is_deleted` tinyint(1) DEFAULT 0,
  `deleted_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `suppliers` (
  `supplier_id` int(11) NOT NULL,
  `supplier_name` varchar(100) NOT NULL,
  `contact_person` varchar(100) DEFAULT NULL,
  `contact_number` varchar(20) DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `status` enum('ACTIVE','INACTIVE') DEFAULT 'ACTIVE',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `users` (
  `user_id` int(11) NOT NULL,
  `username` varchar(50) NOT NULL,
  `password` varchar(255) NOT NULL,
  `first_name` varchar(50) DEFAULT NULL,
  `last_name` varchar(50) DEFAULT NULL,
  `gender` enum('Male','Female','Other') DEFAULT NULL,
  `contact_number` varchar(20) DEFAULT NULL,
  `email_address` varchar(100) DEFAULT NULL,
  `social_account` varchar(100) DEFAULT NULL,
  `role_id` int(11) NOT NULL,
  `status` enum('Active','Inactive') DEFAULT 'Active',
  `must_change_password` tinyint(1) DEFAULT 1,
  `temp_code` varchar(20) DEFAULT NULL COMMENT 'Plain temp code while must_change_password=1; cleared after first-login change',
  `login_attempts` int(11) DEFAULT 0,
  `locked_until` timestamp NULL DEFAULT NULL,
  `lock_level` int(11) DEFAULT 0,
  `last_failed_attempt` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `voids` (
  `void_id` int(11) NOT NULL,
  `order_id` int(11) NOT NULL,
  `requested_by` int(11) NOT NULL,
  `approved_by` int(11) DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `status` enum('PENDING','APPROVED','REJECTED') DEFAULT 'PENDING',
  `reason` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `void_items` (
  `void_item_id` int(11) NOT NULL,
  `void_id` int(11) NOT NULL,
  `order_item_id` int(11) NOT NULL,
  `quantity` int(11) DEFAULT 1,
  `is_deleted` tinyint(1) DEFAULT 0,
  `deleted_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


CREATE TABLE `activity_logs` (
  `log_id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NULL,
  `username` VARCHAR(100) NOT NULL,
  `user_role` VARCHAR(50) NOT NULL,
  `action_type` VARCHAR(50) NOT NULL,
  `action_category` VARCHAR(50) DEFAULT 'SYSTEM',
  `description` TEXT NOT NULL,
  `reference_type` VARCHAR(50) NULL COMMENT 'e.g. order_id, stock_in_id, payment_id',
  `reference_id` INT NULL,
  `reference_number` VARCHAR(50) NULL,
  `ip_address` VARCHAR(45) NOT NULL DEFAULT '',
  `user_agent` TEXT NULL,
  `status` VARCHAR(50) NULL COMMENT 'Optional status snapshot (PENDING, APPROVED, etc.)',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_created_at (created_at),
  INDEX idx_user_role (user_role),
  INDEX idx_action_type (action_type),
  INDEX idx_action_category (action_category),
  INDEX idx_username (username),
  INDEX idx_reference (reference_type, reference_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `branch_settings` (
  `setting_id` int(11) NOT NULL AUTO_INCREMENT,
  `branch_name` varchar(100) NOT NULL DEFAULT 'House of Fries - Tagoloan',
  `latitude` decimal(10,7) NOT NULL DEFAULT 8.5372000,
  `longitude` decimal(10,7) NOT NULL DEFAULT 124.8269000,
  `radius_meters` int(11) NOT NULL DEFAULT 300,
  `geofence_enabled` tinyint(1) NOT NULL DEFAULT 1,
  `updated_by` int(11) DEFAULT NULL,
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`setting_id`),
  KEY `idx_branch_name` (`branch_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- ============================================================
-- PRIMARY KEYS, UNIQUE KEYS, AND INDEXES
-- ============================================================


ALTER TABLE `adjustments`
  ADD PRIMARY KEY (`adjustment_id`),
  ADD KEY `fk_adjustments_user` (`user_id`),
  ADD KEY `fk_adjustments_approved_by` (`approved_by`);

ALTER TABLE `adjustment_items`
  ADD PRIMARY KEY (`adjustment_item_id`),
  ADD KEY `fk_adjustment_items_adjustment` (`adjustment_id`),
  ADD KEY `fk_adjustment_items_raw_material` (`raw_material_id`);

ALTER TABLE `menu_categories`
  ADD PRIMARY KEY (`category_id`),
  ADD UNIQUE KEY `category_name` (`category_name`);

ALTER TABLE `menu_items`
  ADD PRIMARY KEY (`menu_item_id`),
  ADD KEY `category_id` (`category_id`);

ALTER TABLE `notifications`
  ADD PRIMARY KEY (`notification_id`),
  ADD KEY `fk_notifications_role` (`target_role_id`),
  ADD KEY `fk_notifications_user` (`target_user_id`);

ALTER TABLE `orders`
  ADD PRIMARY KEY (`order_id`),
  ADD KEY `fk_orders_table` (`table_id`),
  ADD KEY `fk_orders_user` (`user_id`);

ALTER TABLE `order_items`
  ADD PRIMARY KEY (`order_item_id`),
  ADD KEY `fk_order_items_order` (`order_id`),
  ADD KEY `fk_order_items_menu_item` (`menu_item_id`);

ALTER TABLE `payments`
  ADD PRIMARY KEY (`payment_id`),
  ADD KEY `fk_payments_order` (`order_id`),
  ADD KEY `fk_payments_user` (`user_id`);

ALTER TABLE `purchase_plans`
  ADD PRIMARY KEY (`plan_id`),
  ADD KEY `fk_purchase_plans_created_by` (`created_by`);

ALTER TABLE `purchase_plan_items`
  ADD PRIMARY KEY (`id`),
  ADD KEY `plan_id` (`plan_id`),
  ADD KEY `fk_purchase_plan_items_raw_material` (`raw_material_id`);

ALTER TABLE `raw_materials`
  ADD PRIMARY KEY (`raw_material_id`);

ALTER TABLE `raw_material_supplier`
  ADD PRIMARY KEY (`raw_material_supplier_id`),
  ADD KEY `fk_raw_material_supplier_raw_material` (`raw_material_id`),
  ADD KEY `fk_raw_material_supplier_supplier` (`supplier_id`);

ALTER TABLE `restaurant_table`
  ADD PRIMARY KEY (`table_id`);

ALTER TABLE `returns`
  ADD PRIMARY KEY (`return_id`),
  ADD KEY `fk_returns_user` (`user_id`),
  ADD KEY `fk_returns_approved_by` (`approved_by`);

ALTER TABLE `return_items`
  ADD PRIMARY KEY (`return_item_id`),
  ADD KEY `fk_return_items_return` (`return_id`),
  ADD KEY `fk_return_items_raw_material` (`raw_material_id`);

ALTER TABLE `roles`
  ADD PRIMARY KEY (`role_id`),
  ADD UNIQUE KEY `role_name` (`role_name`);

ALTER TABLE `spoilage`
  ADD PRIMARY KEY (`spoilage_id`),
  ADD KEY `fk_spoilage_user` (`user_id`),
  ADD KEY `fk_spoilage_raw_material` (`raw_material_id`),
  ADD KEY `fk_spoilage_approved_by` (`approved_by`);

ALTER TABLE `stock_in`
  ADD PRIMARY KEY (`stock_in_id`),
  ADD KEY `fk_stock_in_supplier` (`supplier_id`),
  ADD KEY `fk_stock_in_user` (`user_id`),
  ADD KEY `fk_stock_in_approved_by` (`approved_by`);

ALTER TABLE `stock_in_items`
  ADD PRIMARY KEY (`stock_in_item_id`),
  ADD KEY `fk_stock_in_items_stock_in` (`stock_in_id`),
  ADD KEY `fk_stock_in_items_raw_material` (`raw_material_id`);

ALTER TABLE `stock_out`
  ADD PRIMARY KEY (`stock_out_id`),
  ADD KEY `fk_stock_out_user` (`user_id`),
  ADD KEY `fk_stock_out_approved_by` (`approved_by`);

ALTER TABLE `stock_out_items`
  ADD PRIMARY KEY (`stock_out_item_id`),
  ADD KEY `fk_stock_out_items_stock_out` (`stock_out_id`),
  ADD KEY `fk_stock_out_items_raw_material` (`raw_material_id`);

ALTER TABLE `suppliers`
  ADD PRIMARY KEY (`supplier_id`);

ALTER TABLE `users`
  ADD PRIMARY KEY (`user_id`),
  ADD UNIQUE KEY `username` (`username`),
  ADD UNIQUE KEY `email_address` (`email_address`),
  ADD KEY `role_id` (`role_id`);

ALTER TABLE `voids`
  ADD PRIMARY KEY (`void_id`),
  ADD KEY `fk_voids_order` (`order_id`),
  ADD KEY `fk_voids_requested_by` (`requested_by`),
  ADD KEY `fk_voids_approved_by` (`approved_by`);

ALTER TABLE `void_items`
  ADD PRIMARY KEY (`void_item_id`),
  ADD KEY `fk_void_items_void` (`void_id`),
  ADD KEY `fk_void_items_order_item` (`order_item_id`);


-- ============================================================
-- AUTO_INCREMENT
-- ============================================================


ALTER TABLE `adjustments`
  MODIFY `adjustment_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=19;

ALTER TABLE `adjustment_items`
  MODIFY `adjustment_item_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=19;

ALTER TABLE `menu_categories`
  MODIFY `category_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=14;

ALTER TABLE `menu_items`
  MODIFY `menu_item_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=42;

ALTER TABLE `notifications`
  MODIFY `notification_id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `orders`
  MODIFY `order_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=121;

ALTER TABLE `order_items`
  MODIFY `order_item_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=406;

ALTER TABLE `payments`
  MODIFY `payment_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=109;

ALTER TABLE `purchase_plans`
  MODIFY `plan_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=13;

ALTER TABLE `purchase_plan_items`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=207;

ALTER TABLE `raw_materials`
  MODIFY `raw_material_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=31;

ALTER TABLE `raw_material_supplier`
  MODIFY `raw_material_supplier_id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `restaurant_table`
  MODIFY `table_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=24;

ALTER TABLE `returns`
  MODIFY `return_id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `return_items`
  MODIFY `return_item_id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `roles`
  MODIFY `role_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

ALTER TABLE `spoilage`
  MODIFY `spoilage_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=20;

ALTER TABLE `stock_in`
  MODIFY `stock_in_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=68;

ALTER TABLE `stock_in_items`
  MODIFY `stock_in_item_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=77;

ALTER TABLE `stock_out`
  MODIFY `stock_out_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=54;

ALTER TABLE `stock_out_items`
  MODIFY `stock_out_item_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=67;

ALTER TABLE `suppliers`
  MODIFY `supplier_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

ALTER TABLE `users`
  MODIFY `user_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=14;

ALTER TABLE `voids`
  MODIFY `void_id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `void_items`
  MODIFY `void_item_id` int(11) NOT NULL AUTO_INCREMENT;


-- ============================================================
-- FOREIGN KEY CONSTRAINTS
-- ============================================================


ALTER TABLE `adjustments`
  ADD CONSTRAINT `fk_adjustments_approved_by` FOREIGN KEY (`approved_by`) REFERENCES `users` (`user_id`),
  ADD CONSTRAINT `fk_adjustments_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`);

ALTER TABLE `adjustment_items`
  ADD CONSTRAINT `fk_adjustment_items_adjustment` FOREIGN KEY (`adjustment_id`) REFERENCES `adjustments` (`adjustment_id`),
  ADD CONSTRAINT `fk_adjustment_items_raw_material` FOREIGN KEY (`raw_material_id`) REFERENCES `raw_materials` (`raw_material_id`);

ALTER TABLE `menu_items`
  ADD CONSTRAINT `menu_items_ibfk_1` FOREIGN KEY (`category_id`) REFERENCES `menu_categories` (`category_id`);

ALTER TABLE `notifications`
  ADD CONSTRAINT `fk_notifications_role` FOREIGN KEY (`target_role_id`) REFERENCES `roles` (`role_id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_notifications_user` FOREIGN KEY (`target_user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE;

ALTER TABLE `orders`
  ADD CONSTRAINT `fk_orders_table` FOREIGN KEY (`table_id`) REFERENCES `restaurant_table` (`table_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_orders_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`);

ALTER TABLE `order_items`
  ADD CONSTRAINT `fk_order_items_menu_item` FOREIGN KEY (`menu_item_id`) REFERENCES `menu_items` (`menu_item_id`),
  ADD CONSTRAINT `fk_order_items_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`order_id`);

ALTER TABLE `payments`
  ADD CONSTRAINT `fk_payments_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`order_id`),
  ADD CONSTRAINT `fk_payments_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL;

ALTER TABLE `purchase_plans`
  ADD CONSTRAINT `fk_purchase_plans_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`user_id`);

ALTER TABLE `purchase_plan_items`
  ADD CONSTRAINT `purchase_plan_items_ibfk_1` FOREIGN KEY (`plan_id`) REFERENCES `purchase_plans` (`plan_id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_purchase_plan_items_raw_material` FOREIGN KEY (`raw_material_id`) REFERENCES `raw_materials` (`raw_material_id`);

ALTER TABLE `raw_material_supplier`
  ADD CONSTRAINT `fk_raw_material_supplier_raw_material` FOREIGN KEY (`raw_material_id`) REFERENCES `raw_materials` (`raw_material_id`),
  ADD CONSTRAINT `fk_raw_material_supplier_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`supplier_id`);

ALTER TABLE `returns`
  ADD CONSTRAINT `fk_returns_approved_by` FOREIGN KEY (`approved_by`) REFERENCES `users` (`user_id`),
  ADD CONSTRAINT `fk_returns_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`);

ALTER TABLE `return_items`
  ADD CONSTRAINT `fk_return_items_raw_material` FOREIGN KEY (`raw_material_id`) REFERENCES `raw_materials` (`raw_material_id`),
  ADD CONSTRAINT `fk_return_items_return` FOREIGN KEY (`return_id`) REFERENCES `returns` (`return_id`);

ALTER TABLE `spoilage`
  ADD CONSTRAINT `fk_spoilage_approved_by` FOREIGN KEY (`approved_by`) REFERENCES `users` (`user_id`),
  ADD CONSTRAINT `fk_spoilage_raw_material` FOREIGN KEY (`raw_material_id`) REFERENCES `raw_materials` (`raw_material_id`),
  ADD CONSTRAINT `fk_spoilage_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`);

ALTER TABLE `stock_in`
  ADD CONSTRAINT `fk_stock_in_approved_by` FOREIGN KEY (`approved_by`) REFERENCES `users` (`user_id`),
  ADD CONSTRAINT `fk_stock_in_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`supplier_id`),
  ADD CONSTRAINT `fk_stock_in_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`);

ALTER TABLE `stock_in_items`
  ADD CONSTRAINT `fk_stock_in_items_raw_material` FOREIGN KEY (`raw_material_id`) REFERENCES `raw_materials` (`raw_material_id`),
  ADD CONSTRAINT `fk_stock_in_items_stock_in` FOREIGN KEY (`stock_in_id`) REFERENCES `stock_in` (`stock_in_id`);

ALTER TABLE `stock_out`
  ADD CONSTRAINT `fk_stock_out_approved_by` FOREIGN KEY (`approved_by`) REFERENCES `users` (`user_id`),
  ADD CONSTRAINT `fk_stock_out_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`);

ALTER TABLE `stock_out_items`
  ADD CONSTRAINT `fk_stock_out_items_raw_material` FOREIGN KEY (`raw_material_id`) REFERENCES `raw_materials` (`raw_material_id`),
  ADD CONSTRAINT `fk_stock_out_items_stock_out` FOREIGN KEY (`stock_out_id`) REFERENCES `stock_out` (`stock_out_id`);

ALTER TABLE `users`
  ADD CONSTRAINT `users_ibfk_1` FOREIGN KEY (`role_id`) REFERENCES `roles` (`role_id`);

ALTER TABLE `voids`
  ADD CONSTRAINT `fk_voids_approved_by` FOREIGN KEY (`approved_by`) REFERENCES `users` (`user_id`),
  ADD CONSTRAINT `fk_voids_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`order_id`),
  ADD CONSTRAINT `fk_voids_requested_by` FOREIGN KEY (`requested_by`) REFERENCES `users` (`user_id`);

ALTER TABLE `void_items`
  ADD CONSTRAINT `fk_void_items_order_item` FOREIGN KEY (`order_item_id`) REFERENCES `order_items` (`order_item_id`),
  ADD CONSTRAINT `fk_void_items_void` FOREIGN KEY (`void_id`) REFERENCES `voids` (`void_id`);


SET FOREIGN_KEY_CHECKS = 1;

-- End of clean schema.


COMMIT;
