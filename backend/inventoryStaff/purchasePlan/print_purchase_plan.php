<?php
// backend/print_purchase_plan.php
require_once __DIR__ . '/../../db.php';

$plan_id = isset($_GET['plan_id']) ? intval($_GET['plan_id']) : 0;

if ($plan_id === 0) {
    die("Error: Invalid Purchase Plan ID requested.");
}

try {
    // 🔑 FETCH MASTER PLAN WITH CREATOR/APPROVER INFO JOINED DYNAMICALLY
    $planStmt = $pdo->prepare("
        SELECT p.*, 
               CONCAT(u.first_name, ' ', u.last_name) AS approver_name, 
               r.role_name AS approver_role
        FROM purchase_plans p
        INNER JOIN users u ON p.created_by = u.user_id
        INNER JOIN roles r ON u.role_id = r.role_id
        WHERE p.plan_id = ?
    ");
    $planStmt->execute([$plan_id]);
    $plan = $planStmt->fetch();

    if (!$plan) {
        die("Error: Purchase plan record could not be tracked down.");
    }

    // Fetch matching item rows (including our unit cost snapshot baseline)
    $itemsStmt = $pdo->prepare("
        SELECT i.*, m.raw_material_name, m.unit 
        FROM purchase_plan_items i 
        JOIN raw_materials m ON i.raw_material_id = m.raw_material_id 
        WHERE i.plan_id = ?
    ");
    $itemsStmt->execute([$plan_id]);
    $items = $itemsStmt->fetchAll();
} catch (PDOException $e) {
    die("Database Error: " . $e->getMessage());
}
?>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <title>House of Fries - Purchase Plan Report</title>
    <style>
        body {
            font-family: 'Arial', sans-serif;
            color: #333;
            margin: 30px;
            line-height: 1.4;
        }

        .header {
            text-align: center;
            margin-bottom: 30px;
            border-bottom: 2px solid #333;
            padding-bottom: 10px;
        }

        .header h1 {
            margin: 0;
            color: #d32f2f;
            font-size: 24px;
            text-transform: uppercase;
        }

        .header p {
            margin: 5px 0 0 0;
            font-size: 12px;
            color: #666;
        }

        .meta-info {
            width: 100%;
            margin-bottom: 25px;
            font-size: 14px;
        }

        .meta-info td {
            padding: 4px 0;
        }

        .meta-info td.label {
            font-weight: bold;
            width: 150px;
        }

        table.data-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 15px;
            font-size: 14px;
        }

        table.data-table th,
        table.data-table td {
            border: 1px solid #ddd;
            padding: 10px;
            text-align: center;
        }

        table.data-table th {
            background-color: #f5f5f5;
            font-weight: bold;
        }

        table.data-table td.text-left {
            text-align: left;
        }

        table.data-table td.text-right,
        table.data-table th.text-right {
            text-align: right;
        }

        .grand-total-row {
            background-color: #f9f9f9;
            font-size: 15px;
        }

        .notes-section {
            margin-top: 30px;
            font-size: 13px;
            background: #f9f9f9;
            padding: 15px;
            border-left: 4px solid #ffc107;
        }

        .signature-area {
            margin-top: 60px;
            display: flex;
            justify-content: space-between;
            font-size: 14px;
        }

        .sig-box {
            width: 200px;
            text-align: center;
            border-top: 1px solid #333;
            padding-top: 5px;
        }

        @media print {
            .no-print {
                display: none;
            }

            body {
                margin: 15px;
            }
        }
    </style>
</head>

<body>

    <div class="no-print" style="margin-bottom: 20px; text-align: right;">
        <button onclick="window.print();" style="padding: 8px 15px; background: #198754; color: white; border: none; cursor: pointer; font-weight: bold; border-radius: 4px;">🖨️ Execute Print</button>
    </div>

    <div class="header">
        <h1>House of Fries</h1>
        <p>Tagoloan Branch Inventory Procurement Report</p>
    </div>

    <table class="meta-info">
        <tr>
            <td class="label">Date Formed:</td>
            <td><?php echo date('F d, Y g:i A', strtotime($plan['created_at'])); ?></td>
            <td class="label">Current Status:</td>
            <td style="font-weight: bold; color: green;"><?php echo htmlspecialchars($plan['status']); ?></td>
        </tr>
        <tr>
            <td class="label">Authorized By:</td>
            <td colspan="3">
                <?php echo htmlspecialchars($plan['approver_name'] . ' (' . $plan['approver_role'] . ')'); ?>
            </td>
        </tr>
    </table>

    <table class="data-table">
        <thead>
            <tr>
                <th>Line No.</th>
                <th class="text-left">Raw Material Name</th>
                <th>Snapshot Level</th>
                <th>Approved Purchase Qty</th>
                <th class="text-right">Unit Cost</th>
                <th class="text-right">Est. Subtotal</th>
            </tr>
        </thead>
        <tbody>
            <?php
            $calculated_grand_total = 0;
            foreach ($items as $index => $item):
                $qty = floatval($item['suggested_quantity']);
                $unit_cost = floatval($item['snapshot_unit_cost'] ?? 0);
                $subtotal = $qty * $unit_cost;
                $calculated_grand_total += $subtotal;
            ?>
                <tr>
                    <td><?php echo $index + 1; ?></td>
                    <td class="text-left"><strong><?php echo htmlspecialchars($item['raw_material_name']); ?></strong></td>
                    <td><?php echo floatval($item['current_quantity']) . ' ' . htmlspecialchars($item['unit']); ?></td>
                    <td style="font-weight: bold; color: #000;"><?php echo $qty . ' ' . htmlspecialchars($item['unit']); ?></td>
                    <td class="text-right">₱<?php echo number_format($unit_cost, 2); ?></td>
                    <td class="text-right fw-bold">₱<?php echo number_format($subtotal, 2); ?></td>
                </tr>
            <?php endforeach; ?>

            <tr class="grand-total-row">
                <td colspan="5" class="text-right fw-bold">Estimated Grand Total:</td>
                <td class="text-right fw-bold text-success" style="font-size: 16px;">
                    ₱<?php echo number_format(($plan['total_cost'] > 0 ? $plan['total_cost'] : $calculated_grand_total), 2); ?>
                </td>
            </tr>
        </tbody>
    </table>

    <?php if (!empty($plan['admin_remarks'])): ?>
        <div class="notes-section">
            <strong>Management Approval Remarks:</strong><br>
            <?php echo htmlspecialchars($plan['admin_remarks']); ?>
        </div>
    <?php endif; ?>

    <div class="signature-area">
        <div class="sig-box" style="margin-top: 40px;">Prepared By (Staff)</div>
        <div class="sig-box" style="margin-top: 40px;">Approved By (Admin)</div>
    </div>

    <script>
        window.onload = function() {
            window.print();
        }
    </script>
</body>

</html>