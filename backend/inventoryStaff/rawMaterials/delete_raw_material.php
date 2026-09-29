<?php
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../auth_middleware.php';
require_once __DIR__ . '/../../log_activity_helper.php';
header('Content-Type: application/json');

$auth = authenticate(['Admin', 'Inventory Staff', 'Supervisor']);
$userId = (int)$auth['user_id'];
$username = $auth['username'] ?? 'unknown';
$role = $auth['role'] ?? '';

// Using $_POST because your JS sends FormData
$id = $_POST['raw_material_id'] ?? null;

if (!$id) {
    echo json_encode(['status' => 'error', 'message' => 'ID missing']);
    exit;
}

/**
 * SOFT DELETE LOGIC
 * Instead of removing the row, we set the status to 'INACTIVE'.
 */
try {
    $stmt = $pdo->prepare("UPDATE raw_materials SET status = 'INACTIVE' WHERE raw_material_id = ?");

    if ($stmt->execute([$id])) {
        logActivity($pdo, $userId, $username, $role, 'MATERIAL_DELETE',
            "Deleted raw material ID {$id}",
            'raw_material', (int)$id, null, 'INACTIVE');
        echo json_encode(['status' => 'success', 'message' => 'Material marked as inactive']);
    } else {
        echo json_encode(['status' => 'error', 'message' => 'Database update failed']);
    }
} catch (PDOException $e) {
    echo json_encode(['status' => 'error', 'message' => $e->getMessage()]);
}
