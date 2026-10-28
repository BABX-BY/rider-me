import express from "express";
import { pool } from "../database/pool.js";
import { BUSINESS_DATE_SQL } from "../database/business-date.js";
import { confirmSelectedPlan, PlanError } from "../services/selected-plan.js";
import { getRoadDistanceMatrix, parseRoadPoints, RoadMatrixError } from "../services/road-matrix.js";

export const routePlanRouter = express.Router();

routePlanRouter.post("/road-matrix", async (req, res) => {
  try {
    const points = parseRoadPoints(req.body?.points);
    res.json(await getRoadDistanceMatrix(points));
  } catch (error) {
    if (error instanceof RoadMatrixError) {
      res.status(error.status).json({ message: error.message });
      return;
    }
    res.status(503).json({ message: "โหลดระยะทางถนนไม่สำเร็จ กรุณาลองใหม่" });
  }
});

// ใช้ร้านเดียวกับที่จะบันทึกจริง แทนพิกัดตัวอย่างใน Frontend
routePlanRouter.get("/planning-store", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT store_id, store_name, latitude, longitude,
              ${BUSINESS_DATE_SQL}::text AS business_date
       FROM stores WHERE is_active = TRUE ORDER BY store_id LIMIT 1`,
    );
    if (!result.rows[0]) {
      res.status(400).json({ message: "ไม่พบร้านค้าที่เปิดใช้งาน" });
      return;
    }
    const { business_date, ...store } = result.rows[0];
    res.json({ businessDate: business_date, store });
  } catch (error) {
    console.error("โหลดร้านสำหรับวางแผนไม่สำเร็จ:", error);
    res.status(500).json({ message: "โหลดร้านสำหรับวางแผนไม่สำเร็จ" });
  }
});

// /generate ยังคงรับ URL เดิม แต่ต้องส่งแผนที่เลือก จึงไม่คำนวณทับแผนบนหน้าเว็บ
routePlanRouter.post(["/confirm", "/generate"], async (req, res) => {
  try {
    const result = await confirmSelectedPlan(pool, req.body);
    res.status(201).json(result);
  } catch (error) {
    if (error instanceof PlanError || error instanceof RoadMatrixError) {
      res.status(error.status).json({ message: error.message });
      return;
    }
    console.error("บันทึกแผนที่เลือกไม่สำเร็จ:", error);
    res.status(500).json({ message: "บันทึกแผนไม่สำเร็จ กรุณาตรวจใบงานก่อนลองอีกครั้ง" });
  }
});

routePlanRouter.post("/cancel-today", async (_req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const day = await client.query(`SELECT ${BUSINESS_DATE_SQL}::text AS business_date`);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["rider-plan:" + day.rows[0].business_date]);

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
    // ล็อกจุดส่งก่อนตรวจสถานะ เพื่อไม่ยกเลิกชนกับการยืนยันส่งของไรเดอร์
    await client.query(`SELECT route_stop_id FROM route_stops WHERE route_plan_id = ANY($1::int[]) ORDER BY route_stop_id FOR UPDATE`, [planIds]);
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

