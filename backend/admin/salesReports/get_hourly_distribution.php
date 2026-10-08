<?php
require_once __DIR__ . '/../../auth_middleware.php';
$authUser = authenticate(['Admin', 'Supervisor']);

require_once __DIR__ . '/SalesReportController.php';
$controller = new SalesReportController($authUser);
$controller->getHourlyDistribution();