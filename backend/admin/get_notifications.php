<?php
/**
 * Admin Notifications API (role-filtered, DB-backed)
 */
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../auth_middleware.php';
$user = authenticate(['Admin', 'Supervisor', 'Inventory Staff']);
require_once __DIR__ . '/../notifications/api.php';
hof_notifications_api(25);
