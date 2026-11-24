-- Add unit price to receipt lines; drop supplier requirement from purchases.
-- Existing receipts keep their supplier_id/supplier_name unchanged.

ALTER TABLE receipt_lines
  ADD COLUMN unit_price numeric CHECK (unit_price IS NULL OR (unit_price >= 0 AND unit_price <= 999999999999.99 AND scale(unit_price) <= 2));

-- Relax the receipts CHECK so purchases no longer require a supplier.
ALTER TABLE receipts DROP CONSTRAINT IF EXISTS receipts_check;
ALTER TABLE receipts ADD CONSTRAINT receipts_check CHECK (
  (kind = 'purchase')
  OR (kind = 'opening' AND supplier_id IS NULL AND supplier_name IS NULL AND length(btrim(note)) >= 3)
);
