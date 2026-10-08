<?php
require_once __DIR__ . '/../../auth_middleware.php';
$user = authenticate(['Admin', 'Supervisor']);

require_once __DIR__ . '/SalesReportController.php';

// REQ-056: any PDO/exception must surface as clean JSON, never HTML/500.
try {
    $controller = new SalesReportController($user);
    $controller->getStats();
} catch (Throwable $e) {
    error_log('[salesReports/get_stats.php] ' . $e->getMessage());
    http_response_code(200);
    header('Content-Type: application/json');
    echo json_encode([
        'status' => 'error',
        'message' => 'Sales data is temporarily unavailable. Check the database connection or schema migrations.'
    ]);
}
