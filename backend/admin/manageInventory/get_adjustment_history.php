<?php
header('Content-Type: application/json');
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../auth_middleware.php';
$user = authenticate(['Admin', 'Supervisor']);

try {
    // REQ-057 pagination: 10 rows/page, server-side LIMIT/OFFSET.
    $page = max(1, (int)($_GET['page'] ?? 1));
    $limit = 10;
    $offset = ($page - 1) * $limit;

    $countStmt = $pdo->prepare("
        SELECT COUNT(*) FROM adjustments a
        JOIN adjustment_items ai ON a.adjustment_id = ai.adjustment_id
        JOIN raw_materials rm ON ai.raw_material_id = rm.raw_material_id
    ");
    $countStmt->execute();
    $total = (int)$countStmt->fetchColumn();

    // Changed u_staff.username to a CONCAT function for first and last name
    $sql = "SELECT 
                a.adjustment_id,
                a.user_id,
                a.adjustment_type,
                a.reason,
                a.adjustment_date,
                a.status,
                a.approved_by,
                a.approved_at,
                a.approval_remarks,
                ai.raw_material_id,
                ai.quantity,
                rm.raw_material_name,
                rm.unit,
                CONCAT(u_staff.first_name, ' ', u_staff.last_name) AS adjusted_by,
                CONCAT(u_admin.first_name, ' ', u_admin.last_name) AS approver_name
            FROM adjustments a
            JOIN adjustment_items ai ON a.adjustment_id = ai.adjustment_id
            JOIN raw_materials rm ON ai.raw_material_id = rm.raw_material_id
            LEFT JOIN users u_staff ON a.user_id = u_staff.user_id
            LEFT JOIN users u_admin ON a.approved_by = u_admin.user_id
            ORDER BY a.created_at DESC
            LIMIT :limit OFFSET :offset";

    $stmt = $pdo->prepare($sql);
    $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
    $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
    $stmt->execute();
    $history = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Clean up fallback text spaces in case names come back empty
    foreach ($history as &$row) {
        if (empty(trim($row['adjusted_by']))) {
            $row['adjusted_by'] = 'Staff (ID: ' . ($row['user_id'] ?? 'N/A') . ')';
        }

        if (($row['status'] === 'Approved' || $row['status'] === 'Rejected' || $row['status'] === 'Cancelled') && empty(trim($row['approver_name']))) {
            $row['approver_name'] = !empty($row['approved_by']) ? 'Admin (ID: ' . $row['approved_by'] . ')' : 'Admin';
        }
    }

    echo json_encode([
        'status' => 'success',
        'data' => $history,
        'pagination' => [
            'total' => $total,
            'page' => $page,
            'per_page' => $limit,
            'total_pages' => (int)ceil($total / $limit)
        ]
    ]);
} catch (Exception $e) {
    echo json_encode([
        'status' => 'error',
        'message' => $e->getMessage()
    ]);
}
