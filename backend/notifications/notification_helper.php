<?php
/**
 * ============================================================
 * House of Fries - Notification Engine (database-backed)
 * ------------------------------------------------------------
 * Every notification is stored in the `notifications` table and
 * targeted at a ROLE (related work only) or a specific USER.
 *
 * Usage (after requiring db.php):
 *   require_once __DIR__ . '/../notifications/notification_helper.php';
 *   hof_notify_roles($pdo, 'order_new', 'New Order', '#HOF202600001 awaiting payment',
 *                    ['Cashier'], '/public/cashier/cashier_dashboard.html');
 *
 * All functions fail SILENTLY so they can never break the main flow.
 * ============================================================
 */

if (!function_exists('hof_role_ids')) {
    /**
     * Resolve role names (e.g. ['Cashier','Admin']) -> [3,1].
     */
    function hof_role_ids($pdo, array $roleNames) {
        static $cache = null;
        try {
            if ($cache === null) {
                $cache = [];
                foreach ($pdo->query("SELECT role_id, role_name FROM roles") as $row) {
                    $cache[strtolower(trim($row['role_name']))] = (int)$row['role_id'];
                }
            }
            $ids = [];
            foreach ($roleNames as $name) {
                $key = strtolower(trim($name));
                if (isset($cache[$key])) $ids[] = $cache[$key];
            }
            return array_unique($ids);
        } catch (Exception $e) {
            return [];
        }
    }
}

if (!function_exists('hof_notify')) {
    /**
     * Insert one notification for specific role IDs and/or a user ID.
     */
    function hof_notify($pdo, $type, $title, $message, array $roleIds = [], $targetUserId = null, $linkUrl = null) {
        try {
            $stmt = $pdo->prepare("
                INSERT INTO notifications (target_role_id, target_user_id, type, title, message, link_url)
                VALUES (?, ?, ?, ?, ?, ?)
            ");
        } catch (Exception $e) {
            return false; // table missing / DB issue - never break caller
        }

        try {
            if (empty($roleIds) && $targetUserId === null) {
                // Broadcast to every role (rare - system-wide alerts)
                foreach ([1, 2, 3, 4, 5, 6] as $rid) {
                    $stmt->execute([$rid, null, $type, $title, $message, $linkUrl]);
                }
                return true;
            }
            foreach ($roleIds as $rid) {
                $stmt->execute([$rid, null, $type, $title, $message, $linkUrl]);
            }
            if ($targetUserId !== null) {
                $stmt->execute([null, $targetUserId, $type, $title, $message, $linkUrl]);
            }
            return true;
        } catch (Exception $e) {
            return false;
        }
    }
}

if (!function_exists('hof_notify_roles')) {
    /**
     * Convenience wrapper: notify by ROLE NAMES.
     * e.g. hof_notify_roles($pdo, 'order_new', 'New Order', 'msg', ['Cashier','Waiter']);
     */
    function hof_notify_roles($pdo, $type, $title, $message, array $roleNames, $linkUrl = null, $targetUserId = null) {
        $ids = hof_role_ids($pdo, $roleNames);
        return hof_notify($pdo, $type, $title, $message, $ids, $targetUserId, $linkUrl);
    }
}

if (!function_exists('hof_check_low_stock')) {
    /**
     * After stock movements: create low-stock / out-of-stock notifications
     * for the Inventory Staff. De-duplicates unread duplicates.
     * $materialIds = array of raw_material_id that were just changed.
     */
    function hof_check_low_stock($pdo, array $materialIds) {
        $materialIds = array_values(array_unique(array_map('intval', $materialIds)));
        if (empty($materialIds)) return;

        try {
            $placeholders = implode(',', array_fill(0, count($materialIds), '?'));
            $stmt = $pdo->prepare("
                SELECT raw_material_id, raw_material_name, current_quantity, reorder_level, unit
                FROM raw_materials
                WHERE raw_material_id IN ($placeholders) AND status = 'ACTIVE'
                  AND current_quantity <= reorder_level
            ");
            $stmt->execute($materialIds);
            $lowItems = $stmt->fetchAll(PDO::FETCH_ASSOC);

            if (empty($lowItems)) return;

            $checkDup = $pdo->prepare("
                SELECT COUNT(*) FROM notifications
                WHERE type = ? AND message LIKE CONCAT('%', ?, '%')
                  AND is_read = 0 AND created_at > (NOW() - INTERVAL 6 HOUR)
            ");

            foreach ($lowItems as $m) {
                $outOfStock = (float)$m['current_quantity'] <= 0;
                $type  = $outOfStock ? 'out_of_stock' : 'low_stock';
                $title = $outOfStock ? 'Out of Stock' : 'Low Stock Alert';
                $msg   = $outOfStock
                    ? $m['raw_material_name'] . ' is OUT OF STOCK! Restock immediately.'
                    : $m['raw_material_name'] . ' is running low (' . (0 + $m['current_quantity']) . ' ' . $m['unit'] . ' left).';

                $checkDup->execute([$type, $m['raw_material_name']]);
                if ((int)$checkDup->fetchColumn() > 0) continue; // already alerted recently

                hof_notify(
                    $pdo, $type, $title, $msg,
                    hof_role_ids($pdo, ['Inventory Staff']),
                    null,
                    '/public/inventoryStaff/inventoryStaff_RawMaterials.html'
                );
            }
        } catch (Exception $e) {
            /* silent */
        }
    }
}
