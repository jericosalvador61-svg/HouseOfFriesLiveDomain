<?php
require_once __DIR__ . '/../../auth_middleware.php';
$auth = authenticate(['Admin', 'Supervisor', 'Inventory Staff']);
require_once __DIR__ . '/../../db.php';
header('Content-Type: application/json');

try {
    require_once __DIR__ . '/../../image_blob_helper.php';

    // NOTE: INACTIVE rows are soft-deleted materials. The Manage Inventory UI
    // filters by mat.status client-side, so both ACTIVE + INACTIVE are returned
    // here (stats removed — REQ-057: KPI cards live on the dashboard only).
    // REQ-057 pagination: 10 rows/page, server-side LIMIT/OFFSET.
    // REQ-071: `?all=1` returns the FULL list (no pagination) — required by the
    // inventory dropdowns (stock_in / adjustments / spoilage) so EVERY raw
    // material (including rows beyond page 10 and inactive ones) is selectable.
    $page = max(1, (int)($_GET['page'] ?? 1));
    $all = isset($_GET['all']) ? (int)$_GET['all'] : 0;
    $limit = $all ? 100000 : 10;
    $offset = $all ? 0 : ($page - 1) * $limit;

    $total = (int)$pdo->query("SELECT COUNT(*) FROM raw_materials")->fetchColumn();

    // REQ-071: image_blob is a REQ-057 additive column that may be absent on
    // an unmigrated DB — mirror the SalesReport hasColumn() guard so this
    // endpoint (which feeds EVERY inventory dropdown) never 500s when the
    // column is missing.
    $hasImageBlob = false;
    try {
        $cols = $pdo->query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'raw_materials'")->fetchAll(PDO::FETCH_COLUMN);
        $hasImageBlob = in_array('image_blob', $cols, true);
    } catch (Throwable $e) { /* treat as un-migrated */ }

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
            // REQ-070+071 F3: when ?all=1 the envelope must reflect the actual
            // rows returned, not the uncapped limit sentinel.
            'per_page' => $all ? $total : $limit,
            'total_pages' => (int)ceil($total / $limit)
        ]
    ]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => $e->getMessage()]);
}
