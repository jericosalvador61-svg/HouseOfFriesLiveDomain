<?php
/**
 * Cleanup Expired Orders - Cron Job
 * 
 * Phase 1: PENDING >15 min → CANCELLED + free table + Pusher + log
 * Phase 2: CANCELLED >60 days → hard-delete (FK-safe: order_items → payments → orders)
 * 
 * @author Jerico (BSIT Capstone)
 * @version 2.0
 */

require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../pusher_helper.php';

try {
    date_default_timezone_set('Asia/Manila');
    
    $now = new DateTime();
    $expiryTime = clone $now;
    $expiryTime->modify('-15 minutes');
    
    $purgeTime = clone $now;
    $purgeTime->modify('-60 days');
    
    $logFile = __DIR__ . '/../logs/cleanup.log';
    $logDir = dirname($logFile);
    if (!is_dir($logDir)) {
        mkdir($logDir, 0755, true);
    }
    
    // ==========================================
    // PHASE 1: Mark expired PENDING as CANCELLED
    // (15-min clock from ordered_at — REQ-014)
    // ==========================================
    $stmt = $pdo->prepare("
        SELECT order_id, table_id, reference_number 
        FROM orders 
        WHERE status = 'PENDING' 
        AND ordered_at < ?
        AND payment_status != 'COMPLETED'
    ");
    $stmt->execute([$expiryTime->format('Y-m-d H:i:s')]);
    $expiredOrders = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    $cancelledCount = 0;
    
    foreach ($expiredOrders as $order) {
        $pdo->beginTransaction();
        
        // Update to CANCELLED (never silent delete)
        $updateStmt = $pdo->prepare("UPDATE orders SET status = 'CANCELLED', updated_at = NOW() WHERE order_id = ? AND status = 'PENDING'");
        $updateStmt->execute([$order['order_id']]);
        
        if ($updateStmt->rowCount() === 0) {
            $pdo->rollBack();
            continue;
        }
        
        // Free the table if it has one and no other active orders on it
        if ($order['table_id']) {
            $tableStmt = $pdo->prepare("
                UPDATE restaurant_table rt
                LEFT JOIN orders o2 ON o2.table_id = rt.table_id
                    AND o2.status IN ('PENDING', 'IN-PROGRESS', 'COOKING')
                    AND o2.order_id != ?
                SET rt.status = 'AVAILABLE', rt.updated_at = NOW()
                WHERE rt.table_id = ? AND o2.order_id IS NULL
            ");
            $tableStmt->execute([$order['order_id'], $order['table_id']]);
        }
        
        $pdo->commit();
        $cancelledCount++;
        
        // Pusher broadcast
        if (function_exists('broadcastOrderUpdate')) {
            broadcastOrderUpdate($order['order_id'], "Cancelled — not paid within 15 minutes", 'CANCELLED');
        }
        
        // Log
        $logEntry = date('Y-m-d H:i:s') . " - CANCELLED order #{$order['reference_number']} (ID: {$order['order_id']})";
        if ($order['table_id']) {
            $logEntry .= " - Freed table #{$order['table_id']}";
        }
        $logEntry .= "\n";
        file_put_contents($logFile, $logEntry, FILE_APPEND);
    }
    
    if ($cancelledCount > 0) {
        $summaryLog = date('Y-m-d H:i:s') . " - Phase 1 completed: {$cancelledCount} expired order(s) marked CANCELLED\n";
        file_put_contents($logFile, $summaryLog, FILE_APPEND);
    }
    
    // ==========================================
    // PHASE 2: Hard-delete CANCELLED >60 days
    // ==========================================
    $purgeStmt = $pdo->prepare("
        SELECT order_id, reference_number FROM orders
        WHERE status = 'CANCELLED' AND updated_at < ?
    ");
    $purgeStmt->execute([$purgeTime->format('Y-m-d H:i:s')]);
    $staleOrders = $purgeStmt->fetchAll(PDO::FETCH_ASSOC);
    
    $purgedCount = 0;
    
    foreach ($staleOrders as $order) {
        $pdo->beginTransaction();
        
        try {
            // Delete order_items first (FK to orders)
            $stmt = $pdo->prepare("DELETE FROM order_items WHERE order_id = ?");
            $stmt->execute([$order['order_id']]);
            
            // Delete payments (CANCELLED orders only have FAILED/PENDING payment rows)
            $stmt = $pdo->prepare("DELETE FROM payments WHERE order_id = ?");
            $stmt->execute([$order['order_id']]);
            
            // Delete the order itself
            $stmt = $pdo->prepare("DELETE FROM orders WHERE order_id = ?");
            $stmt->execute([$order['order_id']]);
            
            $pdo->commit();
            $purgedCount++;
            
            $logEntry = date('Y-m-d H:i:s') . " - PURGED stale CANCELLED order #{$order['reference_number']} (ID: {$order['order_id']}) - older than 60 days\n";
            file_put_contents($logFile, $logEntry, FILE_APPEND);
        } catch (Exception $e) {
            $pdo->rollBack();
            $errorLog = date('Y-m-d H:i:s') . " - Purge error for order #{$order['reference_number']}: " . $e->getMessage() . "\n";
            file_put_contents($logFile, $errorLog, FILE_APPEND);
        }
    }
    
    if ($purgedCount > 0) {
        $summaryLog = date('Y-m-d H:i:s') . " - Phase 2 completed: {$purgedCount} stale CANCELLED order(s) hard-deleted\n";
        file_put_contents($logFile, $summaryLog, FILE_APPEND);
    }
    
    if ($cancelledCount === 0 && $purgedCount === 0) {
        // No orders processed, silent exit (no log noise)
        exit;
    }
    
} catch (Exception $e) {
    $errorLog = date('Y-m-d H:i:s') . " - Cleanup error: " . $e->getMessage() . "\n";
    if (isset($logFile)) {
        file_put_contents($logFile, $errorLog, FILE_APPEND);
    }
}
?>