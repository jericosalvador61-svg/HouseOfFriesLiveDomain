<?php
/**
 * backend/page_gate.php
 *
 * Server-side page protection. All requests to /public/<folder>/*.html are
 * rewritten here by .htaccess. The gate validates the hof_token JWT cookie,
 * checks that the token's role is allowed to view that folder, and only then
 * serves the raw HTML. Invalid/expired/wrong-role visitors are redirected to
 * the login page instead of ever seeing dashboard markup.
 */

require_once __DIR__ . '/secret.php';

function gateRedirect(): void
{
    $base = rtrim(str_replace('\\', '/', dirname(dirname($_SERVER['SCRIPT_NAME']))), '/');
    header('Location: ' . $base . '/index.html');
    exit;
}

function gateForbidden(): void
{
    http_response_code(403);
    echo '<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding-top:80px;">'
       . '<h2>403 — Access denied</h2><p>Your account does not have permission to view this page.</p>'
       . '<a href="../../index.html">Go to login</a></body></html>';
    exit;
}

// Folder -> allowed roles
$rolesByFolder = [
    'admin'         => ['admin'],
    'cashier'       => ['cashier', 'admin'],
    'inventorystaff'=> ['inventory staff', 'admin'],
    'kitchenstaff'  => ['kitchen staff', 'admin'],
    'supervisor'    => ['supervisor', 'admin'],
    'waiter'        => ['waiter', 'admin'],
];

$file = isset($_GET['file']) ? (string)$_GET['file'] : '';

// Sanitize: no traversal, must be a .html inside a known folder
if ($file === '' || strpos($file, '..') !== false || stripos($file, '.html') !== strlen($file) - 5) {
    gateRedirect();
}

$folder = strtolower(strtok($file, '/'));
if (!isset($rolesByFolder[$folder])) {
    gateRedirect();
}

$publicRoot = realpath(__DIR__ . '/../public');
$pagePath   = realpath(__DIR__ . '/../public/' . $file);

if (!$publicRoot || !$pagePath || strpos($pagePath, $publicRoot) !== 0 || !is_file($pagePath)) {
    http_response_code(404);
    echo 'Page not found.';
    exit;
}

// ------------------------------------------------------------------
// Validate the JWT from the hof_token cookie
// ------------------------------------------------------------------
$token = isset($_COOKIE['hof_token']) ? trim((string)$_COOKIE['hof_token']) : '';
if ($token === '') {
    gateRedirect();
}

$parts = explode('.', $token);
if (count($parts) !== 3) {
    gateRedirect();
}

list($b64Header, $b64Payload, $b64Signature) = $parts;

$header    = base64_decode(str_replace(['-', '_'], ['+', '/'], $b64Header), true);
$payload   = base64_decode(str_replace(['-', '_'], ['+', '/'], $b64Payload), true);
$signature = base64_decode(str_replace(['-', '_'], ['+', '/'], $b64Signature), true);

if ($header === false || $payload === false || $signature === false) {
    gateRedirect();
}

$expectedSignature = hash_hmac('sha256', $b64Header . '.' . $b64Payload, JWT_SECRET, true);
if (!hash_equals($expectedSignature, $signature)) {
    gateRedirect();
}

$data = json_decode($payload, true);
if (!is_array($data) || !isset($data['exp']) || $data['exp'] < time()) {
    gateRedirect();
}

$role = strtolower(trim((string)($data['role'] ?? '')));
if (!in_array($role, $rolesByFolder[$folder], true)) {
    gateForbidden();
}

// ------------------------------------------------------------------
// Authorized — serve the page
// ------------------------------------------------------------------
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
readfile($pagePath);
exit;
