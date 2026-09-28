<?php
/**
 * url_signer.php
 * URL signing infrastructure using HMAC-SHA256.
 * Reuses JWT_SECRET from secret.php — no new secrets.
 *
 * Canonical format:
 *   $params = [ 'order_id' => 123, 'ref' => 'HOF202600001', 'purpose' => 'pay' ]
 *   sorted by key → "order_id=123|purpose=pay|ref=HOF202600001"
 *   hash_hmac('sha256', canonical_string, JWT_SECRET) → hex string
 *
 * Usage:
 *   require_once __DIR__ . '/../url_signer.php';
 *   $sig = hof_sign_params(['order_id' => 123, 'ref' => '...']);
 *   $ok  = hof_verify_params(['order_id' => 123, 'ref' => '...'], $sig);
 *
 * Signed URLs:
 *   qr_payment.html?order_id=123&ref=...&sig=abc123           (payment page)
 *   orderTracker.html?order_id=123&sig=abc123                  (deep-link)
 *   orderHistory.html?order_id=123&sig=abc123                  (history)
 *   customer.html?table_id=5&sig=abc123                        (table sticker)
 *
 * Verify fail → redirect to customer.html with generic error.
 * Payment/tracker URLs: unsigned = REJECTED (403 redirect).
 * Table sticker URLs: unsigned STILL WORKS (grace for old printed stickers).
 */

require_once __DIR__ . '/secret.php';

function hof_sign_params(array $params): string
{
    ksort($params);
    $parts = [];
    foreach ($params as $k => $v) {
        $parts[] = $k . '=' . $v;
    }
    $canonical = implode('|', $parts);
    return hash_hmac('sha256', $canonical, JWT_SECRET);
}

function hof_verify_params(array $params, string $sig): bool
{
    $expected = hof_sign_params($params);
    return hash_equals($expected, $sig);
}

function hof_require_signed_params(array $params, string $sig, bool $grace = false, bool $jsonResponse = false): void
{
    if (hof_verify_params($params, $sig)) {
        return;
    }
    if ($grace) {
        return;
    }
    if ($jsonResponse || (isset($_SERVER['HTTP_ACCEPT']) && $_SERVER['HTTP_ACCEPT'] === 'application/json')) {
        http_response_code(403);
        header('Content-Type: application/json');
        echo json_encode(['success' => false, 'message' => 'Invalid or expired link']);
        exit;
    }
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $docRoot = rtrim(str_replace('\\', '/', $_SERVER['DOCUMENT_ROOT']), '/');
    $urlSignerDir = rtrim(str_replace('\\', '/', __DIR__), '/');
    $projectRel = str_replace($docRoot, '', $urlSignerDir . '/..');
    $redirect = $scheme . '://' . $host . $projectRel . '/customer/customer.html';
    header('Location: ' . $redirect);
    exit;
}