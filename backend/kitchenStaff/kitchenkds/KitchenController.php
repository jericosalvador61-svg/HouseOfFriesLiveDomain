<?php
// backend/admin/kitchen/KitchenController.php

require_once __DIR__ . '/Kitchen.php';

class KitchenController {
    private $model;

    public function __construct() {
        $this->model = new Kitchen();
    }

    private function respond($data, $statusCode = 200) {
        http_response_code($statusCode);
        header('Content-Type: application/json');
        echo json_encode($data);
        exit;
    }

    public function getOrders() {
        $orders = $this->model->getActiveOrders();
        $this->respond([
            'status' => 'success',
            'data' => $orders
        ]);
    }

    public function updateStatus() {
        $input = json_decode(file_get_contents('php://input'), true);
        $orderId = $input['order_id'] ?? 0;
        $newStatus = $input['status'] ?? '';

        if (!$orderId || !$newStatus) {
            $this->respond(['status' => 'error', 'message' => 'Order ID and status required.'], 400);
        }

        $result = $this->model->updateStatus($orderId, $newStatus);
        if ($result['success']) {
            // Trigger Pusher event after successful update
            $this->triggerPusherEvent($orderId, $newStatus);
            $this->respond(['status' => 'success', 'message' => $result['message']]);
        } else {
            $this->respond(['status' => 'error', 'message' => $result['message']], 400);
        }
    }

    private function triggerPusherEvent($orderId, $status) {
        // Include pusher_helper if it exists
        $pusherFile = __DIR__ . '/../../pusher_helper.php';
        if (file_exists($pusherFile)) {
            require_once $pusherFile;
            broadcastOrderUpdate($orderId, "Status changed to $status", $status);
        }
    }
}