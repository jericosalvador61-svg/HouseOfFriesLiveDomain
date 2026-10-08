-- ============================================================
-- The House of Fries - Tagoloan Branch
-- SEED DATA ONLY
-- For use with: house_of_fries_real_db_clean.sql (schema)
-- Database: house_of_fries_db
-- ============================================================

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET AUTOCOMMIT = 0;
START TRANSACTION;
SET time_zone = "+00:00";
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- 1. ROLES (6 roles for POS system)
-- ============================================================
INSERT INTO `roles` (`role_id`, `role_name`) VALUES
(1, 'Admin'),
(2, 'Inventory Staff'),
(3, 'Cashier'),
(4, 'Kitchen Staff'),
(5, 'Supervisor'),
(6, 'Waiter');

-- ============================================================
-- 2. USERS (12 users across all roles)
-- Passwords are bcrypt hashes; admin login: jester / pajara123
-- ============================================================
INSERT INTO `users` (`user_id`, `username`, `password`, `first_name`, `last_name`, `gender`, `contact_number`, `email_address`, `social_account`, `role_id`, `status`, `must_change_password`, `temp_code`, `login_attempts`, `locked_until`, `lock_level`, `last_failed_attempt`, `created_at`) VALUES
(1, 'jester', '$2y$10$1YlAZkxBQmM7QrAtBgLYmOzHN05Ir9oe6KOZymPGBG/OuUfed9oE.', 'Jester Nimrod', 'Pajara', 'Male', '09694659734', 'jevi.pajara.coc@phinmaed.com', NULL, 1, 'Active', 0, NULL, 0, NULL, 0, NULL, '2026-01-26 21:43:39'),
(2, 'jerico', '$2y$10$X8lL74zEo/lxXJk4gafQqeeRA3iOHGVh5rskpC144yTk92yX6UkSG', 'Jericoeeeee', 'Salvador', 'Male', '09888888888', 'jeda.salvador.coc@phinmaed.com', NULL, 5, 'Active', 0, NULL, 0, NULL, 0, NULL, '2026-01-29 08:57:39'),
(3, 'elmer', '$2y$10$6FtysjnnPwaVAntncqt8A.XtND1O72TKHkY8Aa2qyoSTfCuqbGRoS', 'Elmer Jings', 'Mandaya', 'Male', '09887654341', 'elpa.mandaya.coc@phinmaed.com', NULL, 3, 'Active', 0, NULL, 0, NULL, 0, NULL, '2026-01-29 09:15:10'),
(4, 'sryne', '$2y$10$NVQ355xxx3hwODpcOWfol.NUR0aoWRUe.vIfv4qrddPwDaruRO7gC', 'Sryne Isaiah', 'Macas', 'Male', '09782716253', 'srbe.macas.coc@phinmaed.com', NULL, 4, 'Active', 0, NULL, 0, NULL, 0, NULL, '2026-01-29 09:19:32'),
(5, 'jazel', '$2y$10$DgTLhvuYs6W58ljTQQ4Vaee/SdB0HfsbIpJ4ZxAX2iXiBquF6z8wm', 'Jazel Mae Angel', 'Apdua', 'Female', '09090981234', 'jaal.apdua.coc@phinmaed.com', NULL, 1, 'Inactive', 0, NULL, 0, NULL, 0, NULL, '2026-01-29 15:57:59'),
(6, 'zyrel', '$2y$10$Oj8HSS9laUJjiAbVO.NyO.pC96VAB.6dCn9v4PSDmNPjk9psuOwvu', 'Zyrel Jean', 'Dumdum', 'Female', '0988788765', 'zyab.dumdum.coc@phinmaed.com', NULL, 1, 'Inactive', 0, NULL, 0, NULL, 0, NULL, '2026-01-29 16:50:08'),
(7, 'rona', '$2y$10$clD6UNYJduQQ6K.jvxZhL.vnkx0jX95GdgmZLPtX5KHYw.16pVA7.', 'Ronalyn', 'Coquilla', 'Female', '09999999999', 'romo.coquilla.coc@phinmaed.com', NULL, 2, 'Active', 0, NULL, 0, NULL, 0, NULL, '2026-02-03 05:59:59'),
(8, 'emmie', '$2y$10$LqZuz.G5QfbNAhYsvsfVRukiLM5FlIBuGeU9H5/KQjLnI3B0tDPIG', 'Emmie', 'Binongo', 'Female', '09111111111', 'emas.binongo.coc@phinmaed.com', '', 3, 'Active', 0, NULL, 0, NULL, 0, NULL, '2026-02-03 12:36:27'),
(9, 'anna', '$2y$10$jkGnVOjUnG/Gm33ZBj0dGOv0BXSPEnBD5zc4P/IuscX81KiAWCUaG', 'anna leah', 'zayas', 'Female', '09987676543', 'anna@gmail.com', NULL, 1, 'Active', 0, NULL, 0, NULL, 0, NULL, '2026-02-18 05:05:44'),
(10, 'steph', '$2y$10$CC1rPbQtWbRH9zQQCqFSjeMeGnlMe/osbzEZMmBh25V7y2sd2piRS', 'Stephen', 'Curry', 'Male', '09887799876', 'steph@gmail.com', '', 4, 'Active', 0, NULL, 0, NULL, 0, NULL, '2026-05-03 15:35:55'),
(11, 'larken', '$2y$10$/Lj0nO4/o6wNxOyINX.HAeL.Zb.JcqL9lKmBVHqqnmbLYzaj6HIOe', 'larken', 'ditan', 'Male', '09309378244', NULL, NULL, 2, 'Active', 0, NULL, 0, NULL, 0, NULL, '2026-07-10 08:04:57'),
(12, 'alexandra', '$2y$10$nH5jvwKtDGqYHpKm74EUvezz1GJxHtABxaMzyvrB3xZgkz5X4FqCW', 'alexandra', 'barcelon', 'Female', '09888888888', NULL, NULL, 6, 'Active', 0, NULL, 0, NULL, 0, NULL, '2026-07-10 08:06:31');

-- ============================================================
-- 3. MENU CATEGORIES (13 categories)
-- ============================================================
INSERT INTO `menu_categories` (`category_id`, `category_name`, `status`) VALUES
(1, 'Chicken Meal', 'Active'),
(2, 'Combo Meal', 'Active'),
(3, 'Steak Meal', 'Active'),
(4, 'Bucket Chicken', 'Active'),
(5, 'Mukbang', 'Active'),
(6, 'Seafood Rice Meal', 'Active'),
(7, 'Footlong', 'Active'),
(8, 'Burgers', 'Active'),
(9, 'Pasta & Salad', 'Active'),
(10, 'Fries', 'Active'),
(11, 'Smoothie', 'Active'),
(12, 'Juice', 'Active'),
(13, 'Milktea', 'Active');

-- ============================================================
-- 4. MENU ITEMS (36 items across all categories)
-- ============================================================
INSERT INTO `menu_items` (`menu_item_id`, `item_name`, `description`, `image_url`, `category_id`, `price`, `status`, `created_at`, `estimated_prep_time_minutes`) VALUES
(6, 'R1C', '1pc. Chicken w/ Rice & Drink', '/HOF1/images/menu/69c203c16d201_R1C.png', 1, '99.00', 'Available', '2026-03-24 03:23:45', 10),
(7, 'R2C', '2pcs. Chicken w/ Rice & Drink', '/HOF1/images/menu/69c2042076d8f_R2C.png', 1, '160.00', 'Available', '2026-03-24 03:25:20', 10),
(8, 'F1C', '1pc. Chicken w/ Fries & Drink', '/HOF1/images/menu/69c204b7c1ffe_F1C.png', 1, '124.00', 'Available', '2026-03-24 03:27:51', 10),
(9, 'F2C', '2pcs. Chicken w/ Fries & Drink', '/HOF1/images/menu/69c2054475469_F2C.png', 1, '175.00', 'Available', '2026-03-24 03:30:12', 10),
(10, 'HF1', '1pc. Chicken w/ Rice, Spaghetti, and 2pcs. Lumpia', '/HOF1/images/menu/69c206359ef68_HF1.png', 2, '149.00', 'Available', '2026-03-24 03:34:13', 10),
(11, 'HF2', '1pc Chicken w/ Rice, Spaghetti, and Burger Steak', '/HOF1/images/menu/69c2069588ba6_HF2.png', 2, '159.00', 'Available', '2026-03-24 03:35:49', 10),
(12, 'HF3', 'Fish Fillet w/ Rice, Spaghetti, and 2pcs. Lumpia', '/HOF1/images/menu/69c206d393dae_HF3.png', 2, '169.00', 'Available', '2026-03-24 03:36:51', 10),
(13, 'BS1', '1pc. Steak w/ Rice & Drink', '/HOF1/images/menu/69c2076cab51d_BS1.png', 3, '99.00', 'Available', '2026-03-24 03:39:24', 10),
(14, 'BS2', '2pcs. Steak w/ Rice & Drink', '/HOF1/images/menu/69c2079815cec_BS2.png', 3, '145.00', 'Available', '2026-03-24 03:40:08', 10),
(15, 'CB1', '6pcs. Chicken w/ 3pcs. Rice', '/HOF1/images/menu/69c2085f74329_CB1.png', 4, '529.00', 'Available', '2026-03-24 03:43:27', 10),
(16, 'CB2', '6pcs. Chicken w/ 2 Regular Fries', '/HOF1/images/menu/69c208e892500_CB2.png', 4, '569.00', 'Available', '2026-03-24 03:45:44', 10),
(17, 'CB3', '6pcs. Chicken w/ 2 Spaghetti', '/HOF1/images/menu/69c2093b64ce4_CB3.png', 4, '659.00', 'Available', '2026-03-24 03:47:07', 10),
(18, 'Mukbang', '3pcs. Chicken, 3pcs. Fried Shrimp, 3pcs. Calamares, 3pcs. Burger Steak, 1 Ultimate Cheesy Fries, 1 Spaghetti, & 1 Milky Cheddar', '/HOF1/images/menu/69c20b39d6491_Mukbang.png', 5, '649.00', 'Available', '2026-03-24 03:55:37', 10),
(19, 'Lumpiang Shanghai', '', '/HOF1/images/menu/69c20cac6dbe9_Lumpiang Shanghai.png', 6, '69.00', 'Available', '2026-03-24 04:01:48', 10),
(20, 'Fish Fillet', '', '/HOF1/images/menu/69c20d7c87283_Fish Fillet.png', 6, '149.00', 'Available', '2026-03-24 04:05:16', 10),
(21, 'Calamares', '', '/HOF1/images/menu/69c20e1c824bc_Calamares.png', 6, '99.00', 'Available', '2026-03-24 04:07:56', 10),
(22, 'Tempura Shrimp', '', '/HOF1/images/menu/69c20ee84ddbe_Tempura Shrimp.png', 6, '119.00', 'Available', '2026-03-24 04:11:20', 10),
(23, 'Cheesy Shrimp', '', '/HOF1/images/menu/69c20f3e32bb9_Cheesy Shrimp.png', 6, '129.00', 'Available', '2026-03-24 04:12:46', 10),
(24, 'Milky Cheddar Footlong', '', '/HOF1/images/menu/6a3f61d02d11c_Gemini_Generated_Image_1z5qmj1z5qmj1z5q.png', 7, '75.00', 'Available', '2026-06-27 05:38:24', 10),
(25, 'Hot Chili Footlong', '', '/HOF1/images/menu/6a3f61f0ebe5b_Gemini_Generated_Image_1z5qmj1z5qmj1z5q.png', 7, '79.00', 'Available', '2026-06-27 05:38:56', 10),
(26, 'Sunrise Cheese Footlong', '', '/HOF1/images/menu/6a3f62094ceef_Gemini_Generated_Image_1z5qmj1z5qmj1z5q.png', 7, '89.00', 'Available', '2026-06-27 05:39:21', 10),
(27, 'Chicago Footlong', '', '/HOF1/images/menu/6a3f621d3ebdf_Gemini_Generated_Image_1z5qmj1z5qmj1z5q.png', 7, '89.00', 'Available', '2026-06-27 05:39:41', 10),
(28, 'HoF Burger', '', '/HOF1/images/menu/6a3f625000b8b_Gemini_Generated_Image_337erl337erl337e.png', 8, '55.00', 'Available', '2026-06-27 05:40:32', 10),
(29, 'Classic Burger', '', '/HOF1/images/menu/6a3f627acd627_Gemini_Generated_Image_337erl337erl337e.png', 8, '65.00', 'Available', '2026-06-27 05:41:14', 10),
(30, 'Pinecheese Burger', '', '/HOF1/images/menu/6a3f629bb36ba_Gemini_Generated_Image_337erl337erl337e.png', 8, '75.00', 'Available', '2026-06-27 05:41:47', 10),
(31, 'Triple Double Burger', '', '/HOF1/images/menu/6a3f62b088df6_Gemini_Generated_Image_337erl337erl337e.png', 8, '99.00', 'Available', '2026-06-27 05:42:08', 10),
(32, 'Spaghetti', '', '/HOF1/images/menu/6a3f63573b4d2_spag.png', 9, '79.00', 'Available', '2026-06-27 05:44:55', 10),
(33, 'Carbonara', '', '/HOF1/images/menu/6a3f63ae03377_Carbonara.png', 9, '129.00', 'Available', '2026-06-27 05:46:22', 10),
(34, 'Cheesy Fries', 'Regular', '/HOF1/images/menu/6a3f646e2c044_Gemini_Generated_Image_apu66uapu66uapu6.png', 10, '69.00', 'Available', '2026-06-27 05:49:34', 10),
(35, 'Cheesy Fries', 'Ultimate Size', '/HOF1/images/menu/6a3f6480ade8e_Gemini_Generated_Image_apu66uapu66uapu6.png', 10, '89.00', 'Available', '2026-06-27 05:49:52', 10),
(36, 'Mango Smoothie', '', '/HOF1/images/menu/6a3f6537d2ed6_Gemini_Generated_Image_30z2zi30z2zi30z2.png', 11, '89.00', 'Available', '2026-06-27 05:52:55', 10),
(37, 'Avocado Smoothie', '', '/HOF1/images/menu/6a3f654d6eecd_avo.png', 11, '89.00', 'Unavailable', '2026-06-27 05:53:17', 10),
(38, 'Pineapple Juice', '', '/HOF1/images/menu/6a3f65699fd99_pineapple juice.png', 12, '30.00', 'Available', '2026-06-27 05:53:45', 10),
(39, 'Lemon tea Juice', '', '/HOF1/images/menu/6a3f6584292f4_lemon tea juice.png', 12, '30.00', 'Available', '2026-06-27 05:54:12', 10),
(41, 'Pizza', '', 'images/menu/6a5cf1443d82b_images (2).jpg', 9, '145.00', 'Available', '2026-07-19 15:45:54', 10);

-- ============================================================
-- 5. SUPPLIERS
-- ============================================================
INSERT INTO `suppliers` (`supplier_id`, `supplier_name`, `contact_person`, `contact_number`, `email`, `address`, `status`, `created_at`, `updated_at`) VALUES
(1, 'paldo', 'Cagayan de Oro College-PHINMA Education Network', '09782716253', 'jericosalvador609@gmail.com', 'max suniel street, Carmen', 'ACTIVE', '2026-07-21 15:43:51', '2026-07-21 15:48:56');

-- ============================================================
-- 6. RAW MATERIALS (15 inventory items)
-- ============================================================
INSERT INTO `raw_materials` (`raw_material_id`, `raw_material_name`, `description`, `img_url`, `unit`, `current_quantity`, `reorder_level`, `status`, `cost_per_unit`, `expiration_tracking`, `is_perishable`, `created_at`, `updated_at`) VALUES
(13, 'Potatoes', '', 'images/inventory/raw_13_1776748216.jpg', 'Kilogram (kg)', '0.00', '25.00', 'ACTIVE', '200.00', 0, 1, '2026-02-21 18:45:46', '2026-07-12 17:11:21'),
(16, 'Salt', '', 'images/rawMaterials/1771700226_images.jpg', 'Kilogram (kg)', '7.00', '15.00', 'ACTIVE', '20.00', 0, 0, '2026-02-21 18:57:06', '2026-07-19 17:08:01'),
(17, 'Bread', '', 'images/rawMaterials/1771700639_5AM_Footlong_Buns_6s__26793.jpg', 'Pack (pk)', '4.00', '10.00', 'ACTIVE', '120.00', 0, 1, '2026-02-21 19:03:59', '2026-07-19 17:22:12'),
(18, 'Cooking Oil', '', 'images/rawMaterials/1771702500_0_699a08e4426bb.jpg', 'Kilogram (kg)', '4.00', '5.00', 'ACTIVE', '140.00', 0, 0, '2026-02-21 19:35:00', '2026-07-19 17:21:56'),
(20, 'Burger Patty', '', 'images/rawMaterials/1771703185_0_699a0b91c9d45.webp', 'Pack (pk)', '0.00', '10.00', 'ACTIVE', '45.00', 0, 1, '2026-02-21 19:46:25', '2026-07-12 17:11:21'),
(21, 'Eggs', '', 'images/rawMaterials/1771703403_0_699a0c6b55fd0.jpg', 'Pieces (pcs)', '0.00', '25.00', 'ACTIVE', '10.00', 0, 1, '2026-02-21 19:50:03', '2026-07-12 17:11:21'),
(22, 'Mango', '', 'images/inventory/raw_22_1776748246.png', 'Kilogram (kg)', '0.00', '5.00', 'ACTIVE', '75.00', 0, 1, '2026-02-24 13:45:48', '2026-07-12 17:11:21'),
(23, 'Hotdog', '', '', 'Pack (pk)', '10.00', '25.00', 'ACTIVE', '75.00', 0, 1, '2026-02-24 16:32:05', '2026-07-12 18:38:25'),
(24, 'Ice Cream (Vanilla)', '', 'images/rawMaterials/1776916824_0_69e9995886833.jpg', 'Milliliters (ml)', '0.00', '15.00', 'ACTIVE', '200.00', 0, 1, '2026-04-23 04:00:24', '2026-07-12 17:11:21'),
(25, 'Ice Cream (Ube)', '', 'images/rawMaterials/1777962271_0_69f98d1f1e212.avif', 'Milliliters (ml)', '0.00', '15.00', 'ACTIVE', '200.00', 0, 1, '2026-05-05 06:24:31', '2026-07-12 17:11:21'),
(26, 'Soy Sauce', '', 'images/rawMaterials/1780727797_0_6a23bff5c28c0.png', 'Milliliters (ml)', '5.00', '10.00', 'ACTIVE', '140.00', 0, 0, '2026-06-06 06:36:37', '2026-06-29 03:15:52'),
(27, 'Chicken', '', 'images/rawMaterials/1781077608_0_6a2916687ad4e.jpg', 'Kilogram (kg)', '0.00', '10.00', 'ACTIVE', '220.00', 1, 1, '2026-06-10 07:46:48', '2026-07-12 17:11:21'),
(28, 'pepperoni', '', 'images/rawMaterials/1784476158_0_6a5cf1fee5ef6.jpg', 'Kilogram (kg)', '5.00', '10.00', 'ACTIVE', '1.00', 1, 1, '2026-07-19 15:49:18', '2026-07-19 16:53:41'),
(29, 'Chicken Powder', '', 'images/rawMaterials/1784478184_0_6a5cf9e8bd0be.jpg', 'Kilogram (kg)', '0.00', '3.00', 'ACTIVE', '0.00', 0, 0, '2026-07-19 16:23:04', '2026-07-19 16:23:04'),
(30, 'Onion Powder', '', 'images/rawMaterials/1784478916_0_6a5cfcc486804.jpg', 'Grams (g)', '0.00', '0.00', 'ACTIVE', '0.00', 0, 0, '2026-07-19 16:35:16', '2026-07-19 16:35:16');

-- ============================================================
-- 7. RESTAURANT TABLES (10 DINE_IN + 1 TAKEOUT)
-- ============================================================
INSERT INTO `restaurant_table` (`table_id`, `table_number`, `table_type`, `status`, `qr_code`, `is_deleted`, `deleted_at`, `created_at`, `updated_at`) VALUES
(1, '1', 'DINE_IN', 'AVAILABLE', NULL, 0, NULL, '2026-03-24 02:32:41', '2026-03-24 02:32:41'),
(2, '2', 'DINE_IN', 'AVAILABLE', NULL, 0, NULL, '2026-03-24 02:32:42', '2026-03-24 02:32:42'),
(3, '3', 'DINE_IN', 'AVAILABLE', NULL, 0, NULL, '2026-03-24 02:32:43', '2026-03-24 02:32:43'),
(4, '4', 'DINE_IN', 'AVAILABLE', NULL, 0, NULL, '2026-03-24 02:32:44', '2026-03-24 02:32:44'),
(5, '5', 'DINE_IN', 'AVAILABLE', NULL, 0, NULL, '2026-03-24 02:32:45', '2026-03-24 02:32:45'),
(6, '6', 'DINE_IN', 'AVAILABLE', NULL, 0, NULL, '2026-03-24 02:32:46', '2026-03-24 02:32:46'),
(7, '7', 'DINE_IN', 'AVAILABLE', NULL, 0, NULL, '2026-03-24 02:32:47', '2026-03-24 02:32:47'),
(8, '8', 'DINE_IN', 'AVAILABLE', NULL, 0, NULL, '2026-03-24 02:32:48', '2026-03-24 02:32:48'),
(9, '9', 'DINE_IN', 'AVAILABLE', NULL, 0, NULL, '2026-03-24 02:32:49', '2026-03-24 02:32:49'),
(10, '10', 'DINE_IN', 'AVAILABLE', NULL, 0, NULL, '2026-03-24 02:32:50', '2026-03-24 02:32:50'),
(11, 'TA-1', 'TAKEOUT', 'AVAILABLE', NULL, 0, NULL, '2026-03-24 02:33:00', '2026-03-24 02:33:00');

-- ============================================================
-- 8. RAW MATERIAL - SUPPLIER LINK
-- ============================================================
INSERT INTO `raw_material_supplier` (`raw_material_supplier_id`, `raw_material_id`, `supplier_id`, `supply_price`, `lead_time_days`, `min_order_quantity`, `status`, `created_at`, `updated_at`) VALUES
(1, 13, 1, '200.00', 3, '1.00', 'ACTIVE', '2026-07-21 15:45:52', '2026-07-21 15:45:52'),
(2, 16, 1, '20.00', 2, '5.00', 'ACTIVE', '2026-07-21 15:46:35', '2026-07-21 15:46:35'),
(3, 17, 1, '120.00', 2, '5.00', 'ACTIVE', '2026-07-21 15:46:56', '2026-07-21 15:46:56'),
(4, 18, 1, '140.00', 2, '3.00', 'ACTIVE', '2026-07-21 15:47:23', '2026-07-21 15:47:23'),
(5, 20, 1, '45.00', 2, '5.00', 'ACTIVE', '2026-07-21 15:47:47', '2026-07-21 15:47:47'),
(6, 21, 1, '10.00', 2, '10.00', 'ACTIVE', '2026-07-21 15:48:06', '2026-07-21 15:48:06'),
(7, 22, 1, '75.00', 3, '3.00', 'ACTIVE', '2026-07-21 15:48:29', '2026-07-21 15:48:29'),
(8, 23, 1, '75.00', 2, '5.00', 'ACTIVE', '2026-07-21 15:48:56', '2026-07-21 15:48:56');

-- ============================================================
-- 9. BRANCH SETTINGS
-- ============================================================
INSERT INTO `branch_settings` (`branch_name`, `latitude`, `longitude`, `radius_meters`, `geofence_enabled`)
VALUES ('House of Fries - Tagoloan', 8.5372000, 124.8269000, 300, 1);



-- ============================================================
-- REQ-040: MENU CHOICES & ADD-ONS SEED (idempotent)
-- Binds choices to menu items by NAME; safe to re-run.
-- ============================================================
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

-- ============================================================
-- REQ-049: DISCOUNT TYPES SEED
-- ============================================================
INSERT INTO discount_types (name, percent) VALUES ('Senior Citizen', 10.00), ('PWD', 10.00)
  ON DUPLICATE KEY UPDATE name = VALUES(name);

-- ============================================================
-- CUSTOMER ACCOUNTS: no seed rows — accounts are created at
-- runtime via the customer register endpoint. Table DDL lives
-- in house_of_fries_real_db_clean.sql.
-- ============================================================

-- =============================================================
-- RESET AUTO_INCREMENT
-- =============================================================
ALTER TABLE `roles` MODIFY `role_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;
ALTER TABLE `users` MODIFY `user_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=13;
ALTER TABLE `menu_categories` MODIFY `category_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=14;
ALTER TABLE `menu_items` MODIFY `menu_item_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=42;
ALTER TABLE `suppliers` MODIFY `supplier_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;
ALTER TABLE `raw_materials` MODIFY `raw_material_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=31;
ALTER TABLE `restaurant_table` MODIFY `table_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=12;

ALTER TABLE `menu_item_choices` MODIFY `menu_choice_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;
ALTER TABLE `menu_item_addons` MODIFY `menu_addon_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;
ALTER TABLE `discount_types` MODIFY `discount_type_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;
ALTER TABLE `raw_material_supplier` MODIFY `raw_material_supplier_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=9;

SET FOREIGN_KEY_CHECKS = 1;
COMMIT;
SET AUTOCOMMIT = 1;