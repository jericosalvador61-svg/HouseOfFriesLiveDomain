<?php
require_once __DIR__ . "/../backend/db.php";
require_once __DIR__ . "/../backend/geofence_config.php";
require_once __DIR__ . "/../backend/url_signer.php";
require_once __DIR__ . "/../backend/libs/fpdf.php";

define('HOF_FB_PAGE', 'facebook.com/HouseOfFriesTagoloan');

$orderId = isset($_GET['order_id']) ? intval($_GET['order_id']) : 0;
$ref = isset($_GET['ref']) ? trim($_GET['ref']) : '';
$sig = isset($_GET['sig']) ? trim($_GET['sig']) : '';

if (!$orderId || empty($ref) || empty($sig)) {
    die("Missing required parameters.");
}

hof_require_signed_params(['order_id' => $orderId, 'ref' => $ref, 'purpose' => 'receipt'], $sig, false, true);

try {
    $verifyStmt = $pdo->prepare("SELECT reference_number FROM orders WHERE order_id = ?");
    $verifyStmt->execute([$orderId]);
    $dbRef = $verifyStmt->fetchColumn();
    if ($dbRef !== $ref) {
        die("Reference mismatch.");
    }

    $orderStmt = $pdo->prepare("
        SELECT o.*,
               u.first_name AS cashier_first,
               u.last_name  AS cashier_last,
               rt.table_number,
               p.payment_method,
               p.transaction_reference,
               p.change_given,
               p.amount_paid AS payment_amount
          FROM orders o
          LEFT JOIN users           u  ON o.user_id   = u.user_id
          LEFT JOIN restaurant_table rt ON o.table_id  = rt.table_id
          LEFT JOIN (
              SELECT order_id,
                     payment_method,
                     transaction_reference,
                     change_given,
                     amount_paid
                FROM payments
               WHERE payment_status = 'COMPLETED'
               ORDER BY payment_id DESC
          ) p ON o.order_id = p.order_id
         WHERE o.order_id = :order_id
         LIMIT 1
    ");
    $orderStmt->execute(['order_id' => $orderId]);
    $order = $orderStmt->fetch(PDO::FETCH_ASSOC);

    if (!$order) {
        die("Order not found.");
    }

    $itemsStmt = $pdo->prepare("SELECT oi.*, mi.item_name
                                  FROM order_items oi
                                  JOIN menu_items mi ON oi.menu_item_id = mi.menu_item_id
                                 WHERE oi.order_id = :order_id AND oi.is_deleted = 0");
    $itemsStmt->execute(['order_id' => $orderId]);
    $items = $itemsStmt->fetchAll(PDO::FETCH_ASSOC);
} catch (PDOException $e) {
    error_log("generate_receipt.php: " . $e->getMessage());
    die("Unable to generate receipt. Please try again.");
}

$branchName = '';
try {
    $branchStmt = $pdo->query("SELECT branch_name FROM branch_settings ORDER BY setting_id ASC LIMIT 1");
    $branchRow  = $branchStmt->fetch(PDO::FETCH_ASSOC);
    if ($branchRow && !empty($branchRow['branch_name'])) {
        $branchName = $branchRow['branch_name'];
    }
} catch (PDOException $e) {
}

$location = $branchName ?: "Villegas St., Poblacion, Tagoloan, Misamis Oriental";

function sanitize($str) {
    if ($str === null || $str === false) return '';
    return iconv('UTF-8', 'ISO-8859-1//TRANSLIT', $str);
}

$pdf = new FPDF('P', 'mm', array(80, 200));
$pdf->AddPage();
$pdf->SetMargins(4, 8, 4);
$pdf->SetAutoPageBreak(true, 10);

$pdf->SetFont('Courier', 'B', 14);
$pdf->Cell(72, 7, "HOUSE OF FRIES", 0, 1, 'C');
$pdf->SetFont('Courier', '', 8);
$pdf->Cell(72, 4, sanitize($location), 0, 1, 'C');
$pdf->SetFont('Courier', 'I', 9);
$pdf->Cell(72, 4, "Fresh & Crispy Fries", 0, 1, 'C');
$pdf->Ln(3);

$pdf->SetFont('Courier', '', 9);
$refNum = $order['reference_number'] ?? 'HOF-' . $orderId;
$dateStr = date('Y-m-d H:i:s', strtotime($order['created_at']));

$pdf->Cell(72, 4, "Ref #: " . $refNum, 0, 1, 'L');
$pdf->Cell(72, 4, "Date : " . $dateStr, 0, 1, 'L');

$cashierName = '';
if ($order['cashier_first'] || $order['cashier_last']) {
    $cashierName = trim(($order['cashier_first'] ?? '') . ' ' . ($order['cashier_last'] ?? ''));
}
$pdf->Cell(72, 4, "Cashier: " . ($cashierName ?: 'N/A'), 0, 1, 'L');

$customerName = $order['customer_name'] ?? null;
$pdf->Cell(72, 4, "Customer: " . ($customerName ?: 'Walk-in'), 0, 1, 'L');

if ($order['order_type'] === 'DINE_IN' && !empty($order['table_number'])) {
    $pdf->Cell(72, 4, "Table : " . $order['table_number'], 0, 1, 'L');
}

$paymentMethod = $order['payment_method'] ?? 'N/A';
$paymentLine = "Payment: " . $paymentMethod;
if ($paymentMethod === 'GCASH' && !empty($order['transaction_reference'])) {
    $paymentLine .= " Ref: " . $order['transaction_reference'];
} elseif ($paymentMethod === 'CASH' && $order['payment_amount'] > 0) {
    $paymentLine .= " Paid: P" . number_format(floatval($order['payment_amount']), 2);
    if (!empty($order['change_given']) && floatval($order['change_given']) > 0) {
        $paymentLine .= " Chg: P" . number_format(floatval($order['change_given']), 2);
    }
}
$pdf->Cell(72, 4, $paymentLine, 0, 1, 'L');

$pdf->Cell(72, 4, "Type : " . sanitize($order['order_type']), 0, 1, 'L');
$pdf->Ln(1);

$pdf->Cell(72, 3, str_repeat('-', 40), 0, 1, 'C');

foreach ($items as $item) {
    $itemString = $item['quantity'] . "x " . sanitize($item['item_name']);
    $priceString = "P" . number_format($item['price'] * $item['quantity'], 2);

    $pdf->Cell(48, 5, $itemString, 0, 0, 'L');
    $pdf->Cell(24, 5, $priceString, 0, 1, 'R');

    $instructions = trim($item['special_instructions'] ?? '');
    if ($instructions !== '') {
        $pdf->SetFont('Courier', 'I', 7);
        $pdf->Cell(72, 3, "   (" . sanitize($instructions) . ")", 0, 1, 'L');
        $pdf->SetFont('Courier', '', 9);
    }
}

$pdf->Cell(72, 3, str_repeat('-', 40), 0, 1, 'C');

$pdf->SetFont('Courier', 'B', 11);
$grandTotal = "P" . number_format($order['total_amount'], 2);
$pdf->Cell(45, 6, "TOTAL DUE:", 0, 0, 'L');
$pdf->Cell(27, 6, $grandTotal, 0, 1, 'R');

$pdf->SetFont('Courier', '', 8);
$vatLine = "VAT (0%)";
$vatAmount = "P0.00";
$pdf->Cell(72, 4, "----------------------------------------", 0, 1, 'C');
$pdf->Cell(45, 4, $vatLine, 0, 0, 'L');
$pdf->Cell(27, 4, $vatAmount, 0, 1, 'R');

$svcLine = "Service Charge (0%)";
$svcAmount = "P0.00";
$pdf->Cell(45, 4, $svcLine, 0, 0, 'L');
$pdf->Cell(27, 4, $svcAmount, 0, 1, 'R');

$pdf->SetFont('Courier', 'B', 11);
$pdf->Cell(72, 5, "========================================", 0, 1, 'C');
$pdf->Cell(72, 6, "===== COMPLETE TRANSACTION =====", 0, 1, 'C');
$pdf->Cell(72, 5, "========================================", 0, 1, 'C');
$pdf->Ln(3);
$pdf->SetFont('Courier', 'I', 9);
$pdf->Cell(72, 4, "Thank you! Come again!", 0, 1, 'C');
$pdf->Cell(72, 4, "Follow us: " . HOF_FB_PAGE, 0, 1, 'C');

$filename = "Receipt-" . $refNum . ".pdf";
$pdf->Output('D', $filename);
exit;