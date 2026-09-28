<?php
// backend/admin/purchasePlan/create_purchase_plan.php
header("Content-Type: application/json; charset=utf-8");

ini_set('display_errors', 0);
error_reporting(E_ALL);

// Safe cross-server function to fetch request headers
if (!function_exists('getallheaders')) {
    function getallheaders() {
        $headers = [];
        foreach ($_SERVER as $name => $value) {
            if (substr($name, 0, 5) == 'HTTP_') {
                $headerName = str_replace(' ', '-', ucwords(strtolower(str_replace('_', ' ', substr($name, 5)))));
                $headers[$headerName] = $value;
            }
        }
        return $headers;
    }
}

try {
    require_once __DIR__ . '/../../db.php';
    require_once __DIR__ . '/../../notifications/notification_helper.php';
    require_once __DIR__ . '/../../log_activity_helper.php';
    require_once __DIR__ . '/../../secret.php';

    // ─── STATELESS JWT SECURITY BLOCK ───
    $headers = getallheaders();
    $authHeader = $headers['Authorization'] ?? $headers['authorization'] ?? $_SERVER['HTTP_AUTHORIZATION'] ?? '';

    if (empty($authHeader) && function_exists('apache_request_headers')) {
        $apacheHeaders = apache_request_headers();
        $authHeader = $apacheHeaders['Authorization'] ?? $apacheHeaders['authorization'] ?? '';
    }

    if (empty($authHeader) || !preg_match('/Bearer\s(\S+)/', $authHeader, $matches)) {
        http_response_code(401);
        echo json_encode(["success" => false, "message" => "Unauthorized access. Token context not discovered."]);
        exit;
    }

    $jwt = $matches[1];
    $tokenParts = explode('.', $jwt);
    if (count($tokenParts) !== 3) {
        http_response_code(401);
        echo json_encode(["success" => false, "message" => "Unauthorized: Invalid authentication structure."]);
        exit;
    }

    list($base64UrlHeader, $base64UrlPayload, $base64UrlSignature) = $tokenParts;

    $signature = base64_decode(str_replace(['-', '_'], ['+', '/'], $base64UrlSignature));
    $expectedSignature = hash_hmac('sha256', $base64UrlHeader . "." . $base64UrlPayload, JWT_SECRET, true);

    if (!hash_equals($signature, $expectedSignature)) {
        http_response_code(401);
        echo json_encode(["success" => false, "message" => "Unauthorized: Token verification check failed."]);
        exit;
    }

    $payload = json_decode(base64_decode(str_replace(['-', '_'], ['+', '/'], $base64UrlPayload)), true);
    if (!$payload || ($payload['exp'] ?? 0) < time()) {
        http_response_code(401);
        echo json_encode(["success" => false, "message" => "User session expired. Please log in again."]);
        exit;
    }

    $created_by = (int)$payload['user_id'];

    // ─── TRANSACTION PROCESSING ENGINE ───
    $input = json_decode(file_get_contents("php://input"), true);

    if (!$input || empty($input['items'])) {
        echo json_encode(["success" => false, "message" => "No items provided for the purchase plan."]);
        exit;
    }

    $remarks = $input['remarks'] ?? '';

    $pdo->beginTransaction();
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    $calculated_grand_total = 0;
    $compiled_items = [];

    foreach ($input['items'] as $item) {
        $mat_id = intval($item['raw_material_id']);
        $suggested_qty = floatval($item['suggested_quantity']);

        $matLookup = $pdo->prepare("SELECT current_quantity, reorder_level, cost_per_unit FROM raw_materials WHERE raw_material_id = ?");
        $matLookup->execute([$mat_id]);
        $mat_data = $matLookup->fetch(PDO::FETCH_ASSOC);

        $current_qty = $mat_data ? floatval($mat_data['current_quantity']) : 0;
        $reorder_lvl = $mat_data ? floatval($mat_data['reorder_level']) : 0;
        $unit_cost   = $mat_data ? floatval($mat_data['cost_per_unit']) : 0.00;

        $subtotal = $suggested_qty * $unit_cost;
        $calculated_grand_total += $subtotal;

        $compiled_items[] = [
            'id' => $mat_id,
            'qty' => $suggested_qty,
            'current_qty' => $current_qty,
            'reorder_lvl' => $reorder_lvl,
            'unit_cost' => $unit_cost
        ];
    }

    // 1. Insert parent plan record
    $insertPlanSql = "INSERT INTO purchase_plans (created_by, remarks, total_cost, admin_remarks, status) 
                      VALUES (:created_by, :remarks, :total_cost, :admin_remarks, 'Approved')";
    $stmt = $pdo->prepare($insertPlanSql);
    $stmt->execute([
        ':created_by'    => $created_by,
        ':remarks'       => $remarks,
        ':total_cost'    => $calculated_grand_total,
        ':admin_remarks' => empty($remarks) ? null : $remarks
    ]);

    $plan_id = $pdo->lastInsertId();

    // 2. Prepare statement for inserting child line items
    $insertItemSql = "INSERT INTO purchase_plan_items (plan_id, raw_material_id, current_quantity, snapshot_unit_cost, reorder_level, suggested_quantity) 
                      VALUES (:plan_id, :raw_material_id, :current_quantity, :snapshot_unit_cost, :reorder_level, :suggested_quantity)";
    $itemStmt = $pdo->prepare($insertItemSql);

    // 3. Loop through staged items and write entries
    foreach ($compiled_items as $ci) {
        $itemStmt->execute([
            ':plan_id'            => $plan_id,
            ':raw_material_id'    => $ci['id'],
            ':current_quantity'   => $ci['current_qty'],
            ':snapshot_unit_cost' => $ci['unit_cost'],
            ':reorder_level'      => $ci['reorder_lvl'],
            ':suggested_quantity' => $ci['qty']
        ]);
    }

    $pdo->commit();

    logActivity($pdo, $payload['user_id'], $payload['username'], $payload['role'],
        'PURCHASE_PLAN_CREATE', "Created purchase plan #{$plan_id}",
        'purchase_plan', $plan_id, (string)$plan_id);

    // Notify Supervisor + Admin: new purchase plan for evaluation
    hof_notify_roles($pdo, 'purchase_plan', 'Purchase Plan Submitted',
        "Purchase plan #$plan_id has been submitted and is awaiting evaluation.",
        ['Supervisor', 'Admin'], '/public/admin/purchasePlan.html');

    echo json_encode(["success" => true, "message" => "Purchase plan created with financial metrics and auto-approved!"]);

} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    http_response_code(200);
    echo json_encode([
        "success" => false, 
        "message" => "Server Error: " . $e->getMessage() . " in " . basename($e->getFile()) . " on line " . $e->getLine()
    ]);
}