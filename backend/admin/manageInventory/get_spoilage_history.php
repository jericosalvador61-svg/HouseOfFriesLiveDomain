<?php
require_once __DIR__ . '/../../auth_middleware.php';
$auth = authenticate(['Admin', 'Supervisor', 'Inventory Staff']);
require_once __DIR__ . '/../../db.php';
header('Content-Type: application/json');

try {
    require_once __DIR__ . '/../../image_blob_helper.php';

    // REQ-057 pagination: 10 rows/page, server-side LIMIT/OFFSET.
    $page = max(1, (int)($_GET['page'] ?? 1));
    $limit = 10;
    $offset = ($page - 1) * $limit;

    $countStmt = $pdo->query("SELECT COUNT(*) FROM spoilage s JOIN raw_materials m ON s.raw_material_id = m.raw_material_id");
    $total = (int)$countStmt->fetchColumn();

    // Join with raw_materials to get name/unit and join users twice for staff & admin names
    $stmt = $pdo->prepare("
        SELECT 
            s.spoilage_id, s.user_id, s.raw_material_id, s.spoilage_type, s.quantity_lost,
            s.source, s.status, s.approved_by, s.approved_at, s.reference_number, s.remarks,
            s.spoilage_date, s.created_at, s.photo,
            m.raw_material_name, 
            m.unit,
            CONCAT(u_staff.first_name, ' ', u_staff.last_name) AS recorded_by_name,
            CONCAT(u_admin.first_name, ' ', u_admin.last_name) AS approver_name
        FROM spoilage s
        JOIN raw_materials m ON s.raw_material_id = m.raw_material_id
        LEFT JOIN users u_staff ON s.user_id = u_staff.user_id
        LEFT JOIN users u_admin ON s.approved_by = u_admin.user_id
        ORDER BY s.spoilage_date DESC, s.created_at DESC
        LIMIT :limit OFFSET :offset
    ");
    $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
    $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
    $stmt->execute();
    $history = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // REQ-057: encode the proof photo as a base64 data URI (photo_data_uri).
    hof_encode_blob_columns($history, ['photo' => 'photo_data_uri']);

    // Fallbacks to handle data gracefully if a user profile is missing or deleted
    foreach ($history as &$row) {
        if (empty(trim($row['recorded_by_name']))) {
            $row['recorded_by_name'] = 'Staff (ID: ' . ($row['user_id'] ?? 'N/A') . ')';
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
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => $e->getMessage()]);
}
