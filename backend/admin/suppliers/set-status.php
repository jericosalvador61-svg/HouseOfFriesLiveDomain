<?php
require_once __DIR__ . '/../../auth_middleware.php';
require_once __DIR__ . '/../../log_activity_helper.php';
$auth = authenticate(['Admin']);

require_once __DIR__ . '/SupplierController.php';
$controller = new SupplierController();
$controller->setStatus();