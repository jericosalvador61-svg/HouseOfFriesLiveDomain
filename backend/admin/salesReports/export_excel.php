<?php
require_once __DIR__ . '/../../auth_middleware.php';
$user = authenticate();

require_once __DIR__ . '/SalesReportController.php';
$controller = new SalesReportController();
$controller->exportExcel();