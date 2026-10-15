import express from "express";
import { pool } from "../database/pool";
import { RiderSessionRequest, requireRiderToken } from "../middleware/rider-session";
import { createRiderToken } from "../security/rider-session";

export const riderAuthRouter = express.Router();

function normalizeWorksheetCode(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, "").toUpperCase() : "";
}

async function getRider(riderId: number) {
  const result = await pool.query(
    `
      SELECT rider_id, name, phone, vehicle_plate, status, max_orders_per_route
      FROM riders
      WHERE rider_id = $1
    `,
    [riderId],
  );
  return result.rows[0] ?? null;
}

riderAuthRouter.post("/worksheet", async (req, res) => {
  const worksheetCode = normalizeWorksheetCode(req.body?.worksheetCode);

  if (!worksheetCode) {
    res.status(400).json({ message: "กรุณากรอกเลขใบงาน" });
    return;
  }

  try {
    const result = await pool.query(
      `
        SELECT
          route_plan.route_plan_id,
          rider.rider_id,
          rider.name,
          rider.phone,
          rider.vehicle_plate,
          rider.status AS rider_status,
          rider.max_orders_per_route
        FROM route_plans AS route_plan
        INNER JOIN route_stops AS route_stop
          ON route_stop.route_plan_id = route_plan.route_plan_id
        INNER JOIN riders AS rider ON rider.rider_id = route_stop.rider_id
        WHERE route_plan.worksheet_code = $1
          AND route_plan.route_date = CURRENT_DATE
          AND route_plan.status = 'SELECTED'
        GROUP BY
          route_plan.route_plan_id,
          rider.rider_id,
          rider.name,
          rider.phone,
          rider.vehicle_plate,
          rider.status,
          rider.max_orders_per_route
        HAVING COUNT(DISTINCT route_stop.rider_id) = 1
      `,
      [worksheetCode],
    );
    const worksheet = result.rows[0];

    if (!worksheet) {
      res.status(401).json({ message: "เลขใบงานไม่ถูกต้อง" });
      return;
    }

    if (worksheet.rider_status === "INACTIVE") {
      res.status(403).json({ message: "Rider คนนี้ถูกปิดการใช้งาน" });
      return;
    }

    res.status(200).json({
      rider: {
        rider_id: worksheet.rider_id,
        name: worksheet.name,
        phone: worksheet.phone,
        vehicle_plate: worksheet.vehicle_plate,
        status: worksheet.rider_status,
        max_orders_per_route: worksheet.max_orders_per_route,
      },
      token: createRiderToken(worksheet.rider_id, worksheet.route_plan_id),
      expiresInHours: 12,
    });
  } catch (error) {
    console.error("Rider worksheet login failed:", error);
    res.status(500).json({ message: "ไม่สามารถเข้าสู่ระบบด้วยเลขใบงานได้" });
  }
});

riderAuthRouter.get("/me", requireRiderToken, async (req: RiderSessionRequest, res) => {
  try {
    const rider = await getRider(req.riderId ?? 0);
    if (!rider) {
      res.status(404).json({ message: "ไม่พบข้อมูล Rider" });
      return;
    }
    res.status(200).json({ rider });
  } catch (error) {
    console.error("Loading current rider failed:", error);
    res.status(500).json({ message: "ไม่สามารถโหลดข้อมูล Rider ได้" });
  }
});
