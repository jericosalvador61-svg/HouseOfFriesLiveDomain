<?php
/**
 * backend/logout.php
 * Handles logout — logs the event to activity_logs, then returns success.
 * The frontend handles token removal and redirect.
 */
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/auth_middleware.php';
require_once __DIR__ . '/log_activity_helper.php';
require_once __DIR__ . '/rate_limit.php'; // REQ-050 (Phase 4)

header('Content-Type: application/json');

try {
    $user = authenticate(); // Will 401 if token invalid

    // REQ-050 (Phase 4): rate-limit repeated logout calls
    hof_rate_limit('logout', 30, 60);

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