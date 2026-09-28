<?php
// backend/admin/suppliers/Supplier.php

require_once __DIR__ . '/../../db.php';

class Supplier {
    private $db;

    public function __construct() {
        global $pdo;
        $this->db = $pdo;
    }

    /**
     * Validate supplier data (for create/update)
     * @param array $data
     * @param int|null $excludeId (for uniqueness check on update)
     * @return array ['valid' => bool, 'errors' => [field => message]]
     */
    public function validate($data, $excludeId = null) {
        $errors = [];

        // supplier_name: required, max 100, unique (case‑insensitive)
        $name = trim($data['supplier_name'] ?? '');
        if (empty($name)) {
            $errors['supplier_name'] = 'Supplier name is required.';
        } elseif (strlen($name) > 100) {
            $errors['supplier_name'] = 'Supplier name cannot exceed 100 characters.';
        } else {
            // Check uniqueness (case‑insensitive)
            $sql = "SELECT supplier_id FROM suppliers WHERE LOWER(supplier_name) = LOWER(?)";
            $params = [$name];
            if ($excludeId) {
                $sql .= " AND supplier_id != ?";
                $params[] = $excludeId;
            }
            $stmt = $this->db->prepare($sql);
            $stmt->execute($params);
            if ($stmt->fetch()) {
                $errors['supplier_name'] = 'Supplier name already exists.';
            }
        }

        // contact_person: optional, max 100
        $contact = trim($data['contact_person'] ?? '');
        if (strlen($contact) > 100) {
            $errors['contact_person'] = 'Contact person cannot exceed 100 characters.';
        }

        // contact_number: optional, max 20
        $phone = trim($data['contact_number'] ?? '');
        if (strlen($phone) > 20) {
            $errors['contact_number'] = 'Contact number cannot exceed 20 characters.';
        }

        // email: optional, valid email
        $email = trim($data['email'] ?? '');
        if (!empty($email) && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $errors['email'] = 'Invalid email format.';
        }

        // address: required
        $address = trim($data['address'] ?? '');
        if (empty($address)) {
            $errors['address'] = 'Address is required.';
        }

        // status: must be ACTIVE or INACTIVE
        $status = strtoupper(trim($data['status'] ?? 'ACTIVE'));
        if (!in_array($status, ['ACTIVE', 'INACTIVE'])) {
            $errors['status'] = 'Status must be ACTIVE or INACTIVE.';
        }

        return ['valid' => empty($errors), 'errors' => $errors];
    }

    /**
     * Create a new supplier
     * @return array [success, message, data (supplier_id)]
     */
    public function create($data) {
        $validation = $this->validate($data);
        if (!$validation['valid']) {
            return ['success' => false, 'message' => 'Validation failed.', 'errors' => $validation['errors']];
        }

        $sql = "INSERT INTO suppliers (supplier_name, contact_person, contact_number, email, address, status)
                VALUES (:name, :contact, :phone, :email, :address, :status)";
        $stmt = $this->db->prepare($sql);
        $stmt->execute([
            ':name' => trim($data['supplier_name']),
            ':contact' => trim($data['contact_person'] ?? ''),
            ':phone' => trim($data['contact_number'] ?? ''),
            ':email' => trim($data['email'] ?? ''),
            ':address' => trim($data['address']),
            ':status' => strtoupper(trim($data['status'] ?? 'ACTIVE'))
        ]);

        return ['success' => true, 'message' => 'Supplier created successfully.', 'data' => ['supplier_id' => $this->db->lastInsertId()]];
    }

    /**
     * Get a single supplier by ID
     * @return array [success, message, data (supplier row)]
     */
    public function get($id) {
        $stmt = $this->db->prepare("SELECT * FROM suppliers WHERE supplier_id = ?");
        $stmt->execute([$id]);
        $supplier = $stmt->fetch();
        if (!$supplier) {
            return ['success' => false, 'message' => 'Supplier not found.', 'data' => null];
        }
        return ['success' => true, 'message' => 'Supplier retrieved.', 'data' => $supplier];
    }

    /**
     * Update a supplier
     * @return array [success, message, errors (if validation fails)]
     */
    public function update($id, $data) {
        // First check existence
        $existing = $this->get($id);
        if (!$existing['success']) {
            return $existing;
        }

        $validation = $this->validate($data, $id);
        if (!$validation['valid']) {
            return ['success' => false, 'message' => 'Validation failed.', 'errors' => $validation['errors']];
        }

        $sql = "UPDATE suppliers SET
                    supplier_name = :name,
                    contact_person = :contact,
                    contact_number = :phone,
                    email = :email,
                    address = :address,
                    status = :status
                WHERE supplier_id = :id";
        $stmt = $this->db->prepare($sql);
        $stmt->execute([
            ':name' => trim($data['supplier_name']),
            ':contact' => trim($data['contact_person'] ?? ''),
            ':phone' => trim($data['contact_number'] ?? ''),
            ':email' => trim($data['email'] ?? ''),
            ':address' => trim($data['address']),
            ':status' => strtoupper(trim($data['status'] ?? 'ACTIVE')),
            ':id' => $id
        ]);

        return ['success' => true, 'message' => 'Supplier updated successfully.', 'data' => ['supplier_id' => $id]];
    }

    /**
     * Delete a supplier (hard delete, but check for related raw_material_supplier records)
     * @return array
     */
    public function delete($id) {
        // Check if supplier is used in raw_material_supplier
        $stmt = $this->db->prepare("SELECT COUNT(*) FROM raw_material_supplier WHERE supplier_id = ?");
        $stmt->execute([$id]);
        $count = $stmt->fetchColumn();
        if ($count > 0) {
            return ['success' => false, 'message' => "Cannot delete supplier: it is linked to $count raw material(s)."];
        }

        // If no usage, delete
        $stmt = $this->db->prepare("DELETE FROM suppliers WHERE supplier_id = ?");
        $stmt->execute([$id]);
        if ($stmt->rowCount() === 0) {
            return ['success' => false, 'message' => 'Supplier not found.'];
        }
        return ['success' => true, 'message' => 'Supplier deleted successfully.'];
    }

    /**
     * List suppliers with pagination, search, and ordering (active first).
     * @return array [success, message, data: [items, total, page, limit]]
     */
    public function list($page = 1, $limit = 10, $search = '') {
        $offset = ($page - 1) * $limit;

        // Base query: active first, then inactive
        $orderBy = "ORDER BY 
                    CASE WHEN status = 'ACTIVE' THEN 0 ELSE 1 END,
                    supplier_name ASC";

        $params = [];
        $where = '';
        if (!empty($search)) {
            $searchTerm = "%$search%";
            $where = "WHERE supplier_name LIKE ? 
                      OR contact_person LIKE ? 
                      OR contact_number LIKE ? 
                      OR email LIKE ? 
                      OR address LIKE ?";
            $params = array_fill(0, 5, $searchTerm);
        }

        // Get total count
        $countSql = "SELECT COUNT(*) FROM suppliers $where";
        $stmt = $this->db->prepare($countSql);
        $stmt->execute($params);
        $total = (int)$stmt->fetchColumn();

        // Get paginated results
        $sql = "SELECT * FROM suppliers $where $orderBy LIMIT ? OFFSET ?";
        $stmt = $this->db->prepare($sql);
        $stmt->execute(array_merge($params, [$limit, $offset]));
        $items = $stmt->fetchAll();

        return [
            'success' => true,
            'message' => 'Suppliers retrieved.',
            'data' => [
                'items' => $items,
                'total' => $total,
                'page' => (int)$page,
                'limit' => (int)$limit,
                'total_pages' => ceil($total / $limit)
            ]
        ];
    }

    /**
     * Check if a supplier can be deactivated (i.e., no active raw_material_supplier links)
     * @return bool true if can deactivate, false otherwise
     */
    public function canDeactivate($id) {
        $stmt = $this->db->prepare("SELECT COUNT(*) FROM raw_material_supplier WHERE supplier_id = ? AND status = 'ACTIVE'");
        $stmt->execute([$id]);
        $count = $stmt->fetchColumn();
        return $count == 0;
    }

    /**
     * Change supplier status (with pre‑check)
     * @return array
     */
    public function setStatus($id, $newStatus) {
        $newStatus = strtoupper($newStatus);
        if (!in_array($newStatus, ['ACTIVE', 'INACTIVE'])) {
            return ['success' => false, 'message' => 'Invalid status.'];
        }

        // If trying to set INACTIVE, check for active raw material links
        if ($newStatus === 'INACTIVE') {
            if (!$this->canDeactivate($id)) {
                return ['success' => false, 'message' => 'Cannot deactivate: supplier is still linked to active raw materials.'];
            }
        }

        $stmt = $this->db->prepare("UPDATE suppliers SET status = ? WHERE supplier_id = ?");
        $stmt->execute([$newStatus, $id]);
        if ($stmt->rowCount() === 0) {
            return ['success' => false, 'message' => 'Supplier not found.'];
        }
        return ['success' => true, 'message' => "Supplier status updated to $newStatus.", 'data' => ['supplier_id' => $id, 'status' => $newStatus]];
    }
}