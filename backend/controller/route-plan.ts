import express from "express";
import { pool } from "../database/pool.js";

export const routePlanRouter = express.Router();

routePlanRouter.get("/", async (req, res) => {
  const routeDate = typeof req.query.date === "string" ? req.query.date : "";
  const status = typeof req.query.status === "string" ? req.query.status : "";

  try {
    const result = await pool.query(
      `
        SELECT
          route_plan_id,
          store_id,
          route_date,
          version,
          status,
          total_distance,
          estimated_minutes,
          total_cost,
          total_revenue,
          total_profit,
          calculated_at,
          worksheet_code
        FROM route_plans
        WHERE ($1 = '' OR route_date = $1::date)
          AND ($2 = '' OR status = $2)
        ORDER BY route_date DESC, route_plan_id
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
          route_plan_id,
          store_id,
          route_date,
          version,
          status,
          total_distance,
          estimated_minutes,
          total_cost,
          total_revenue,
          total_profit,
          calculated_at,
          worksheet_code
        FROM route_plans
        WHERE route_plan_id = $1
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

