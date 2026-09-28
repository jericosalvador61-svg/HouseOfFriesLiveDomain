<?php
/**
 * ============================================================
 * House of Fries - Rate Limiter (IP-based, sliding window)
 * ------------------------------------------------------------
 * A reusable, file-based rate limiter for all public endpoints.
 * No DB writes needed — uses sys_get_temp_dir() for storage.
 *
 * Usage:
 *   require_once __DIR__ . '/../rate_limit.php';
 *   hof_rate_limit('order_placement', 10, 60); // 10 req per 60s
 *   // If exceeded, automatically sends 429 JSON and exits.
 *
 * ============================================================
 */

if (!function_exists('hof_rate_limit')) {
    /**
     * Check and enforce a per-IP rate limit.
     *
     * @param string $action  A unique name for the action being limited
     *                        (e.g. 'place_order', 'occupy_table', 'cancel_order')
     * @param int    $max     Max requests allowed in the window (default: 30)
     * @param int    $window  Time window in seconds (default: 60)
     * @param bool   $enforce When true, sends 429 and exits on violation.
     *                        When false, only returns the result (for logging).
     *
     * @return array ['allowed' => bool, 'remaining' => int, 'reset_after' => int]
     */
    function hof_rate_limit($action, $max = 30, $window = 60, $enforce = true)
    {
        $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
        
        // Sanitize action name for filesystem
        $action = preg_replace('/[^a-zA-Z0-9_-]/', '', $action);
        if ($action === '') $action = 'default';
        
        $dir = sys_get_temp_dir() . '/hof_ratelimit';
        if (!is_dir($dir)) {
            @mkdir($dir, 0777, true);
        }
        
        $file  = $dir . '/' . $action . '_' . hash('sha256', $ip) . '.json';
        $now   = time();
        
        $stamps = [];
        if (is_file($file)) {
            $content = @file_get_contents($file);
            if ($content !== false) {
                $stamps = json_decode($content, true) ?: [];
            }
        }
        
        // Keep only timestamps still inside the window
        $stamps = array_values(array_filter($stamps, function($t) use ($now, $window) {
            return ($now - (int)$t) < $window;
        }));
        
        $remaining = max(0, $max - count($stamps));
        $oldest = !empty($stamps) ? min($stamps) : $now;
        $reset_after = $window - ($now - $oldest);
        if ($reset_after < 0) $reset_after = 0;
        
        if (count($stamps) >= $max) {
            // Persist the pruned list before rejecting
            @file_put_contents($file, json_encode($stamps), LOCK_EX);
            
            if ($enforce) {
                http_response_code(429);
                header('Retry-After: ' . $reset_after);
                header('Content-Type: application/json');
                echo json_encode([
                    'success' => false,
                    'message' => 'Too many requests. Please wait ' . ceil($reset_after) . ' second(s) and try again.',
                    'rate_limited' => true,
                    'retry_after' => $reset_after
                ]);
                exit;
            }
            
            return [
                'allowed' => false,
                'remaining' => 0,
                'reset_after' => $reset_after
            ];
        }
        
        // Record this request
        $stamps[] = $now;
        @file_put_contents($file, json_encode($stamps), LOCK_EX);
        
        return [
            'allowed' => true,
            'remaining' => $remaining - 1,
            'reset_after' => $reset_after
        ];
    }
}

if (!function_exists('hof_rate_limit_light')) {
    /**
     * Lightweight variant: returns true/false, never exits.
     * Use for non-critical rate info.
     */
    function hof_rate_limit_light($action, $max = 30, $window = 60)
    {
        $result = hof_rate_limit($action, $max, $window, false);
        return $result['allowed'];
    }
}