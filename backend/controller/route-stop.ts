import express from "express";
import { pool } from "../database/pool.js";
import { RiderSessionRequest, requireWorksheet } from "../middleware/rider-session.js";

export const routeStopRouter = express.Router();

const allowedStatuses = new Set(["PENDING", "DELIVERED", "FAILED"]);

routeStopRouter.get("/", async (req, res) => {
  const routePlanId = Number(req.query.route_plan_id);

  if (!Number.isInteger(routePlanId) || routePlanId <= 0) {
    res.status(400).json({
      message: "กรุณาระบุ route_plan_id เป็นจำนวนเต็มบวก",
    });
    return;
  }

  try {
    const result = await pool.query(
      `
        SELECT
          route_stop.route_stop_id,
          route_stop.route_plan_id,
          route_stop.rider_id,
          rider.name AS rider_name,
          rider.vehicle_plate,
          route_stop.order_id,
          route_stop.stop_sequence,
          route_stop.distance_from_previous,
          route_stop.estimated_arrival,
          route_stop.delivery_status,
          route_stop.delivered_at,
          CONCAT_WS(' ', customer.first_name, customer.last_name) AS customer_name,
          customer.phone AS customer_phone,
          customer.address AS customer_address,
          customer.latitude AS customer_latitude,
          customer.longitude AS customer_longitude,
          order_row.box_quantity,
          order_row.order_date,
          order_row.status AS order_status
        FROM route_stops AS route_stop
        INNER JOIN orders AS order_row
          ON order_row.order_id = route_stop.order_id
        INNER JOIN riders AS rider
          ON rider.rider_id = route_stop.rider_id
        INNER JOIN customers AS customer
          ON customer.customer_id = order_row.customer_id
        WHERE route_stop.route_plan_id = $1
        ORDER BY route_stop.stop_sequence
      `,
      [routePlanId],
    );

    res.status(200).json(result.rows);
  } catch (error) {
    console.error("ไม่สามารถแสดงจุดส่งได้:", error);
    res.status(500).json({ message: "ไม่สามารถแสดงจุดส่งได้" });
  }
});

routeStopRouter.get("/:id", async (req, res) => {
  const routeStopId = Number(req.params.id);

  if (!Number.isInteger(routeStopId) || routeStopId <= 0) {
    res.status(400).json({ message: "route_stop_id ต้องเป็นจำนวนเต็มบวก" });
    return;
  }

  try {
    const result = await pool.query(
      `
        SELECT
          route_stop.route_stop_id,
          route_stop.route_plan_id,
          route_stop.rider_id,
          rider.name AS rider_name,
          rider.vehicle_plate,
          route_stop.order_id,
          route_stop.stop_sequence,
          route_stop.distance_from_previous,
          route_stop.estimated_arrival,
          route_stop.delivery_status,
          route_stop.delivered_at,
          CONCAT_WS(' ', customer.first_name, customer.last_name) AS customer_name,
          customer.phone AS customer_phone,
          customer.address AS customer_address,
          customer.latitude AS customer_latitude,
          customer.longitude AS customer_longitude,
          order_row.box_quantity,
          order_row.order_date,
          order_row.status AS order_status
        FROM route_stops AS route_stop
        INNER JOIN orders AS order_row
          ON order_row.order_id = route_stop.order_id
        INNER JOIN riders AS rider
          ON rider.rider_id = route_stop.rider_id
        INNER JOIN customers AS customer
          ON customer.customer_id = order_row.customer_id
        WHERE route_stop.route_stop_id = $1
      `,
      [routeStopId],
    );

    if (result.rowCount === 0) {
      res.status(404).json({ message: "ไม่พบจุดส่งที่ระบุ" });
      return;
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("ไม่สามารถแสดงจุดส่งได้:", error);
    res.status(500).json({ message: "ไม่สามารถแสดงจุดส่งได้" });
  }
});

routeStopRouter.patch("/:id/status", requireWorksheet, async (req: RiderSessionRequest, res) => {
  const routeStopId = Number(req.params.id);
  const deliveryStatus = typeof req.body?.deliveryStatus === "string"
    ? req.body.deliveryStatus.trim().toUpperCase()
    : "";

  if (!Number.isInteger(routeStopId) || routeStopId <= 0) {
    res.status(400).json({ message: "route_stop_id ต้องเป็นจำนวนเต็มบวก" });
    return;
  }

  if (!allowedStatuses.has(deliveryStatus)) {
    res.status(400).json({ message: "สถานะการจัดส่งไม่ถูกต้อง" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const stopResult = await client.query(
      `SELECT route_stop_id, order_id
       FROM route_stops
       WHERE route_stop_id = $1
         AND rider_id = $2
         AND route_plan_id = $3
       FOR UPDATE`,
      [routeStopId, req.riderId, req.routePlanId],
    );

    if (stopResult.rowCount === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ message: "ไม่พบจุดส่งในใบงานนี้" });
      return;
    }

    const orderId = stopResult.rows[0].order_id;
    const deliveredAt = deliveryStatus === "DELIVERED" ? "CURRENT_TIMESTAMP" : "NULL";
    await client.query(
      `UPDATE route_stops
       SET delivery_status = $1,
           delivered_at = ${deliveredAt}
       WHERE route_stop_id = $2`,
      [deliveryStatus, routeStopId],
    );

    await client.query(
      `UPDATE orders
       SET status = $1
       WHERE order_id = $2`,
      [deliveryStatus === "DELIVERED" ? "DELIVERED" : "ASSIGNED", orderId],
    );

    await client.query("COMMIT");
    res.status(200).json({ routeStopId, deliveryStatus });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("ไม่สามารถอัปเดตสถานะจุดส่งได้:", error);
    res.status(500).json({ message: "ไม่สามารถอัปเดตสถานะจุดส่งได้" });
  } finally {
    client.release();
  }
});

