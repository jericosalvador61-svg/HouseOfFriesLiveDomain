<?php
require_once __DIR__ . '/../../auth_middleware.php';
$user = authenticate();

require_once __DIR__ . '/SupplierController.php';
$controller = new SupplierController();
$controller->get();