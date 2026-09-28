<?php
/**
 * Inventory Staff Search API
 * Searches: raw materials, suppliers
 */
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../auth_middleware.php';
header('Content-Type: application/json');

authenticate(['Inventory Staff', 'Admin', 'Supervisor']);
$query = trim($_GET['q'] ?? '');
if (strlen($query) < 2) {
    echo json_encode(['success' => true, 'results' => []]);
    exit;
}

$results = [];
$searchTerm = "%{$query}%";

try {
    // Search Raw Materials
    $stmt = $pdo->prepare("
        SELECT raw_material_id as id, raw_material_name as name, 
               CONCAT(current_quantity, ' ', unit, ' • ', 
                      CASE 
                          WHEN current_quantity <= reorder_level * 0.5 THEN 'Critical'
                          WHEN current_quantity <= reorder_level THEN 'Low Stock'
                          ELSE 'Healthy'
                      END) as category,
               'inventoryStaff_RawMaterials.html' as url
        FROM raw_materials
        WHERE raw_material_name LIKE ? AND status = 'ACTIVE'
        ORDER BY 
            CASE 
                WHEN current_quantity <= reorder_level * 0.5 THEN 1
                WHEN current_quantity <= reorder_level THEN 2
                ELSE 3
            END
        LIMIT 10
    ");
    $stmt->execute([$searchTerm]);
    $results = array_merge($results, $stmt->fetchAll());

    // Search Suppliers
    $stmt = $pdo->prepare("
        SELECT supplier_id as id, supplier_name as name, 
               CONCAT(contact_person, ' • ', email) as category,
               'inventoryStaff_PurchasePlan.html' as url
        FROM suppliers
        WHERE supplier_name LIKE ? OR contact_person LIKE ? OR email LIKE ?
        AND status = 'ACTIVE'
        LIMIT 5
    ");
    $stmt->execute([$searchTerm, $searchTerm, $searchTerm]);
    $results = array_merge($results, $stmt->fetchAll());

    echo json_encode(['success' => true, 'results' => $results]);
} catch (PDOException $e) {
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}