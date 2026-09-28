<?php
require_once __DIR__ . '/../../auth_middleware.php';
$auth = authenticate(['Admin', 'Supervisor', 'Inventory Staff']);
require_once __DIR__ . '/../../db.php';
header('Content-Type: application/json');

try {
    // Join with raw_materials to get name/unit and join users twice for staff & admin names
    $stmt = $pdo->query("
        SELECT 
            s.*, 
            m.raw_material_name, 
            m.unit,
            CONCAT(u_staff.first_name, ' ', u_staff.last_name) AS recorded_by_name,
            CONCAT(u_admin.first_name, ' ', u_admin.last_name) AS approver_name
        FROM spoilage s
        JOIN raw_materials m ON s.raw_material_id = m.raw_material_id
        LEFT JOIN users u_staff ON s.user_id = u_staff.user_id
        LEFT JOIN users u_admin ON s.approved_by = u_admin.user_id
        ORDER BY s.spoilage_date DESC, s.created_at DESC
    ");
    $history = $stmt->fetchAll(PDO::FETCH_ASSOC);

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
        'data' => $history
    ]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => $e->getMessage()]);
}
