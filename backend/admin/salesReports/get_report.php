<?php
require_once __DIR__ . '/../../auth_middleware.php';
$user = authenticate(['Admin', 'Supervisor']);

require_once __DIR__ . '/SalesReportController.php';

// REQ-056: per-day Sales Report by Day (PAID-only). Clean JSON on any failure.
try {
    $controller = new SalesReportController($user);
    $controller->getReport();
} catch (Throwable $e) {
    error_log('[salesReports/get_report.php] ' . $e->getMessage());
    http_response_code(200);
    header('Content-Type: application/json');
    echo json_encode([
        'status' => 'error',
        'message' => 'Sales data is temporarily unavailable. Check the database connection or schema migrations.',
        // Authenticated Admin/Supervisor only (authenticate() above already
        // gates this): expose the real cause so the browser console shows it.
        'detail' => $e->getMessage()
    ]);
}
