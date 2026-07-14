BEGIN;

-- Archive is no longer a Hardware catalogue workflow. Permanently remove
-- archived rows that have never participated in stock or audit history.
DELETE FROM public.inventory_hardware_items AS item
WHERE item.is_active = FALSE
  AND NOT EXISTS (
    SELECT 1
    FROM public.inventory_hardware_balances AS balance
    WHERE balance.hardware_item_id = item.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.inventory_hardware_transactions AS transaction
    WHERE transaction.hardware_item_id = item.id
  );

-- Immutable audit history remains protected by RESTRICT foreign keys. Any
-- previously archived item that cannot safely be deleted is restored so it is
-- not left permanently hidden after Archive/Restore controls are removed.
UPDATE public.inventory_hardware_items
SET
  is_active = TRUE,
  updated_at = NOW()
WHERE is_active = FALSE;

COMMIT;
