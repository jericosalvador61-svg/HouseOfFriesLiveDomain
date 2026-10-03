<?php
require_once __DIR__ . '/../../auth_middleware.php';
$auth = authenticate(['Admin', 'Supervisor', 'Inventory Staff']);
require_once __DIR__ . '/../../db.php';
header("Content-Type: application/json");

try {
    // REQ-057 pagination: 10 rows/page, server-side LIMIT/OFFSET.
    $page = max(1, (int)($_GET['page'] ?? 1));
    $limit = 10;
    $offset = ($page - 1) * $limit;

    $countStmt = $pdo->prepare("
        SELECT COUNT(*) FROM stock_in si
        JOIN stock_in_items sii ON si.stock_in_id = sii.stock_in_id
        JOIN raw_materials rm ON sii.raw_material_id = rm.raw_material_id
    ");
    $countStmt->execute();
    $total = (int)$countStmt->fetchColumn();

    // Fetch ALL Stock In Records with comprehensive itemization and approval metrics
    $stmtAllRecords = $pdo->prepare("
        SELECT 
            si.stock_in_id, 
            si.supplier_id,
            s.supplier_name,
            si.user_id,
            u_staff.first_name,
            u_staff.last_name,
            CONCAT(u_staff.first_name, ' ', u_staff.last_name) AS staff_name,
            si.stock_in_date, 
            si.total_cost,
            si.remarks,
            si.status,
            si.approved_by,
            CONCAT(u_admin.first_name, ' ', u_admin.last_name) AS approver_name,
            si.approved_at,
            si.approval_remarks,
            sii.stock_in_item_id,
            sii.raw_material_id, 
            rm.raw_material_name, 
            sii.quantity, 
            sii.unit_cost, 
            sii.subtotal,
            sii.expiration_date
        FROM stock_in si
        JOIN stock_in_items sii ON si.stock_in_id = sii.stock_in_id
        JOIN raw_materials rm ON sii.raw_material_id = rm.raw_material_id
        LEFT JOIN suppliers s ON si.supplier_id = s.supplier_id
        LEFT JOIN users u_staff ON si.user_id = u_staff.user_id
        LEFT JOIN users u_admin ON si.approved_by = u_admin.user_id
        ORDER BY si.created_at DESC
        LIMIT :limit OFFSET :offset
    ");
    $stmtAllRecords->bindValue(':limit', $limit, PDO::PARAM_INT);
    $stmtAllRecords->bindValue(':offset', $offset, PDO::PARAM_INT);
    $stmtAllRecords->execute();
    $allRecords = $stmtAllRecords->fetchAll(PDO::FETCH_ASSOC);

    // Initialize separation arrays
    $approved = [];
    $pending = [];

    // Filter the rows based on status
    foreach ($allRecords as $row) {
        if (strtolower($row['status']) === 'pending') {
            $pending[] = $row;
        } else {
            // This safely catches Approved, Rejected, and Cancelled statuses
            $approved[] = $row;
        }
    }

    // Return separated channels back to your JavaScript file
    echo json_encode([
        "success" => true,
        "approved" => $approved,
        "pending"  => $pending,
        "pagination" => [
            "total" => $total,
            "page" => $page,
            "per_page" => $limit,
            "total_pages" => (int)ceil($total / $limit)
        ]
    ]);
} catch (Exception $e) {
    echo json_encode([
        "success" => false,
        "message" => $e->getMessage()
    ]);
}
