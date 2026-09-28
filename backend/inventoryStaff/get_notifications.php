<?php
/**
 * Inventory Staff Notifications API (role-filtered, DB-backed)
 * Receives: low stock / out of stock alerts, purchase plan decisions.
 */
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../notifications/api.php';
hof_notifications_api(25);
