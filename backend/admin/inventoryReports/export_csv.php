<?php
require_once __DIR__ . '/../../auth_middleware.php';
$user = authenticate(['Admin', 'Supervisor']);
require_once __DIR__ . '/InventoryReportController.php';
$controller = new InventoryReportController();
$controller->exportCSV();