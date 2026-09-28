<?php
// backend/order_token_helper.php
// Per-order HMAC tokens so public customer endpoints can verify that the
// requester legitimately owns the order (prevents IDOR on sequential IDs).

require_once __DIR__ . '/secret.php';

function generateOrderToken($orderId): string
{
    return hash_hmac('sha256', 'hof-order:' . (int)$orderId, JWT_SECRET);
}

function verifyOrderToken($orderId, $token): bool
{
    return is_string($token)
        && $token !== ''
        && hash_equals(generateOrderToken($orderId), $token);
}
