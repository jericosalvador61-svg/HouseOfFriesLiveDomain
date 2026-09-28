<?php
require_once __DIR__ . '/../../auth_middleware.php';
$auth = authenticate(['Inventory Staff', 'Admin', 'Supervisor']);
require_once __DIR__ . '/../../db.php';
header('Content-Type: application/json');

try {
    // Updated query to include raw IDs, approval timestamps, remarks, and structural names
    $query = "
        SELECT 
            so.stock_out_id,
            so.user_id,
            so.stock_out_date,
            so.remarks,
            so.status,
            so.approved_by,
            so.approved_at,
            so.approval_remarks,
            soi.raw_material_id,
            rm.raw_material_name,
            soi.quantity,
            rm.unit,
            CONCAT(u_staff.first_name, ' ', u_staff.last_name) AS processor_name,
            CONCAT(u_admin.first_name, ' ', u_admin.last_name) AS approver_name
        FROM stock_out so
        INNER JOIN stock_out_items soi ON so.stock_out_id = soi.stock_out_id
        INNER JOIN raw_materials rm ON soi.raw_material_id = rm.raw_material_id
        LEFT JOIN users u_staff ON so.user_id = u_staff.user_id
        LEFT JOIN users u_admin ON so.approved_by = u_admin.user_id
        WHERE soi.is_deleted = 0
        ORDER BY so.created_at DESC
    ";

    $stmt = $pdo->query($query);
    $history = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Dynamic processing loop for fallback names if records don't match active users
    foreach ($history as &$row) {
        if (empty(trim($row['processor_name']))) {
            $row['processor_name'] = 'Staff (ID: ' . ($row['user_id'] ?? 'N/A') . ')';
        }

        // Format approver fallback only if it's actually been approved/rejected but user missing
        if ($row['status'] !== 'Pending' && empty(trim($row['approver_name']))) {
            $row['approver_name'] = !empty($row['approved_by']) ? 'Admin (ID: ' . $row['approved_by'] . ')' : 'Admin';
        }
    }

    echo json_encode(['status' => 'success', 'data' => $history]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => $e->getMessage()]);
}
