import express from "express";
import { pool } from "../database/pool.js";

export const routePlanRouter = express.Router();

const DELIVERY_SPEED_KM_HOUR = 30;
const BOX_PRICE = 65;
const BOX_COST = 40;
const RIDER_CALL_COST = 15;
const DISTANCE_COST_PER_BOX_KM = 2;

function distanceKm(
  fromLatitude: number,
  fromLongitude: number,
  toLatitude: number,
  toLongitude: number,
): number {
  const earthRadiusKm = 6371;
  const latitudeDelta = ((toLatitude - fromLatitude) * Math.PI) / 180;
  const longitudeDelta = ((toLongitude - fromLongitude) * Math.PI) / 180;
  const fromLatitudeRadians = (fromLatitude * Math.PI) / 180;
  const toLatitudeRadians = (toLatitude * Math.PI) / 180;
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitudeRadians) *
      Math.cos(toLatitudeRadians) *
      Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

routePlanRouter.post("/generate", async (_req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM route_plans
       WHERE route_date = CURRENT_DATE AND status = 'SELECTED'`,
    );
    if (existing.rows[0].count > 0) {
      await client.query("ROLLBACK");
      res.status(409).json({
        message: "วันนี้มีใบงานที่เลือกใช้งานแล้ว ไม่สร้างซ้ำ",
      });
      return;
    }

    const storeResult = await client.query(
      `SELECT store_id, latitude, longitude
       FROM stores
       WHERE is_active = TRUE
       ORDER BY store_id
       LIMIT 1`,
    );
    const store = storeResult.rows[0];
    if (!store) {
      await client.query("ROLLBACK");
      res.status(400).json({ message: "ไม่พบร้านค้าที่เปิดใช้งาน" });
      return;
    }

    const ridersResult = await client.query(
      `SELECT rider_id, max_orders_per_route
       FROM riders
       WHERE status <> 'INACTIVE'
       ORDER BY rider_id`,
    );
    const ordersResult = await client.query(
      `SELECT
         order_row.order_id,
         order_row.box_quantity,
         customer.latitude,
         customer.longitude
       FROM orders AS order_row
       INNER JOIN customers AS customer
         ON customer.customer_id = order_row.customer_id
       WHERE order_row.order_date = CURRENT_DATE
         AND order_row.status = 'PENDING'
       ORDER BY order_row.order_id`,
    );

    const riders = ridersResult.rows;
    const orders = ordersResult.rows;
    if (orders.length === 0) {
      await client.query("COMMIT");
      res.status(200).json({ message: "วันนี้ยังไม่มีออเดอร์ที่รอจัดส่ง", plans: [] });
      return;
    }
    const capacity = riders.reduce(
      (total: number, rider: { max_orders_per_route: number }) =>
        total + rider.max_orders_per_route,
      0,
    );
    if (riders.length === 0 || orders.length > capacity) {
      await client.query("ROLLBACK");
      res.status(409).json({
        message: "จำนวนออเดอร์เกินความจุของไรเดอร์ที่พร้อมรับงาน",
        orderCount: orders.length,
        capacity,
      });
      return;
    }

    const assignments: Array<typeof orders> = riders.map(() => []);
    let riderIndex = 0;
    for (const order of orders) {
      while (
        assignments[riderIndex]!.length >= riders[riderIndex]!.max_orders_per_route
      ) {
        riderIndex += 1;
      }
      assignments[riderIndex]!.push(order);
    }

    const createdPlans = [];
    const routeDate = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    for (let index = 0; index < assignments.length; index += 1) {
      const assignedOrders = assignments[index]!;
      if (assignedOrders.length === 0) continue;
      const rider = riders[index];
      let previousLatitude = Number(store.latitude);
      let previousLongitude = Number(store.longitude);
      let totalDistance = 0;
      let totalBoxes = 0;
      const stopDistances: number[] = [];

      for (const order of assignedOrders) {
        const nextLatitude = Number(order.latitude);
        const nextLongitude = Number(order.longitude);
        const distance = distanceKm(
          previousLatitude,
          previousLongitude,
          nextLatitude,
          nextLongitude,
        );
        stopDistances.push(distance);
        totalDistance += distance;
        totalBoxes += Number(order.box_quantity);
        previousLatitude = nextLatitude;
        previousLongitude = nextLongitude;
      }
      totalDistance += distanceKm(
        previousLatitude,
        previousLongitude,
        Number(store.latitude),
        Number(store.longitude),
      );

      const estimatedMinutes = Math.ceil((totalDistance / DELIVERY_SPEED_KM_HOUR) * 60);
      const totalRevenue = totalBoxes * BOX_PRICE;
      const totalCost =
        RIDER_CALL_COST + totalDistance * DISTANCE_COST_PER_BOX_KM * totalBoxes;
      const totalProfit = totalRevenue - totalBoxes * BOX_COST - totalCost;
      const worksheetCode = `W${routeDate}R${rider.rider_id}`;
      const planResult = await client.query(
        `INSERT INTO route_plans (
           store_id, route_date, version, status, total_distance,
           estimated_minutes, total_cost, total_revenue, total_profit, worksheet_code
         ) VALUES ($1, CURRENT_DATE, 1, 'SELECTED', $2, $3, $4, $5, $6, $7)
         RETURNING route_plan_id`,
        [
          store.store_id,
          Number(totalDistance.toFixed(2)),
          estimatedMinutes,
          Number(totalCost.toFixed(2)),
          Number(totalRevenue.toFixed(2)),
          Number(totalProfit.toFixed(2)),
          worksheetCode,
        ],
      );
      const routePlanId = planResult.rows[0].route_plan_id;
      let elapsedMinutes = 0;
      for (let stopIndex = 0; stopIndex < assignedOrders.length; stopIndex += 1) {
        const order = assignedOrders[stopIndex]!;
        elapsedMinutes += Math.max(
          1,
          Math.ceil((stopDistances[stopIndex]! / DELIVERY_SPEED_KM_HOUR) * 60),
        );
        await client.query(
          `INSERT INTO route_stops (
             route_plan_id, rider_id, order_id, stop_sequence,
             distance_from_previous, estimated_arrival, delivery_status
           ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP + ($6 * INTERVAL '1 minute'), 'PENDING')`,
          [
            routePlanId,
            rider.rider_id,
            order.order_id,
            stopIndex + 1,
            Number(stopDistances[stopIndex]!.toFixed(2)),
            elapsedMinutes,
          ],
        );
        await client.query(
          `UPDATE orders SET status = 'ASSIGNED' WHERE order_id = $1`,
          [order.order_id],
        );
      }
      createdPlans.push({ routePlanId, riderId: rider.rider_id, worksheetCode });
    }

    await client.query("COMMIT");
    res.status(201).json({ message: "สร้างใบงานของวันนี้สำเร็จ", plans: createdPlans });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("ไม่สามารถสร้างใบงานของวันนี้ได้:", error);
    res.status(500).json({ message: "ไม่สามารถสร้างใบงานของวันนี้ได้" });
  } finally {
    client.release();
  }
});

routePlanRouter.get("/", async (req, res) => {
  const routeDate = typeof req.query.date === "string" ? req.query.date : "";
  const status = typeof req.query.status === "string" ? req.query.status : "";

  try {
    const result = await pool.query(
      `
        SELECT
          route_plan.route_plan_id,
          route_plan.store_id,
          route_plan.route_date,
          route_plan.version,
          route_plan.status,
          route_plan.total_distance,
          route_plan.estimated_minutes,
          route_plan.total_cost,
          route_plan.total_revenue,
          route_plan.total_profit,
          route_plan.calculated_at,
          route_plan.worksheet_code,
          store.store_name,
          store.phone AS store_phone,
          store.address AS store_address,
          store.latitude AS store_latitude,
          store.longitude AS store_longitude
        FROM route_plans AS route_plan
        INNER JOIN stores AS store ON store.store_id = route_plan.store_id
        WHERE ($1 = '' OR route_plan.route_date = $1::date)
          AND ($2 = '' OR route_plan.status = $2)
        ORDER BY route_plan.route_date DESC, route_plan.route_plan_id
      `,
      [routeDate, status],
    );

    res.status(200).json(result.rows);
  } catch (error) {
    console.error("ไม่สามารถแสดงรายการแผนเส้นทางได้:", error);
    res.status(500).json({ message: "ไม่สามารถแสดงรายการแผนเส้นทางได้" });
  }
});

routePlanRouter.get("/:id", async (req, res) => {
  const routePlanId = Number(req.params.id);

  if (!Number.isInteger(routePlanId) || routePlanId <= 0) {
    res.status(400).json({ message: "route_plan_id ต้องเป็นจำนวนเต็มบวก" });
    return;
  }

  try {
    const result = await pool.query(
      `
        SELECT
          route_plan.route_plan_id,
          route_plan.store_id,
          route_plan.route_date,
          route_plan.version,
          route_plan.status,
          route_plan.total_distance,
          route_plan.estimated_minutes,
          route_plan.total_cost,
          route_plan.total_revenue,
          route_plan.total_profit,
          route_plan.calculated_at,
          route_plan.worksheet_code,
          store.store_name,
          store.phone AS store_phone,
          store.address AS store_address,
          store.latitude AS store_latitude,
          store.longitude AS store_longitude
        FROM route_plans AS route_plan
        INNER JOIN stores AS store ON store.store_id = route_plan.store_id
        WHERE route_plan.route_plan_id = $1
      `,
      [routePlanId],
    );

    if (result.rowCount === 0) {
      res.status(404).json({ message: "ไม่พบแผนเส้นทางที่ระบุ" });
      return;
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("ไม่สามารถแสดงแผนเส้นทางได้:", error);
    res.status(500).json({ message: "ไม่สามารถแสดงแผนเส้นทางได้" });
  }
});

