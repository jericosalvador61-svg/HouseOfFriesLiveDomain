<?php
/**
 * customer/lookup_order_by_ref.php
 * REQ-067 F5 — public, rate-limited guest track-by-order-number endpoint.
 *
 * Guest (not logged in, any device) types the HOF reference number to obtain
 * order_id + status so the signed tracker can render. PRIVACY: returns ONLY
 * order_id and status — never customer PII, phone, items, or totals.
 */
header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/../backend/db.php';
require_once __DIR__ . '/../backend/rate_limit.php';

// 20 lookups per minute per IP (ref-sensitive; brute-force is expensive for
// an attacker since each HOF reference is a high-entropy 9+ digit token).
hof_rate_limit('lookup_order_by_ref', 20, 60);

$input = json_decode(file_get_contents('php://input'), true);
$raw = isset($input['ref']) ? trim((string)$input['ref']) : '';

if ($raw === '' || !preg_match('/^HOF\d{9,}$/i', $raw)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Enter a valid reference number (e.g. HOF202600001).']);
    exit;
}

try {
    $stmt = $pdo->prepare("SELECT order_id, status FROM orders WHERE reference_number = ? LIMIT 1");
    $stmt->execute([$raw]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$row) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'No order found for that number.']);
        exit;
    }

    echo json_encode([
        'success'  => true,
        'order_id' => (int)$row['order_id'],
        'status'   => (string)$row['status']
    ]);
} catch (Throwable $e) {
    error_log('lookup_order_by_ref error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Failed to look up order.']);
}