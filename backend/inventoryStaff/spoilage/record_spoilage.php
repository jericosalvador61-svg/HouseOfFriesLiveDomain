<?php
// backend/inventoryStaff/spoilage/record_spoilage.php
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../auth_middleware.php';
require_once __DIR__ . '/../../log_activity_helper.php';
require_once __DIR__ . '/../../notifications/notification_helper.php';
require_once __DIR__ . '/../../secret.php';

try {
    $auth = authenticate(['Admin', 'Inventory Staff', 'Supervisor']);
    $userId = (int)$auth['user_id'];
    $username = $auth['username'] ?? 'unknown';
    $role = $auth['role'] ?? '';

    // ─── TRANSACTION PROCESSING ENGINE ───
    $data = json_decode(file_get_contents("php://input"), true);

    if (!$data || empty($data['items'])) {
        throw new Exception('No spoilage structural payload data discovered.');
    }

    $spoilage_date = !empty($data['spoilage_date']) ? $data['spoilage_date'] : date('Y-m-d');
    $general_remarks = !empty($data['remarks']) ? $data['remarks'] : '';
    $ref_number = 'REF-' . strtoupper(uniqid());

    $pdo->beginTransaction();

    // Prepare insert template statement context inside localized buffers safely
    $stmt = $pdo->prepare("
        INSERT INTO spoilage (
            user_id, raw_material_id, spoilage_type, quantity_lost, 
            source, status, approved_by, approved_at, 
            reference_number, remarks, spoilage_date
        ) VALUES (?, ?, ?, ?, ?, 'PENDING', NULL, NULL, ?, ?, ?)
    ");

    // Loop through the cleanly formatted collection items sequence
    foreach ($data['items'] as $item) {
        $material_id = $item['material_id'];
        $qty = floatval($item['quantity']);
        $type = $item['type'];
        $source = $item['source'];

        $stmt->execute([
            $userId,
            $material_id,
            $type,
            $qty,
            $source,
            $ref_number,
            $general_remarks,
            $spoilage_date
        ]);
    }

    $pdo->commit();

    logActivity($pdo, $userId, $username, $role, 'SPOILAGE',
        "Spoilage report {$ref_number} created",
        'spoilage', null, $ref_number, 'PENDING');

    // Notify Supervisor: spoilage report awaiting approval
    hof_notify_roles($pdo, 'pending_approval', 'Spoilage Approval Needed',
        "Spoilage report " . $ref_number . " is awaiting your approval.",
        ['Supervisor'], '/public/supervisor/supervisor_approvals.html');

    // Watch stock levels for items reported lost (pre-approval visibility)
    hof_check_low_stock($pdo, array_map(function ($i) { return $i['material_id']; }, $data['items']));

    echo json_encode([
        'status' => 'success',
        'success' => true,
        'message' => 'Spoilage logged and waiting for admin approval.'
    ]);
} catch (Exception $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    http_response_code(400);
    echo json_encode([
        'status' => 'error',
        'success' => false,
        'message' => 'Backend Error: ' . $e->getMessage()
    ]);
}