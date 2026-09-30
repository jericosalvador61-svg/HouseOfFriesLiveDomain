<?php
require_once __DIR__ . '/../../auth_middleware.php';
$user = authenticate(['Admin', 'Supervisor']);

require_once __DIR__ . '/SalesReportController.php';
$controller = new SalesReportController($user);
$controller->getStats();