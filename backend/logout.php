<?php
/**
 * backend/logout.php
 * Handles logout — logs the event to activity_logs, then returns success.
 * The frontend handles token removal and redirect.
 */
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/auth_middleware.php';
require_once __DIR__ . '/log_activity_helper.php';

header('Content-Type: application/json');

try {
    $user = authenticate(); // Will 401 if token invalid

    $userId   = $user['user_id'] ?? null;
    $username = $user['username'] ?? 'unknown';
    $role     = $user['role'] ?? 'unknown';

    logActivity(
        $pdo,
        $userId,
        $username,
        $role,
        'LOGOUT',
        "User {$username} ({$role}) logged out",
        null, null, null, null
    );

    echo json_encode(['success' => true, 'message' => 'Logged out successfully']);
} catch (Exception $e) {
    // Even if auth fails, still return success so the frontend can clear tokens
    echo json_encode(['success' => true, 'message' => 'Session ended']);
}