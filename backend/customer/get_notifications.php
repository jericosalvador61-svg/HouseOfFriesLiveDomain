<?php
/**
 * Customer Notifications API
 * Customers have no bell-notification inbox in the current mobile UI.
 * Returns an empty set (success) - kept as an endpoint so client calls never 404.
 */
header('Content-Type: application/json');
echo json_encode(['success' => true, 'items' => [], 'unread_count' => 0]);
