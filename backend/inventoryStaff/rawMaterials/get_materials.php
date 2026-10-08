<?php
require_once __DIR__ . '/../../auth_middleware.php';
$auth = authenticate(['Inventory Staff', 'Admin', 'Supervisor']);
require_once __DIR__ . '/../../db.php';
header('Content-Type: application/json');

try {
    require_once __DIR__ . '/../../image_blob_helper.php';

    // REQ-057 pagination: 10 rows/page, server-side LIMIT/OFFSET.
    $page = max(1, (int)($_GET['page'] ?? 1));
    $limit = 10;
    $offset = ($page - 1) * $limit;

    $total = (int)$pdo->query("SELECT COUNT(*) FROM raw_materials")->fetchColumn();

    // REQ-070+071 F7-LIVE-3: image_blob is a REQ-057 additive column that may
    // be absent on an unmigrated DB — mirror the admin
    // manageInventory/get_materials.php hasColumn() guard so this endpoint
    // never 500s when the column is missing.
    $hasImageBlob = false;
    try {
        $cols = $pdo->query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'raw_materials'")->fetchAll(PDO::FETCH_COLUMN);
        $hasImageBlob = in_array('image_blob', $cols, true);
    } catch (Throwable $e) { /* treat as un-migrated */ }

    // 1. Get the list of materials (Keep ORDER BY raw_material_name ASC so your main table stays clean!)
    $stmt = $pdo->prepare("
        SELECT raw_material_id, raw_material_name, description, unit,
                current_quantity, reorder_level, status, is_perishable, img_url, updated_at"
                . ($hasImageBlob ? ", image_blob" : "") . "
        FROM raw_materials
        ORDER BY raw_material_name ASC
        LIMIT :limit OFFSET :offset
    ");
    $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
    $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
    $stmt->execute();
    $materials = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // REQ-057: base64-encode image_blob so tables render data URIs.
    if ($hasImageBlob) {
        hof_encode_blob_columns($materials, ['image_blob' => 'image_blob']);
    }

    echo json_encode([
        'status' => 'success',
        'data' => $materials,
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
