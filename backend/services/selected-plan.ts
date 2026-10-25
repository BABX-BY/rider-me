import type { Pool } from "pg";
import { BUSINESS_DATE_SQL } from "../database/business-date.js";

export interface PlanningStore {
  store_id: number;
  store_name: string;
  latitude: number | string;
  longitude: number | string;
}

export interface OrderSnapshot {
  orderId: number;
  customerId: number;
  boxQuantity: number;
  latitude: number;
  longitude: number;
}

export interface SelectedPlan {
  routeDate: string;
  storeId: number;
  storeLatitude: number;
  storeLongitude: number;
  orders: OrderSnapshot[];
  trips: { riderId: number; orderIds: number[] }[];
}

export class PlanError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function invalid(message: string): never {
  throw new PlanError(400, message);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("ข้อมูลแผนไม่ถูกต้อง");
  return value as Record<string, unknown>;
}

function positiveId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    invalid("รหัสร้าน ไรเดอร์ และออเดอร์ต้องเป็นจำนวนเต็มบวก");
  }
  return value;
}

function coordinate(value: unknown, limit: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > limit) {
    invalid("พิกัดในแผนไม่ถูกต้อง");
  }
  return value;
}

export function parseSelectedPlan(body: unknown): SelectedPlan {
  const data = record(body);
  if (typeof data.routeDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data.routeDate) ||
      !Number.isFinite(new Date(data.routeDate + "T00:00:00Z").getTime()) ||
      new Date(data.routeDate + "T00:00:00Z").toISOString().slice(0, 10) !== data.routeDate) {
    invalid("วันที่แผนไม่ถูกต้อง");
  }
  if (!Array.isArray(data.trips) || data.trips.length === 0 || data.trips.length > 1000 ||
      !Array.isArray(data.orders) || data.orders.length === 0 || data.orders.length > 3000) {
    invalid("กรุณาเลือกแผนที่มีออเดอร์ก่อนยืนยัน");
  }
  const orders = data.orders.map((value): OrderSnapshot => {
    const order = record(value);
    if (typeof order.boxQuantity !== "number" || !Number.isInteger(order.boxQuantity) ||
        order.boxQuantity < 1 || order.boxQuantity > 3) invalid("จำนวนกล่องต้องอยู่ระหว่าง 1–3");
    return {
      orderId: positiveId(order.orderId), customerId: positiveId(order.customerId),
      boxQuantity: order.boxQuantity,
      latitude: coordinate(order.latitude, 90), longitude: coordinate(order.longitude, 180),
    };
  });
  const trips = data.trips.map((value) => {
    const trip = record(value);
    if (!Array.isArray(trip.orderIds) || trip.orderIds.length < 1 || trip.orderIds.length > 3) {
      invalid("ไรเดอร์รับได้ไม่เกินคนละ 3 ออเดอร์");
    }
    return { riderId: positiveId(trip.riderId), orderIds: trip.orderIds.map(positiveId) };
  });
  const ids = trips.flatMap((trip) => trip.orderIds);
  if (new Set(trips.map((trip) => trip.riderId)).size !== trips.length) {
    invalid("หนึ่งไรเดอร์ต้องมีใบงานเดียวและรับไม่เกิน 3 ออเดอร์");
  }
  if (new Set(ids).size !== ids.length || new Set(orders.map((order) => order.orderId)).size !== orders.length ||
      ids.length !== orders.length || orders.some((order) => !ids.includes(order.orderId))) {
    invalid("มีออเดอร์ซ้ำหรือรายการออเดอร์ไม่ตรงกับแผนที่เลือก");
  }
  return {
    routeDate: data.routeDate, storeId: positiveId(data.storeId),
    storeLatitude: coordinate(data.storeLatitude, 90), storeLongitude: coordinate(data.storeLongitude, 180),
    orders, trips,
  };
}

// คำนวณซ้ำเฉพาะลำดับที่ผู้ใช้เลือก ไม่จัดกลุ่มหรือสลับลำดับใหม่
export function selectedTripMetrics(store: { latitude: number; longitude: number }, orders: readonly OrderSnapshot[]) {
  const distance = (from: typeof store, to: typeof store) => {
    const rad = (degrees: number) => degrees * Math.PI / 180;
    const a = Math.sin(rad(to.latitude - from.latitude) / 2) ** 2 +
      Math.cos(rad(from.latitude)) * Math.cos(rad(to.latitude)) *
      Math.sin(rad(to.longitude - from.longitude) / 2) ** 2;
    const limited = Math.min(1, Math.max(0, a));
    return 6371 * 2 * Math.atan2(Math.sqrt(limited), Math.sqrt(1 - limited));
  };
  let previous = store;
  let cumulative = 0;
  const stops = orders.map((order, index) => {
    const distanceKm = distance(previous, order);
    cumulative += distanceKm;
    previous = order;
    const arrivalMinute = 690 + cumulative / 30 * 60;
    return { orderId: order.orderId, sequence: index + 1, distanceKm, arrivalMinute, isLate: arrivalMinute > 750 };
  });
  const totalDistanceKm = cumulative + (orders.length ? distance(previous, store) : 0);
  const boxes = orders.reduce((sum, order) => sum + order.boxQuantity, 0);
  const revenue = boxes * 65;
  const penalty = stops.filter((stop) => stop.isLate).length * 20;
  const totalCost = Number((boxes * 40 + 15 + totalDistanceKm * boxes * 2 + penalty).toFixed(2));
  return { stops, totalDistanceKm, elapsedMinutes: totalDistanceKm / 30 * 60,
    revenue, totalCost, profit: Number((revenue - totalCost).toFixed(2)), penalty };
}

export async function confirmSelectedPlan(pool: Pick<Pool, "connect">, body: unknown) {
  const plan = parseSelectedPlan(body);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const day = await client.query(`SELECT ${BUSINESS_DATE_SQL}::text AS business_date`);
    const today: string = day.rows[0].business_date;
    if (plan.routeDate !== today) throw new PlanError(400, "บันทึกใบงานได้เฉพาะวันที่ปัจจุบันของร้าน ส่วนวันอื่นใช้ทดลองคำนวณได้");
    // ล็อกการยืนยัน/ยกเลิกของวันเดียวกัน กันใบงานซ้ำจากหลายหน้าจอ
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["rider-plan:" + today]);
    const existing = await client.query(
      `SELECT route_plan_id FROM route_plans WHERE route_date = $1 AND status IN ('SELECTED', 'COMPLETED')`, [today],
    );
    if (existing.rowCount) throw new PlanError(409, "วันนี้มีใบงานที่ยืนยันแล้ว กรุณาตรวจแท็บใบงาน หากยังไม่เริ่มส่งให้ยกเลิกใบงานก่อนคำนวณใหม่");

    const stores = await client.query(
      `SELECT store_id, store_name, latitude, longitude FROM stores WHERE is_active = TRUE ORDER BY store_id LIMIT 1 FOR SHARE`,
    );
    const store = stores.rows[0];
    if (!store || store.store_id !== plan.storeId || Number(store.latitude) !== plan.storeLatitude ||
        Number(store.longitude) !== plan.storeLongitude) {
      throw new PlanError(409, "ข้อมูลร้านเปลี่ยนแล้ว กรุณาโหลดข้อมูลและคำนวณใหม่");
    }
    const ids = plan.orders.map((order) => order.orderId);
    const orders = await client.query(
      `SELECT o.order_id, o.customer_id, o.box_quantity, o.status, o.order_date::text AS order_date,
              c.latitude, c.longitude
       FROM orders AS o INNER JOIN customers AS c ON c.customer_id = o.customer_id
       WHERE o.order_id = ANY($1::int[]) ORDER BY o.order_id FOR UPDATE OF o, c`, [ids],
    );
    if (orders.rowCount !== ids.length) throw new PlanError(409, "มีออเดอร์ถูกลบแล้ว กรุณาคำนวณใหม่");
    const snapshots = new Map(plan.orders.map((order) => [order.orderId, order]));
    const actualOrders = new Map<number, OrderSnapshot>();
    for (const order of orders.rows) {
      const snapshot = snapshots.get(order.order_id)!;
      if (order.status !== "PENDING" || order.order_date !== today || order.customer_id !== snapshot.customerId ||
          Number(order.box_quantity) !== snapshot.boxQuantity || order.latitude === null || order.longitude === null ||
          Number(order.latitude) !== snapshot.latitude || Number(order.longitude) !== snapshot.longitude) {
        throw new PlanError(409, "ออเดอร์หรือพิกัดเปลี่ยนแล้ว กรุณาโหลดข้อมูลและคำนวณใหม่");
      }
      // ตรวจรัศมีจากร้านจริง ห้ามใช้พิกัดที่ Client ส่งมาแทนข้อมูลฐานข้อมูล
      const check = selectedTripMetrics({ latitude: Number(store.latitude), longitude: Number(store.longitude) }, [snapshot]);
      if (check.totalDistanceKm / 2 > 3) throw new PlanError(400, "มีจุดส่งอยู่นอกรัศมี 3 กม.");
      actualOrders.set(order.order_id, snapshot);
    }
    const duplicate = await client.query(
      `SELECT s.order_id FROM route_stops AS s INNER JOIN route_plans AS p ON p.route_plan_id = s.route_plan_id
       WHERE s.order_id = ANY($1::int[]) AND p.status IN ('SELECTED', 'COMPLETED')`, [ids],
    );
    if (duplicate.rowCount) throw new PlanError(409, "มีออเดอร์อยู่ในใบงานอื่นแล้ว กรุณาคำนวณใหม่");
    const riders = await client.query(
      `SELECT rider_id, status, max_orders_per_route FROM riders WHERE rider_id = ANY($1::int[]) ORDER BY rider_id FOR UPDATE`,
      [plan.trips.map((trip) => trip.riderId)],
    );
    const riderById = new Map(riders.rows.map((rider) => [rider.rider_id, rider]));
    const checked = plan.trips.map((trip) => {
      const rider = riderById.get(trip.riderId);
      if (!rider || rider.status !== "AVAILABLE" || !Number.isInteger(rider.max_orders_per_route) ||
          trip.orderIds.length > Math.min(3, rider.max_orders_per_route)) {
        throw new PlanError(409, "สถานะหรือจำนวนงานที่ไรเดอร์รับได้เปลี่ยนแล้ว กรุณาคำนวณใหม่");
      }
      const ordered = trip.orderIds.map((id) => actualOrders.get(id)!);
      if (ordered.reduce((sum, order) => sum + order.boxQuantity, 0) > 10) invalid("จำนวนกล่องเกินความจุ 10 กล่อง");
      return { trip, metrics: selectedTripMetrics({ latitude: Number(store.latitude), longitude: Number(store.longitude) }, ordered) };
    });
    const versions = await client.query(`SELECT COALESCE(MAX(version), 0)::int AS version FROM route_plans WHERE route_date = $1`, [today]);
    const version = versions.rows[0].version + 1;
    const created = [];
    for (const { trip, metrics } of checked) {
      const worksheetCode = `W${today.replaceAll("-", "")}V${version}R${trip.riderId}`;
      const result = await client.query(
        `INSERT INTO route_plans (store_id, route_date, version, status, total_distance, estimated_minutes,
          total_cost, total_revenue, total_profit, worksheet_code)
         VALUES ($1, $2, $3, 'SELECTED', $4, $5, $6, $7, $8, $9) RETURNING route_plan_id`,
        [store.store_id, today, version, metrics.totalDistanceKm.toFixed(2), Math.ceil(metrics.elapsedMinutes),
          metrics.totalCost.toFixed(2), metrics.revenue.toFixed(2), metrics.profit.toFixed(2), worksheetCode],
      );
      const routePlanId = result.rows[0].route_plan_id;
      for (const stop of metrics.stops) {
        await client.query(
          `INSERT INTO route_stops (route_plan_id, rider_id, order_id, stop_sequence, distance_from_previous,
            estimated_arrival, delivery_status)
           VALUES ($1, $2, $3, $4, $5, ($6::date::timestamp AT TIME ZONE 'Asia/Bangkok') + ($7 * INTERVAL '1 minute'), 'PENDING')`,
          [routePlanId, trip.riderId, stop.orderId, stop.sequence, stop.distanceKm.toFixed(2), today, stop.arrivalMinute],
        );
      }
      created.push({ routePlanId, riderId: trip.riderId, worksheetCode });
    }
    await client.query(`UPDATE orders SET status = 'ASSIGNED' WHERE order_id = ANY($1::int[])`, [ids]);
    await client.query("COMMIT");
    return { message: "บันทึกแผนที่เลือกและสร้างใบงานสำเร็จ", plans: created };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
