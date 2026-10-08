<?php
require_once __DIR__ . '/../../auth_middleware.php';
$authUser = authenticate(['Admin', 'Supervisor']);

require_once __DIR__ . '/SalesReportController.php';

// REQ-056: per-day Sales Report by Day (PAID-only). Clean JSON on any failure.
try {
    $controller = new SalesReportController($authUser);
    $controller->getReport();
} catch (Throwable $e) {
    http_response_code(200);
    header('Content-Type: application/json');
    echo json_encode([
        'status' => 'error',
        'message' => 'no completed payments in range...'
    ]);
}
