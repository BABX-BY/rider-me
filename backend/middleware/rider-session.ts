import { NextFunction, Request, Response } from "express";
import { pool } from "../database/pool.js";
import { BUSINESS_DATE_SQL } from "../database/business-date.js";

export interface RiderSessionRider {
  rider_id: number;
  name: string;
  phone: string;
  vehicle_plate: string;
  status: string;
  max_orders_per_route: number;
}

export interface RiderSessionRequest extends Request {
  riderId?: number;
  routePlanId?: number;
  worksheetCode?: string;
  rider?: RiderSessionRider;
}

export async function findValidWorksheet(worksheetCode: string) {
  const normalized = typeof worksheetCode === "string" ? worksheetCode.trim().replace(/\s+/g, "").toUpperCase() : "";
  if (!normalized) {
    return null;
  }

  const result = await pool.query(
    `
      SELECT
        route_plan.route_plan_id,
        route_plan.worksheet_code,
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
        AND route_plan.route_date = ${BUSINESS_DATE_SQL}
        AND route_plan.status = 'SELECTED'
      GROUP BY
        route_plan.route_plan_id,
        route_plan.worksheet_code,
        rider.rider_id,
        rider.name,
        rider.phone,
        rider.vehicle_plate,
        rider.status,
        rider.max_orders_per_route
      HAVING COUNT(DISTINCT route_stop.rider_id) = 1
    `,
    [normalized],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    riderId: Number(row.rider_id),
    routePlanId: Number(row.route_plan_id),
    worksheetCode: String(row.worksheet_code),
    rider: {
      rider_id: Number(row.rider_id),
      name: String(row.name),
      phone: String(row.phone),
      vehicle_plate: String(row.vehicle_plate),
      status: String(row.rider_status),
      max_orders_per_route: Number(row.max_orders_per_route),
    },
  };
}

export async function requireWorksheet(req: RiderSessionRequest, res: Response, next: NextFunction): Promise<void> {
  const rawCode = req.header("x-worksheet-code");
  const worksheetCode = typeof rawCode === "string" ? rawCode.trim().replace(/\s+/g, "").toUpperCase() : "";

  if (!worksheetCode) {
    res.status(401).json({ message: "กรุณาระบุเลขใบงานผ่าน Header x-worksheet-code" });
    return;
  }

  try {
    const session = await findValidWorksheet(worksheetCode);
    if (!session) {
      res.status(401).json({ message: "เลขใบงานไม่ถูกต้อง หรือไม่มีงานสำหรับวันนี้" });
      return;
    }

    if (session.rider.status === "INACTIVE") {
      res.status(403).json({ message: "Rider คนนี้ถูกปิดการใช้งาน" });
      return;
    }

    req.riderId = session.riderId;
    req.routePlanId = session.routePlanId;
    req.worksheetCode = session.worksheetCode;
    req.rider = session.rider;
    next();
  } catch (error) {
    console.error("ตรวจสอบเลขใบงานล้มเหลว:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการตรวจสอบเลขใบงาน" });
  }
}

