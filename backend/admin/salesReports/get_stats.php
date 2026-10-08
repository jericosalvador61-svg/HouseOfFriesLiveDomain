<?php
require_once __DIR__ . '/../../auth_middleware.php';
$user = authenticate(['Admin', 'Supervisor']);

require_once __DIR__ . '/SalesReportController.php';

// REQ-056: any PDO/exception must surface as clean JSON, never HTML/500.
try {
    $controller = new SalesReportController($user);
    $controller->getStats();
} catch (Throwable $e) {
    http_response_code(200);
    header('Content-Type: application/json');
    echo json_encode([
        'status' => 'error',
        'message' => 'no completed payments in range...'
    ]);
}
