<?php
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../log_activity_helper.php';
require_once __DIR__ . '/../../auth_middleware.php';
header('Content-Type: application/json');

// Using $_POST because your JS sends FormData
$id = $_POST['raw_material_id'] ?? null;

if (!$id) {
    echo json_encode(['status' => 'error', 'message' => 'ID missing']);
    exit;
}

// REQ-057 RBAC: Admin + Supervisor manage raw materials (staff read-only).
$auth = authenticate(['Admin', 'Supervisor']);

try {
    $stmt = $pdo->prepare("UPDATE raw_materials SET status = 'INACTIVE' WHERE raw_material_id = ?");

    if ($stmt->execute([$id])) {
        $materialName = ''; // not retrieved in delete; keep simple
        logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'], 'MATERIAL_DELETE',
            "Deleted raw_material #{$id}",
            'raw_material', (int)$id, (string)$id, 'Inactive');
        echo json_encode(['status' => 'success', 'message' => 'Material marked as inactive']);
    } else {
        echo json_encode(['status' => 'error', 'message' => 'Database update failed']);
    }
} catch (PDOException $e) {
    echo json_encode(['status' => 'error', 'message' => "Database Error: " . $e->getMessage()]);
}
