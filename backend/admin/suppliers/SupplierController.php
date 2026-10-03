<?php
// backend/admin/suppliers/SupplierController.php

require_once __DIR__ . '/Supplier.php';

class SupplierController {
    private $model;

    public function __construct() {
        $this->model = new Supplier();
    }

    /**
     * Send JSON response with consistent format.
     */
    private function respond($data, $statusCode = 200) {
        http_response_code($statusCode);
        header('Content-Type: application/json');
        echo json_encode($data);
        exit;
    }

    /**
     * Get JSON input from request body.
     */
    private function getJsonInput() {
        $raw = file_get_contents('php://input');
        return json_decode($raw, true) ?? [];
    }

    /**
     * Handle POST /create
     */
    public function create() {
        $input = $this->getJsonInput();
        $result = $this->model->create($input);
        if ($result['success']) {
            $supplierId = $result['data']['supplier_id'] ?? 0;
            $name = $input['supplier_name'] ?? 'Unknown';
            global $auth, $pdo;
            logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'], 'SUPPLIER_ADD', "Added supplier {$name}", 'supplier', $supplierId, (string)$name, 'Active');
            $this->respond(['status' => 'success', 'message' => $result['message'], 'data' => $result['data']], 201);
        } else {
            $this->respond(['status' => 'error', 'message' => $result['message'], 'errors' => $result['errors'] ?? null], 400);
        }
    }

    /**
     * Handle GET /list
     */
    public function list() {
        $page = isset($_GET['page']) ? (int)$_GET['page'] : 1;
        $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 10;
        $search = $_GET['search'] ?? '';
        $result = $this->model->list($page, $limit, $search);
        $this->respond(['status' => 'success', 'message' => $result['message'], 'data' => $result['data']]);
    }

    /**
     * Handle GET /get?id=...
     */
    public function get() {
        $id = isset($_GET['id']) ? (int)$_GET['id'] : 0;
        if ($id <= 0) {
            $this->respond(['status' => 'error', 'message' => 'Invalid ID.'], 400);
        }
        $result = $this->model->get($id);
        if ($result['success']) {
            $this->respond(['status' => 'success', 'message' => $result['message'], 'data' => $result['data']]);
        } else {
            $this->respond(['status' => 'error', 'message' => $result['message']], 404);
        }
    }

    /**
     * Handle PUT /update
     */
    public function update() {
        $input = $this->getJsonInput();
        $id = $input['supplier_id'] ?? 0;
        if ($id <= 0) {
            $this->respond(['status' => 'error', 'message' => 'Supplier ID required.'], 400);
        }
        $result = $this->model->update($id, $input);
        if ($result['success']) {
            $name = $input['supplier_name'] ?? 'Unknown';
            global $auth, $pdo;
            logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'], 'SUPPLIER_UPDATE', "Updated supplier {$name}", 'supplier', $id, (string)$name, 'Active');
            $this->respond(['status' => 'success', 'message' => $result['message'], 'data' => $result['data']]);
        } else {
            $status = isset($result['errors']) ? 400 : 404;
            $this->respond(['status' => 'error', 'message' => $result['message'], 'errors' => $result['errors'] ?? null], $status);
        }
    }

    /**
     * Handle DELETE /delete
     */
    public function delete() {
        $input = $this->getJsonInput();
        $id = $input['supplier_id'] ?? 0;
        if ($id <= 0) {
            $this->respond(['status' => 'error', 'message' => 'Supplier ID required.'], 400);
        }
        $supplier = $this->model->get($id);
        $supplierName = $supplier['success'] ? ($supplier['data']['supplier_name'] ?? 'Unknown') : 'Unknown';
        $result = $this->model->delete($id);
        if ($result['success']) {
            global $auth, $pdo;
            logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'], 'SUPPLIER_DELETE', "Deleted supplier {$supplierName}", 'supplier', $id, (string)$supplierName, 'Inactive');
            $this->respond(['status' => 'success', 'message' => $result['message']]);
        } else {
            $this->respond(['status' => 'error', 'message' => $result['message']], 400);
        }
    }

    /**
     * Handle POST /set-status (optional – for toggling)
     */
    public function setStatus() {
        $input = $this->getJsonInput();
        $id = $input['supplier_id'] ?? 0;
        $status = $input['status'] ?? '';
        if ($id <= 0 || empty($status)) {
            $this->respond(['status' => 'error', 'message' => 'Supplier ID and status required.'], 400);
        }
        $result = $this->model->setStatus($id, $status);
        if ($result['success']) {
            $newStatus = $result['data']['status'] ?? $status;
            $supplier = $this->model->get($id);
            $supplierName = $supplier['success'] ? ($supplier['data']['supplier_name'] ?? 'Unknown') : 'Unknown';
            global $auth, $pdo;
            logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'], 'SUPPLIER_STATUS', "Supplier {$supplierName} -> {$newStatus}", 'supplier', $id, (string)$supplierName, (string)$newStatus);
            $this->respond(['status' => 'success', 'message' => $result['message'], 'data' => $result['data']]);
        } else {
            $this->respond(['status' => 'error', 'message' => $result['message']], 400);
        }
    }
}