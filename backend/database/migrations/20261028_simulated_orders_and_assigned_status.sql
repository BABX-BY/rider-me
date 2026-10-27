-- Add provenance for simulated orders without reclassifying existing customer orders.
-- Existing rows remain non-simulated because their origin cannot be determined reliably.
BEGIN;

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS is_simulated BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_orders_simulated_date
    ON orders (order_date, is_simulated)
    WHERE is_simulated = TRUE;

-- Bring existing selected sample worksheets in line with runtime plan confirmation.
UPDATE orders AS order_row
SET status = 'ASSIGNED'
WHERE order_row.status = 'PENDING'
  AND EXISTS (
      SELECT 1
      FROM route_stops AS route_stop
      INNER JOIN route_plans AS route_plan
          ON route_plan.route_plan_id = route_stop.route_plan_id
      WHERE route_stop.order_id = order_row.order_id
        AND route_plan.status = 'SELECTED'
        AND route_stop.delivery_status = 'PENDING'
  );

COMMIT;
