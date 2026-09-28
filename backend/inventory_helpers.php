<?php

function hof_check_batch_total(PDO $pdo, int $materialId): float
{
    $stmt = $pdo->prepare("
        SELECT COALESCE(SUM(sii.quantity), 0)
        FROM stock_in_items sii
        JOIN stock_in si ON sii.stock_in_id = si.stock_in_id
        WHERE sii.raw_material_id = ?
          AND sii.is_deleted = 0
          AND sii.quantity > 0
          AND (si.status = 'Approved' OR si.status = 'Completed' OR si.status = 'Received')
        FOR UPDATE
    ");
    $stmt->execute([$materialId]);
    return (float) $stmt->fetchColumn();
}

function hof_deduct_fifo(PDO $pdo, int $materialId, float $qty): void
{
    $batchSum = hof_check_batch_total($pdo, $materialId);
    if ($batchSum < $qty - 0.001) {
        throw new Exception("Insufficient batch stock for material ID {$materialId}: need {$qty}, have {$batchSum}");
    }

    $stmtBatches = $pdo->prepare("
        SELECT sii.stock_in_item_id, sii.quantity
        FROM stock_in_items sii
        JOIN stock_in si ON sii.stock_in_id = si.stock_in_id
        WHERE sii.raw_material_id = ?
          AND sii.is_deleted = 0
          AND sii.quantity > 0
          AND (si.status = 'Approved' OR si.status = 'Completed' OR si.status = 'Received')
        ORDER BY sii.expiration_date ASC, si.stock_in_date ASC, si.stock_in_id ASC
        FOR UPDATE
    ");
    $stmtDeduct = $pdo->prepare("
        UPDATE stock_in_items SET quantity = quantity - ? WHERE stock_in_item_id = ?
    ");

    $stmtBatches->execute([$materialId]);
    $batches = $stmtBatches->fetchAll(PDO::FETCH_ASSOC);

    $remaining = $qty;
    foreach ($batches as $batch) {
        if ($remaining <= 0) break;
        $batchId = $batch['stock_in_item_id'];
        $currentQty = (float) $batch['quantity'];
        $take = min($remaining, $currentQty);
        $stmtDeduct->execute([$take, $batchId]);
        $remaining -= $take;
    }
}