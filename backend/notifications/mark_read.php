<?php
/**
 * ============================================================
 * House of Fries - Mark notification(s) as read
 * POST JSON: { "id": 123 }   -> mark one
 *            { "all": true } -> mark all for my role/user
 * ============================================================
 */
header('Content-Type: application/json');

require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../log_activity_helper.php'; // REQ-050
$user = authenticate();

$data = json_decode(file_get_contents('php://input'), true);
$id   = isset($data['id']) ? (int)$data['id'] : null;
$all  = !empty($data['all']);

try {
    // Resolve the caller's role_id so users can only touch their own rows
    $stmtRole = $pdo->prepare("SELECT role_id FROM roles WHERE role_name = ? LIMIT 1");
    $stmtRole->execute([$user['role']]);
    $roleId = $stmtRole->fetchColumn() ?: 0;

    if ($all) {
        $stmt = $pdo->prepare("
            UPDATE notifications SET is_read = 1
            WHERE is_read = 0
              AND (target_user_id = ? OR (target_role_id = ? AND target_user_id IS NULL))
        ");
        $stmt->execute([$user['user_id'], $roleId]);
    } elseif ($id) {
        $stmt = $pdo->prepare("
            UPDATE notifications SET is_read = 1
            WHERE notification_id = ?
              AND (target_user_id = ? OR (target_role_id = ? AND target_user_id IS NULL))
        ");
        $stmt->execute([$id, $user['user_id'], $roleId]);
    } else {
        echo json_encode(['success' => false, 'message' => 'Nothing to mark']);
        exit;
    }

    // REQ-050: log notification read (low-priority, still a user action)
    logActivity($pdo, (int)$user['user_id'], $user['username'] ?? 'user', $user['role'] ?? 'User',
        'NOTIFICATION_READ', $all ? 'Marked all notifications as read' : ("Marked notification #{$id} as read"),
        'notification', $all ? null : (int)$id, null, 'READ');

    echo json_encode(['success' => true]);
} catch (Exception $e) {
    echo json_encode(['success' => false, 'message' => 'Notifications table missing. Import sql/house_of_fries_deploy.sql (consolidated migrations)']);
}
