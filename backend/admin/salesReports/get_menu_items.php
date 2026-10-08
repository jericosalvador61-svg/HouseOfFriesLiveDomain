<?php
require_once __DIR__ . '/../../auth_middleware.php';
$user = authenticate(['Admin', 'Supervisor']);

require_once __DIR__ . '/SalesReportController.php';

// REQ-068 M1-3: surface ANY failure as clean JSON — never a raw HTML/500.
// The real exception goes to the server error log; the client gets an honest,
// actionable message (no raw PDO text leaked).
try {
    $controller = new SalesReportController($user);
    $controller->getMenuItems();
} catch (Throwable $e) {
    error_log('[salesReports/get_menu_items.php] ' . $e->getMessage());
    http_response_code(200);
    header('Content-Type: application/json');
    echo json_encode([
        'status' => 'error',
        'message' => 'Sales data is temporarily unavailable. Check the database connection or schema migrations.'
    ]);
}
