<?php
require_once __DIR__ . '/../db.php';
header('Content-Type: application/json');

$cat_id = $_GET['category_id'] ?? null;

try {
    $query = "SELECT menu_item_id, item_name, price, status FROM menu_items WHERE status = 'Available'";
    if ($cat_id && $cat_id !== 'all') {
        $query .= " AND category_id = :cat_id";
    }

    $stmt = $pdo->prepare($query);
    if ($cat_id && $cat_id !== 'all') {
        $stmt->execute(['cat_id' => $cat_id]);
    } else {
        $stmt->execute();
    }

    echo json_encode(['success' => true, 'items' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
} catch (PDOException $e) {
    error_log('get_items_by_category error: ' . $e->getMessage());
    echo json_encode(['success' => false, 'message' => 'Failed to load items.']);
}
