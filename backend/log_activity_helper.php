<?php
/**
 * log_activity_helper.php
 * Reusable helper to log system events into the activity_logs table.
 * Call this from any backend endpoint to track user actions.
 * 
 * Usage:
 *   require_once __DIR__ . '/../log_activity_helper.php';
 *   logActivity($pdo, $userId, $username, $role, $actionType, $description, $refType, $refId, $refNumber, $status);
 *   logActivity($pdo, $userId, $username, $role, $actionType, $description, $refType, $refId, $refNumber, $status, $before, $after);
 *
 * REQ-050 (2026-09-30):
 *   - action_category is now the MODULE dimension (TABLE/KITCHEN/MATERIAL/SUPPLIER events no longer fall into SYSTEM).
 *   - description is capped at 1000 chars, user_agent at 255 chars (kills unbounded growth).
 *   - Optional $before/$after params: when either is non-null the helper appends
 *     ' | ' . $before . ' → ' . $after to the description (before the cap). Backward compatible.
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
    string $status = null,
    string $before = null,
    string $after = null
): bool {
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    $ua = $_SERVER['HTTP_USER_AGENT'] ?? '';

    if ($before !== null || $after !== null) {
        $description .= ' | ' . ($before ?? '') . ' → ' . ($after ?? '');
    }

    // Cap growth: description 1000 chars, user_agent 255 chars (column is TEXT; no schema change needed)
    $description = mb_substr($description, 0, 1000);
    $ua = mb_substr($ua, 0, 255);

    $stmt = $pdo->prepare("
        INSERT INTO activity_logs 
            (user_id, username, user_role, action_type, action_category, description, 
             reference_type, reference_id, reference_number, ip_address, user_agent, status, created_at)
        VALUES 
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    ");

    // Derive a sensible category (module dimension) from the action type prefix
    $category = 'SYSTEM';
    if (str_starts_with($actionType, 'LOGIN_') || str_starts_with($actionType, 'LOGOUT') || str_starts_with($actionType, 'LOCKOUT')) {
        $category = 'AUTH';
    } elseif (str_starts_with($actionType, 'ORDER_') || in_array($actionType, ['ADD_ITEM_TO_ORDER', 'UPDATE_ITEM_QTY', 'UPDATE_DINING_PREFERENCE'])) {
        $category = 'ORDER';
    } elseif (str_starts_with($actionType, 'PAYMENT_')) {
        $category = 'SALES';
    } elseif (str_starts_with($actionType, 'TABLE_')) {
        $category = 'TABLE';
    } elseif (str_starts_with($actionType, 'KITCHEN_')) {
        $category = 'KITCHEN';
    } elseif (str_starts_with($actionType, 'STOCK_') || str_starts_with($actionType, 'INVENTORY_') || str_starts_with($actionType, 'SPOILAGE') || str_starts_with($actionType, 'ADJUSTMENT') || str_starts_with($actionType, 'RETURN') || str_starts_with($actionType, 'PURCHASE_PLAN') || str_starts_with($actionType, 'MATERIAL_') || str_starts_with($actionType, 'SUPPLIER_')) {
        $category = 'INVENTORY';
    } elseif (str_starts_with($actionType, 'USER_')) {
        $category = 'USER_MGMT';
    } elseif (str_starts_with($actionType, 'VOID')) {
        $category = 'SALES';
    } elseif (str_starts_with($actionType, 'DISCOUNT')) {
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