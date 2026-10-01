<?php
/**
 * backend/customer_auth.php
 * REQ-052 Batch 3 — Customer session helpers.
 *
 * Customer accounts authenticate with their OWN JWT (signed with
 * CUSTOMER_JWT_SECRET) so the staff JWT_SECRET stays staff-only.
 *
 * A customer token payload carries:
 *   customer_id, phone_number, name, role: 'customer', exp: time()+24h
 *   (deliberately NO last_activity — auth_middleware exempts 'customer'
 *    from the idle timeout, and place_order re-reads freshness directly).
 */

require_once __DIR__ . '/secret.php';

// CUSTOMER_JWT_SECRET must exist even on environments whose gitignored
// secret.php predates REQ-052 (fresh clone / InfinityFree deploy). The
// customer token is NEVER signed with the staff JWT_SECRET.
// DEPLOY NOTE: on the live server, define CUSTOMER_JWT_SECRET in
// backend/secret.php (or env CUSTOMER_JWT_SECRET) with a RANDOM value —
// the fallback below is a repo-visible dev value and must never sign
// production tokens.
if (!defined('CUSTOMER_JWT_SECRET')) {
    $hofCustomerSecret = getenv('CUSTOMER_JWT_SECRET');
    if ($hofCustomerSecret === false || $hofCustomerSecret === '') {
        error_log('[HOF] WARNING: CUSTOMER_JWT_SECRET not set — using dev fallback. Set it in backend/secret.php on production.');
        $hofCustomerSecret = 'HOF_CUSTOMER_JWT_SECRET__CHANGE_ME__77f7f7f7f7f7f7f7f7f7';
    }
    define('CUSTOMER_JWT_SECRET', $hofCustomerSecret);
}

if (!function_exists('hof_generate_jwt')) {
    /**
     * Minimal base64url HS256 JWT builder (mirrors backend/login.php).
     */
    function hof_generate_jwt(array $payload, string $secret): string
    {
        $header = json_encode(['typ' => 'JWT', 'alg' => 'HS256']);
        $b64Header  = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode($header));
        $b64Payload = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode(json_encode($payload)));
        $signature  = hash_hmac('sha256', $b64Header . '.' . $b64Payload, $secret, true);
        $b64Sig     = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode($signature));
        return $b64Header . '.' . $b64Payload . '.' . $b64Sig;
    }
}

if (!function_exists('issueCustomerToken')) {
    /**
     * Issue a 24h customer JWT (never signed with the staff JWT_SECRET).
     *
     * @param array $customer row from the customers table
     *                        (customer_id, phone_number, name).
     * @return string
     */
    function issueCustomerToken(array $customer): string
    {
        $payload = [
            'customer_id'  => (int)$customer['customer_id'],
            'phone_number' => (string)$customer['phone_number'],
            'name'         => (string)($customer['name'] ?? ''),
            'role'         => 'customer',
            'exp'          => time() + (24 * 60 * 60),
        ];
        return hof_generate_jwt($payload, CUSTOMER_JWT_SECRET);
    }
}

if (!function_exists('hof_decode_customer_token')) {
    /**
     * Decode + validate a customer JWT against CUSTOMER_JWT_SECRET.
     * Returns the payload array on success, or null on any failure
     * (missing/malformed/bad signature/expired/not-a-customer).
     *
     * @param string $token
     * @return array|null
     */
    function hof_decode_customer_token(string $token)
    {
        if ($token === '') {
            return null;
        }
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            return null;
        }
        list($b64Header, $b64Payload, $b64Signature) = $parts;

        $header  = base64_decode(str_replace(['-', '_'], ['+', '/'], $b64Header), true);
        $payload = base64_decode(str_replace(['-', '_'], ['+', '/'], $b64Payload), true);
        $sig     = base64_decode(str_replace(['-', '_'], ['+', '/'], $b64Signature), true);
        if ($header === false || $payload === false || $sig === false) {
            return null;
        }

        $expected = hash_hmac('sha256', $b64Header . '.' . $b64Payload, CUSTOMER_JWT_SECRET, true);
        if (!hash_equals($expected, $sig)) {
            return null;
        }

        $data = json_decode($payload, true);
        if (!is_array($data)) {
            return null;
        }
        if (strtolower((string)($data['role'] ?? '')) !== 'customer') {
            return null;
        }
        if (!isset($data['customer_id']) || !isset($data['exp']) || (int)$data['exp'] < time()) {
            return null;
        }

        return $data;
    }
}

if (!function_exists('getCustomerTokenFromRequest')) {
    /**
     * Read the customer token from, in order:
     *   1. Authorization: Bearer <token>
     *   2. hof_customer_token cookie
     *   3. {token} in the JSON body
     *   4. token= form field
     *
     * Returns the raw token string ('' when absent).
     */
    function getCustomerTokenFromRequest(): string
    {
        $rawHeaders = function_exists('getallheaders') ? getallheaders() : [];
        $headers = is_array($rawHeaders) ? $rawHeaders : [];
        $authHeader = $headers['Authorization'] ?? $headers['authorization'] ?? '';
        if (preg_match('/Bearer\s+(.+)$/i', $authHeader, $m)) {
            return trim($m[1]);
        }
        if (!empty($_SERVER['HTTP_AUTHORIZATION']) && preg_match('/Bearer\s+(.+)$/i', $_SERVER['HTTP_AUTHORIZATION'], $m)) {
            return trim($m[1]);
        }
        if (!empty($_COOKIE['hof_customer_token'])) {
            return trim((string)$_COOKIE['hof_customer_token']);
        }
        $rawBody = file_get_contents('php://input');
        if ($rawBody !== '') {
            $body = json_decode($rawBody, true);
            if (is_array($body) && !empty($body['token'])) {
                return trim((string)$body['token']);
            }
        }
        if (!empty($_POST['token'])) {
            return trim((string)$_POST['token']);
        }
        return '';
    }
}

if (!function_exists('require_customer')) {
    /**
     * Resolve the authenticated customer from the current request.
     *
     * On success returns the decoded payload array:
     *   ['customer_id' => int, 'phone_number' => string, 'name' => string, 'role' => 'customer']
     *
     * On failure sends a JSON 401 and exits. The customer identity is ALWAYS
     * derived server-side from the token — never from client-supplied
     * customer_id / phone query params.
     *
     * @param bool $echo  when true, emit the 401 JSON body (default true).
     * @return array
     */
    function require_customer(bool $echo = true): array
    {
        $token = getCustomerTokenFromRequest();
        $payload = hof_decode_customer_token($token);
        if (!$payload) {
            if ($echo) {
                http_response_code(401);
                header('Content-Type: application/json');
                echo json_encode([
                    'success' => false,
                    'message' => 'Please log in to view your orders.',
                    'code'    => 'CUSTOMER_AUTH_REQUIRED',
                ]);
            }
            exit;
        }

        // Deactivated/locked customers lose access immediately (not just at
        // the next login): a fresh DB read keeps the 24h token revocable.
        static $pdoLocal = null;
        if ($pdoLocal === null) {
            $pdoLocal = $GLOBALS['pdo'] ?? null;
            if (!$pdoLocal && class_exists('PDO')) {
                // db.php normally defines $pdo globally; fall back to a lookup
                // via the same require used by every endpoint.
                foreach ($GLOBALS as $k => $v) {
                    if ($v instanceof PDO) { $pdoLocal = $v; break; }
                }
            }
        }
        if ($pdoLocal) {
            try {
                $cid = (int)$payload['customer_id'];
                $stmt = $pdoLocal->prepare('SELECT is_active FROM customers WHERE customer_id = ? LIMIT 1');
                $stmt->execute([$cid]);
                $row = $stmt->fetch(PDO::FETCH_ASSOC);
                if (!$row || (int)$row['is_active'] !== 1) {
                    if ($echo) {
                        http_response_code(401);
                        header('Content-Type: application/json');
                        echo json_encode([
                            'success' => false,
                            'message' => 'This account has been deactivated. Please ask restaurant staff to reactivate it.',
                            'code'    => 'CUSTOMER_INACTIVE',
                        ]);
                    }
                    exit;
                }
            } catch (Throwable $e) {
                error_log('require_customer is_active check failed: ' . $e->getMessage());
                if ($echo) {
                    http_response_code(500);
                    header('Content-Type: application/json');
                    echo json_encode([
                        'success' => false,
                        'message' => 'Session verification failed. Please try again.',
                        'code'    => 'CUSTOMER_CHECK_ERROR',
                    ]);
                }
                exit;
            }
        }

        return $payload;
    }
}
