import express from "express";
import { pool } from "../database/pool";
import { RiderSessionRequest, requireRiderToken } from "../middleware/rider-session";

export const riderRouter = express.Router();

riderRouter.get("/", async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        rider_id,
        name,
        phone,
        vehicle_plate,
        status,
        max_orders_per_route
      FROM riders
      ORDER BY rider_id
    `);

    res.status(200).json(result.rows);
  } catch (error) {
    console.error("ไม่สามารถแสดงข้อมูลไรเดอร์ได้:", error);
    res.status(500).json({ message: "ไม่สามารถแสดงข้อมูลไรเดอร์ได้" });
  }
});

riderRouter.get("/work", requireRiderToken, async (req: RiderSessionRequest, res) => {
  try {
    const result = await pool.query(
      `
        SELECT
          route_plan.route_date::text AS work_date,
          store.store_name,
          store.address AS store_address,
          store.latitude AS store_latitude,
          store.longitude AS store_longitude,
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
          AND route_plan.route_date = CURRENT_DATE
          AND route_plan.status = 'SELECTED'
        ORDER BY route_stop.stop_sequence
      `,
      [req.riderId],
    );

    const rows = result.rows;
    const firstRow = rows[0];
    const stops = rows.map((row) => ({
      sequence: row.stop_sequence,
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
