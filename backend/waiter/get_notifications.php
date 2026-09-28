<?php
/**
 * ============================================================
 * Waiter Notifications API (role-filtered, DB-backed)
 * Thin wrapper around the shared engine in backend/notifications/api.php.
 * Role-restricted to the waiter module's allow-list.
 * ============================================================
 */
header('Content-Type: application/json');
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../auth_middleware.php';

// Fail fast with a 403 before the shared engine re-authenticates.
authenticate(['Waiter', 'Admin', 'Supervisor']);

require_once __DIR__ . '/../notifications/api.php';
hof_notifications_api(25);
