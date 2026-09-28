<?php
// backend/get_raw_materials.php
header("Content-Type: application/json");
require_once __DIR__ . '/../../db.php';

try {
    // 🛠️ FIX: Added cost_per_unit to the SELECT query string below
    $stmt = $pdo->query("SELECT raw_material_id, raw_material_name, current_quantity, reorder_level, unit, cost_per_unit, updated_at FROM raw_materials");
    $materials = $stmt->fetchAll();

    echo json_encode($materials);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Error fetching materials: " . $e->getMessage()]);
}
