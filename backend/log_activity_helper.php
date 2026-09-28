<?php
/**
 * log_activity_helper.php
 * Reusable helper to log system events into the activity_logs table.
 * Call this from any backend endpoint to track user actions.
 * 
 * Usage:
 *   require_once __DIR__ . '/../log_activity_helper.php';
 *   logActivity($pdo, $userId, $username, $role, $actionType, $description, $refType, $refId, $refNumber, $status);
 */

function logActivity(
    PDO $pdo,
    ?int $userId,
    string $username,
    string $userRole,
    string $actionType,
    string $description,
    string $referenceType = null,
    ?int $referenceId = null,
    string $referenceNumber = null,
    string $status = null
): bool {
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    $ua = $_SERVER['HTTP_USER_AGENT'] ?? '';

    $stmt = $pdo->prepare("
        INSERT INTO activity_logs 
            (user_id, username, user_role, action_type, action_category, description, 
             reference_type, reference_id, reference_number, ip_address, user_agent, status, created_at)
        VALUES 
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    ");

    // Derive a sensible category from the action type prefix
    $category = 'SYSTEM';
    if (str_starts_with($actionType, 'LOGIN_') || str_starts_with($actionType, 'LOGOUT')) {
        $category = 'AUTH';
    } elseif (str_starts_with($actionType, 'ORDER_')) {
        $category = 'ORDER';
    } elseif (str_starts_with($actionType, 'PAYMENT_')) {
        $category = 'SALES';
    } elseif (str_starts_with($actionType, 'STOCK_') || str_starts_with($actionType, 'INVENTORY_') || $actionType === 'SPOILAGE' || $actionType === 'ADJUSTMENT' || $actionType === 'RETURN' || $actionType === 'PURCHASE_PLAN') {
        $category = 'INVENTORY';
    } elseif (str_starts_with($actionType, 'USER_')) {
        $category = 'USER_MGMT';
    } elseif (str_starts_with($actionType, 'VOID')) {
        $category = 'SALES';
    } elseif (str_starts_with($actionType, 'MENU_')) {
        $category = 'MENU';
    } elseif (str_starts_with($actionType, 'SETTINGS_')) {
        $category = 'SETTINGS';
    }

    try {
        $stmt->execute([
            $userId,
            $username,
            $userRole,
            $actionType,
            $category,
            $description,
            $referenceType,
            $referenceId,
            $referenceNumber,
            $ip,
            $ua,
            $status
        ]);
        return true;
    } catch (PDOException $e) {
        error_log("logActivity error: " . $e->getMessage());
        return false;
    }
}