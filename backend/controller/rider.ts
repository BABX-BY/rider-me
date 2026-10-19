import express from "express";
import { pool } from "../database/pool.js";
import { RiderSessionRequest, requireWorksheet } from "../middleware/rider-session.js";

export const riderRouter = express.Router();

riderRouter.get("/", async (req, res) => {
  const name = typeof req.query.name === "string" ? req.query.name.trim() : "";

  try {
    const result = await pool.query(
      `
        WITH today_stops AS (
          SELECT
            route_stop.rider_id,
            route_plan.worksheet_code,
            route_stop.delivery_status
            ,order_row.box_quantity
          FROM route_stops AS route_stop
          INNER JOIN route_plans AS route_plan
            ON route_plan.route_plan_id = route_stop.route_plan_id
          INNER JOIN orders AS order_row
            ON order_row.order_id = route_stop.order_id
          WHERE route_plan.route_date = CURRENT_DATE
            AND route_plan.status = 'SELECTED'
        )
        SELECT
          rider.rider_id,
          rider.name,
          rider.vehicle_plate,
          rider.status,
          rider.max_orders_per_route,
          MAX(today_stops.worksheet_code) AS worksheet_code,
          COUNT(today_stops.rider_id)::int AS order_count,
          COUNT(today_stops.rider_id) FILTER (WHERE today_stops.delivery_status = 'DELIVERED')::int AS delivered_order_count,
          COUNT(today_stops.rider_id) FILTER (WHERE today_stops.delivery_status = 'PENDING')::int AS pending_order_count,
          COUNT(today_stops.rider_id) FILTER (WHERE today_stops.delivery_status = 'FAILED')::int AS failed_order_count,
          COALESCE(SUM(today_stops.box_quantity), 0)::int AS total_box_count,
          COALESCE(SUM(today_stops.box_quantity) FILTER (WHERE today_stops.delivery_status = 'DELIVERED'), 0)::int AS delivered_box_count,
          COALESCE(SUM(today_stops.box_quantity) FILTER (WHERE today_stops.delivery_status = 'PENDING'), 0)::int AS pending_box_count,
          COALESCE(SUM(today_stops.box_quantity) FILTER (WHERE today_stops.delivery_status = 'FAILED'), 0)::int AS failed_box_count
        FROM riders AS rider
        LEFT JOIN today_stops
          ON today_stops.rider_id = rider.rider_id
        WHERE ($1 = '' OR rider.name ILIKE $2)
        GROUP BY rider.rider_id, rider.name, rider.vehicle_plate, rider.status, rider.max_orders_per_route
        ORDER BY rider.rider_id
      `,
      [name, `%${name}%`],
    );

    res.status(200).json(result.rows);
  } catch (error) {
    console.error("ไม่สามารถแสดงข้อมูลไรเดอร์ได้:", error);
    res.status(500).json({ message: "ไม่สามารถแสดงข้อมูลไรเดอร์ได้" });
  }
});

riderRouter.get("/work", requireWorksheet, async (req: RiderSessionRequest, res) => {
  try {
    const result = await pool.query(
      `
        SELECT
          route_plan.route_date::text AS work_date,
          store.store_name,
          store.phone AS store_phone,
          store.address AS store_address,
          store.latitude AS store_latitude,
          store.longitude AS store_longitude,
          route_stop.order_id,
          route_stop.stop_sequence,
          CONCAT_WS(' ', customer.first_name, customer.last_name) AS customer_name,
          customer.address AS customer_address,
          customer.latitude AS customer_latitude,
          customer.longitude AS customer_longitude,
          order_row.box_quantity,
          route_stop.delivery_status
        FROM route_stops AS route_stop
        INNER JOIN route_plans AS route_plan
          ON route_plan.route_plan_id = route_stop.route_plan_id
        INNER JOIN stores AS store
          ON store.store_id = route_plan.store_id
        INNER JOIN orders AS order_row
          ON order_row.order_id = route_stop.order_id
        INNER JOIN customers AS customer
          ON customer.customer_id = order_row.customer_id
        WHERE route_stop.rider_id = $1
          AND route_plan.route_plan_id = $2
          AND route_plan.route_date = CURRENT_DATE
          AND route_plan.status = 'SELECTED'
        ORDER BY route_stop.stop_sequence
      `,
      [req.riderId, req.routePlanId],
    );

    const rows = result.rows;
    const firstRow = rows[0];
    const stops = rows.map((row) => ({
      sequence: row.stop_sequence,
      orderId: row.order_id,
      customerName: row.customer_name ?? "",
      address: row.customer_address ?? "",
      boxes: Number(row.box_quantity ?? 0),
      latitude: row.customer_latitude === null ? null : Number(row.customer_latitude),
      longitude: row.customer_longitude === null ? null : Number(row.customer_longitude),
      status: row.delivery_status,
    }));

    res.status(200).json({
      work: {
        workDate: firstRow?.work_date ?? "",
        totalBoxes: stops.reduce((total, stop) => total + stop.boxes, 0),
        totalStops: stops.length,
        deliveredStops: stops.filter((stop) => stop.status === "DELIVERED").length,
        pendingStops: stops.filter((stop) => stop.status !== "DELIVERED").length,
        storeName: firstRow?.store_name ?? "",
        storePhone: firstRow?.store_phone ?? "",
        storeAddress: firstRow?.store_address ?? "",
        storeLatitude: firstRow?.store_latitude === null || firstRow?.store_latitude === undefined
          ? null
          : Number(firstRow.store_latitude),
        storeLongitude: firstRow?.store_longitude === null || firstRow?.store_longitude === undefined
          ? null
          : Number(firstRow.store_longitude),
        stops,
      },
    });
  } catch (error) {
    console.error("ไม่สามารถโหลดใบงาน Rider ได้:", error);
    res.status(500).json({ message: "ไม่สามารถโหลดใบงาน Rider ได้" });
  }
});
