<?php
// backend/inventoryStaff/spoilage/record_spoilage.php
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../notifications/notification_helper.php';
require_once __DIR__ . '/../../secret.php'; // Secret cryptographic validation configuration parameters

try {
    // ─── STATELESS JWT SECURITY BLOCK ───
    $authHeader = '';
    if (isset($_SERVER['HTTP_AUTHORIZATION'])) {
        $authHeader = trim($_SERVER['HTTP_AUTHORIZATION']);
    } elseif (function_exists('apache_request_headers')) {
        $requestHeaders = apache_request_headers();
        $requestHeaders = array_combine(array_map('ucwords', array_keys($requestHeaders)), array_values($requestHeaders));
        if (isset($requestHeaders['Authorization'])) {
            $authHeader = trim($requestHeaders['Authorization']);
        }
    }

    if (empty($authHeader) || !preg_match('/Bearer\s(\S+)/', $authHeader, $matches)) {
        throw new Exception("Unauthorized access. Token context not discovered.");
    }

    $jwt = $matches[1];
    $tokenParts = explode('.', $jwt);
    if (count($tokenParts) !== 3) {
        throw new Exception("Unauthorized: Invalid authentication structure.");
    }

    list($base64UrlHeader, $base64UrlPayload, $base64UrlSignature) = $tokenParts;

    // Validate Signature Match
    $signature = base64_decode(str_replace(['-', '_'], ['+', '/'], $base64UrlSignature));
    $expectedSignature = hash_hmac('sha256', $base64UrlHeader . "." . $base64UrlPayload, JWT_SECRET, true);

    if (!hash_equals($signature, $expectedSignature)) {
        throw new Exception("Unauthorized: Token verification check failed.");
    }

    // Parse Payload Properties and Validate Session Context Lifecycle
    $payload = json_decode(base64_decode(str_replace(['-', '_'], ['+', '/'], $base64UrlPayload)), true);
    if (!$payload || ($payload['exp'] ?? 0) < time()) {
        throw new Exception("User session expired. Please log in again.");
    }

    // Assign dynamic parsing parameters
    $userId = (int)$payload['user_id'];

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