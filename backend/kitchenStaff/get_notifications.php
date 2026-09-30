<?php
/**
 * Kitchen Staff Notifications API (role-filtered, DB-backed)
 * Receives: paid orders ready to prepare.
 */
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../auth_middleware.php';
$user = authenticate(['Kitchen Staff', 'Admin', 'Supervisor']);
require_once __DIR__ . '/../notifications/api.php';
hof_notifications_api(25);
