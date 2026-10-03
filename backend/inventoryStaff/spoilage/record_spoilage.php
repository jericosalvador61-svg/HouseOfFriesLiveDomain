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

    // REQ-057: required proof photo (SPOILAGE/WASTE/DAMAGE) stored as BLOB.
    // Client sends a compressed JPEG data-URI (no scheme prefix) via JSON.
    $photo_raw = '';
    if (empty($data['photo']) || !is_string($data['photo']) || trim($data['photo']) === '') {
        throw new Exception('A proof photo is required for SPOILAGE / WASTE / DAMAGE submissions.');
    }
    if (is_string($data['photo'])) {
        $photo = $data['photo'];
        // Strip a possible data-URI scheme; keep only the base64 payload.
        if (strpos($photo, 'base64,') !== false) {
            $photo = substr($photo, strpos($photo, 'base64,') + 7);
        }
        $photo_raw = base64_decode($photo, true);
        if ($photo_raw === false) {
            $photo_raw = '';
        }
    }

    $pdo->beginTransaction();

    // Prepare insert template statement context inside localized buffers safely
    $stmt = $pdo->prepare("
        INSERT INTO spoilage (
            user_id, raw_material_id, spoilage_type, quantity_lost, 
            source, status, approved_by, approved_at, 
            reference_number, remarks, spoilage_date, photo
        ) VALUES (?, ?, ?, ?, ?, 'PENDING', NULL, NULL, ?, ?, ?, ?)
    ");

    // Loop through the cleanly formatted collection items sequence.
    // REQ-057 fix: the JS payload sends raw_material_id (i.material_id) —
    // accept both raw_material_id and legacy material_id (CRASH fix).
    foreach ($data['items'] as $item) {
        $material_id = $item['raw_material_id'] ?? $item['material_id'] ?? null;
        if ($material_id === null) {
            throw new Exception('Spoilage item is missing raw_material_id.');
        }
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
            $spoilage_date,
            $photo_raw !== '' ? $photo_raw : null
        ]);
    }

    $pdo->commit();

    logActivity($pdo, $userId, $username, $role, 'SPOILAGE',
        "Spoilage report {$ref_number} created" . ($photo_raw !== '' ? ' (photo attached)' : ''),
        'spoilage', null, $ref_number, 'PENDING');

    // Notify Supervisor: spoilage report awaiting approval
    hof_notify_roles($pdo, 'pending_approval', 'Spoilage Approval Needed',
        "Spoilage report " . $ref_number . " is awaiting your approval.",
        ['Supervisor'], '/public/supervisor/supervisor_approvals.html');

    // Watch stock levels for items reported lost (pre-approval visibility)
    hof_check_low_stock($pdo, array_map(function ($i) { return $i['raw_material_id'] ?? $i['material_id'] ?? null; }, $data['items']));

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