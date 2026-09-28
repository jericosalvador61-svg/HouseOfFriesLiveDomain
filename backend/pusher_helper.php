<?php
function broadcastOrderUpdate($orderId, $message = "Update", $status = null)
{
    $app_id = "2146616";
    $key = "a8860aca373dcc3400ce";
    $secret = "6b1ce6fab43cc3a1a479";
    $cluster = "ap1";

    $events = [
        [
            'name' => 'new-order',
            'channels' => ['hof-orders'],
            'data' => json_encode(['order_id' => $orderId, 'message' => $message])
        ]
    ];

    if ($status !== null) {
        $events[] = [
            'name' => 'order-status-changed',
            'channels' => ['hof-orders'],
            'data' => json_encode(['order_id' => $orderId, 'status' => $status, 'message' => $message])
        ];
    }

    $path = "/apps/$app_id/events";
    $body = json_encode(['events' => $events]);

    $auth_timestamp = time();
    $auth_version = '1.0';
    $body_md5 = md5($body);

    $auth_query = "auth_key=$key&auth_timestamp=$auth_timestamp&auth_version=$auth_version&body_md5=$body_md5";
    $string_to_sign = "POST\n$path\n$auth_query";
    $auth_signature = hash_hmac('sha256', $string_to_sign, $secret);

    $url = "http://api-$cluster.pusher.com$path?$auth_query&auth_signature=$auth_signature";

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    $result = curl_exec($ch);
    curl_close($ch);

    return $result;
}

function broadcastMenuUpdate($menuItemId, $status, $itemName)
{
    $app_id = "2146616";
    $key = "a8860aca373dcc3400ce";
    $secret = "6b1ce6fab43cc3a1a479";
    $cluster = "ap1";

    $data = json_encode([
        'menu_item_id' => $menuItemId,
        'status' => $status,
        'item_name' => $itemName
    ]);

    $path = "/apps/$app_id/events";
    $body = json_encode([
        'name' => 'menu-availability-changed',
        'channels' => ['hof-menu'],
        'data' => $data
    ]);

    $auth_timestamp = time();
    $auth_version = '1.0';
    $body_md5 = md5($body);

    $auth_query = "auth_key=$key&auth_timestamp=$auth_timestamp&auth_version=$auth_version&body_md5=$body_md5";
    $string_to_sign = "POST\n$path\n$auth_query";
    $auth_signature = hash_hmac('sha256', $string_to_sign, $secret);

    $url = "http://api-$cluster.pusher.com$path?$auth_query&auth_signature=$auth_signature";

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    $result = curl_exec($ch);
    curl_close($ch);

    return $result;
}
