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
    $page = max(1, (int)($_GET['page'] ?? 1));
    $limit = 10;
    $offset = ($page - 1) * $limit;

    $total = (int)$pdo->query("SELECT COUNT(*) FROM raw_materials")->fetchColumn();

    $stmt = $pdo->prepare("
        SELECT raw_material_id, raw_material_name, description, unit, 
               current_quantity, reorder_level, status, is_perishable, img_url, image_blob, updated_at
        FROM raw_materials
        ORDER BY raw_material_name ASC
        LIMIT :limit OFFSET :offset
    ");
    $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
    $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
    $stmt->execute();
    $materials = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // REQ-057: base64-encode image_blob so tables render data URIs.
    hof_encode_blob_columns($materials, ['image_blob' => 'image_blob']);

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
