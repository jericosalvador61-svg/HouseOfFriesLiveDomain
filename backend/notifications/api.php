<?php
/**
 * ============================================================
 * House of Fries - Unified Notifications API (shared engine)
 * ------------------------------------------------------------
 * Authenticates via JWT (Bearer header or JSON body token) and
 * returns ONLY the notifications targeted at the logged-in
 * user's role (or their user_id). Each module's
 * get_notifications.php is a thin wrapper around this file.
 *
 * Response: { success, items: [...], unread_count: N }
 * ============================================================
 */

require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../auth_middleware.php';

if (!function_exists('hof_notifications_api')) {
    function hof_notifications_api($limit = 25) {
        header('Content-Type: application/json');

        $user = authenticate(); // any active staff role; 401 JSON exit if invalid

        $roleId = null;
        try {
            global $pdo;
            $stmt = $pdo->prepare("SELECT role_id FROM roles WHERE role_name = ? LIMIT 1");
            $stmt->execute([$user['role']]);
            $roleId = $stmt->fetchColumn() ?: null;
        } catch (Exception $e) { /* keep null */ }

        try {
            // Unread count first (cheap)
            $stmtCnt = $pdo->prepare("
                SELECT COUNT(*) FROM notifications
                WHERE is_read = 0
                  AND (target_user_id = ? OR (target_role_id = ? AND target_user_id IS NULL))
            ");
            $stmtCnt->execute([$user['user_id'], $roleId]);
            $unread = (int)$stmtCnt->fetchColumn();

            $stmt = $pdo->prepare("
                SELECT notification_id AS id, type, title, message, link_url AS url,
                       is_read, created_at
                FROM notifications
                WHERE target_user_id = ? OR (target_role_id = ? AND target_user_id IS NULL)
                ORDER BY created_at DESC, notification_id DESC
                LIMIT " . (int)$limit . "
            ");
            $stmt->execute([$user['user_id'], $roleId]);
            $items = $stmt->fetchAll(PDO::FETCH_ASSOC);

            foreach ($items as &$item) {
                $item['id']     = (int)$item['id'];
                $item['is_read'] = (int)$item['is_read'];
                $item['read']   = (bool)(int)$item['is_read'];
                if ($item['url'] === null) $item['url'] = '#';
            }
            unset($item);

            echo json_encode([
                'success'      => true,
                'items'        => $items,
                'unread_count' => $unread
            ]);
        } catch (Exception $e) {
            // Table not migrated yet -> graceful empty state instead of error spam
            echo json_encode([
                'success'      => true,
                'items'        => [],
                'unread_count' => 0,
                'hint'         => 'Migrations consolidated at bottom of sql/house_of_fries_deploy.sql'
            ]);
        }
        exit;
    }
}
