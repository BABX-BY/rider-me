import express from "express";
import { pool } from "../database/pool.js";
import { BUSINESS_DATE_SQL } from "../database/business-date.js";

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

routePlanRouter.post("/generate", async (req, res) => {
  const client = await pool.connect();
  const regenerate = req.query.regenerate === "true";

  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM route_plans
       WHERE route_date = ${BUSINESS_DATE_SQL} AND status = 'SELECTED'`,
    );
    if (existing.rows[0].count > 0 && !regenerate) {
      await client.query("ROLLBACK");
      res.status(409).json({
        message: "วันนี้มีใบงานอยู่แล้ว หากต้องการคำนวณใหม่ให้กดคำนวณใหม่",
      });
      return;
    }

    if (existing.rows[0].count > 0 && regenerate) {
      const activeStops = await client.query(
        `SELECT COUNT(*)::int AS count
         FROM route_stops AS route_stop
         INNER JOIN route_plans AS route_plan
           ON route_plan.route_plan_id = route_stop.route_plan_id
         WHERE route_plan.route_date = ${BUSINESS_DATE_SQL}
           AND route_plan.status = 'SELECTED'
           AND route_stop.delivery_status <> 'PENDING'`,
      );
      if (activeStops.rows[0].count > 0) {
        await client.query("ROLLBACK");
        res.status(409).json({
          message: "คำนวณใหม่ไม่ได้ เพราะมีออเดอร์ที่ส่งแล้วหรือส่งไม่สำเร็จแล้ว",
        });
        return;
      }

      await client.query(
        `UPDATE orders
         SET status = 'PENDING'
         WHERE order_id IN (
           SELECT route_stop.order_id
           FROM route_stops AS route_stop
           INNER JOIN route_plans AS route_plan
             ON route_plan.route_plan_id = route_stop.route_plan_id
           WHERE route_plan.route_date = ${BUSINESS_DATE_SQL}
             AND route_plan.status = 'SELECTED'
         )`,
      );
      await client.query(
        `DELETE FROM route_stops
         WHERE route_plan_id IN (
           SELECT route_plan_id
           FROM route_plans
           WHERE route_date = ${BUSINESS_DATE_SQL} AND status = 'SELECTED'
         )`,
      );
      await client.query(
        `UPDATE route_plans
         SET status = 'REJECTED', calculated_at = CURRENT_TIMESTAMP
         WHERE route_date = ${BUSINESS_DATE_SQL} AND status = 'SELECTED'`,
      );
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
       WHERE status = 'AVAILABLE'
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
       WHERE order_row.order_date = ${BUSINESS_DATE_SQL}
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

    const buildNearestAssignments = (riderSequence: number[]) => {
      const result: Array<typeof orders> = riders.map(() => []);
      const unassigned = [...orders];
      for (const riderIndex of riderSequence) {
        const assignment = result[riderIndex]!;
        let previousLatitude = Number(store.latitude);
        let previousLongitude = Number(store.longitude);
        while (
          assignment.length < riders[riderIndex]!.max_orders_per_route &&
          unassigned.length > 0
        ) {
          let nearestIndex = 0;
          let nearestDistance = Number.POSITIVE_INFINITY;
          for (let orderIndex = 0; orderIndex < unassigned.length; orderIndex += 1) {
            const candidate = unassigned[orderIndex]!;
            const distance = distanceKm(
              previousLatitude,
              previousLongitude,
              Number(candidate.latitude),
              Number(candidate.longitude),
            );
            if (distance < nearestDistance) {
              nearestDistance = distance;
              nearestIndex = orderIndex;
            }
          }
          const [nearestOrder] = unassigned.splice(nearestIndex, 1);
          if (!nearestOrder) break;
          assignment.push(nearestOrder);
          previousLatitude = Number(nearestOrder.latitude);
          previousLongitude = Number(nearestOrder.longitude);
        }
      }
      return result;
    };

    const buildChunkAssignments = (sortedOrders: typeof orders, riderSequence: number[]) => {
      const result: Array<typeof orders> = riders.map(() => []);
      let orderIndex = 0;
      for (const riderIndex of riderSequence) {
        const capacityForRider = riders[riderIndex]!.max_orders_per_route;
        result[riderIndex] = sortedOrders.slice(orderIndex, orderIndex + capacityForRider);
        orderIndex += capacityForRider;
      }
      return result;
    };

    const routeDistance = (assignment: typeof orders): number => {
      let previousLatitude = Number(store.latitude);
      let previousLongitude = Number(store.longitude);
      let total = 0;
      for (const order of assignment) {
        const nextLatitude = Number(order.latitude);
        const nextLongitude = Number(order.longitude);
        total += distanceKm(previousLatitude, previousLongitude, nextLatitude, nextLongitude);
        previousLatitude = nextLatitude;
        previousLongitude = nextLongitude;
      }
      return total + distanceKm(
        previousLatitude,
        previousLongitude,
        Number(store.latitude),
        Number(store.longitude),
      );
    };

    const scoreAssignments = (candidate: Array<typeof orders>): number =>
      candidate.reduce((total, assignment) => total + routeDistance(assignment), 0);

    const baseRiderSequence = riders.map((_, index) => index);
    const candidates: Array<Array<typeof orders>> = [];
    for (let shift = 0; shift < riders.length; shift += 1) {
      candidates.push(buildNearestAssignments([
        ...baseRiderSequence.slice(shift),
        ...baseRiderSequence.slice(0, shift),
      ]));
    }

    const ordersByDistance = [...orders].sort((left, right) =>
      distanceKm(Number(store.latitude), Number(store.longitude), Number(left.latitude), Number(left.longitude)) -
      distanceKm(Number(store.latitude), Number(store.longitude), Number(right.latitude), Number(right.longitude)),
    );
    const ordersByLatitude = [...orders].sort((left, right) => Number(left.latitude) - Number(right.latitude));
    const ordersByLongitude = [...orders].sort((left, right) => Number(left.longitude) - Number(right.longitude));
    for (const sortedOrders of [ordersByDistance, ordersByLatitude, ordersByLongitude]) {
      for (let shift = 0; shift < riders.length; shift += 1) {
        candidates.push(buildChunkAssignments(sortedOrders, [
          ...baseRiderSequence.slice(shift),
          ...baseRiderSequence.slice(0, shift),
        ]));
      }
    }

    const assignments = candidates.reduce((best, candidate) =>
      scoreAssignments(candidate) < scoreAssignments(best) ? candidate : best,
    );

    const createdPlans = [];
    const stopRows: Array<[number, number, number, number, number, number]> = [];
    const routeDate = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const versionResult = await client.query(
      `SELECT COALESCE(MAX(version), 0)::int AS version
       FROM route_plans
       WHERE route_date = ${BUSINESS_DATE_SQL}`,
    );
    const routeVersion = versionResult.rows[0].version + 1;
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
      const worksheetCode = `W${routeDate}V${routeVersion}R${rider.rider_id}`;
      const planResult = await client.query(
        `INSERT INTO route_plans (
           store_id, route_date, version, status, total_distance,
           estimated_minutes, total_cost, total_revenue, total_profit, worksheet_code
         ) VALUES ($1, ${BUSINESS_DATE_SQL}, $2, 'SELECTED', $3, $4, $5, $6, $7, $8)
         RETURNING route_plan_id`,
        [
          store.store_id,
          routeVersion,
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
        stopRows.push([
          routePlanId,
          rider.rider_id,
          order.order_id,
          stopIndex + 1,
          Number(stopDistances[stopIndex]!.toFixed(2)),
          elapsedMinutes,
        ]);
      }
      createdPlans.push({ routePlanId, riderId: rider.rider_id, worksheetCode });
    }

    const stopValues = stopRows.flat();
    const stopPlaceholders = stopRows.map((_, index) => {
      const offset = index * 6;
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, CURRENT_TIMESTAMP + ($${offset + 6} * INTERVAL '1 minute'), 'PENDING')`;
    });
    await client.query(
      `INSERT INTO route_stops (
         route_plan_id, rider_id, order_id, stop_sequence,
         distance_from_previous, estimated_arrival, delivery_status
       ) VALUES ${stopPlaceholders.join(", ")}`,
      stopValues,
    );
    await client.query(
      `UPDATE orders SET status = 'ASSIGNED' WHERE order_id = ANY($1::int[])`,
      [orders.map((order) => order.order_id)],
    );

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

routePlanRouter.post("/cancel-today", async (_req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const selectedPlans = await client.query(
      `SELECT route_plan_id
       FROM route_plans
       WHERE route_date = ${BUSINESS_DATE_SQL} AND status = 'SELECTED'
       FOR UPDATE`,
    );

    if (selectedPlans.rowCount === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ message: "วันนี้ยังไม่มีใบงานที่กำลังใช้งาน" });
      return;
    }

    const planIds = selectedPlans.rows.map((row) => row.route_plan_id);
    const activeStops = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM route_stops
       WHERE route_plan_id = ANY($1::int[])
         AND delivery_status <> 'PENDING'`,
      [planIds],
    );

    if (activeStops.rows[0].count > 0) {
      await client.query("ROLLBACK");
      res.status(409).json({
        message: "ยกเลิกไม่ได้ เพราะมีจุดส่งที่ส่งแล้วหรือส่งไม่สำเร็จแล้ว",
      });
      return;
    }

    const orderResult = await client.query(
      `UPDATE orders
       SET status = 'PENDING'
       WHERE order_id IN (
         SELECT order_id
         FROM route_stops
         WHERE route_plan_id = ANY($1::int[])
       )
       RETURNING order_id`,
      [planIds],
    );

    await client.query(
      `DELETE FROM route_stops
       WHERE route_plan_id = ANY($1::int[])`,
      [planIds],
    );

    await client.query(
      `UPDATE route_plans
       SET status = 'REJECTED', calculated_at = CURRENT_TIMESTAMP
       WHERE route_plan_id = ANY($1::int[])`,
      [planIds],
    );

    await client.query("COMMIT");
    res.status(200).json({
      message: "ยกเลิกใบงานวันนี้สำเร็จ ออเดอร์กลับเป็นรอดำเนินการแล้ว",
      canceled_plan_count: planIds.length,
      reset_order_count: orderResult.rowCount ?? 0,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("ไม่สามารถยกเลิกใบงานวันนี้ได้:", error);
    res.status(500).json({ message: "ไม่สามารถยกเลิกใบงานวันนี้ได้" });
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

