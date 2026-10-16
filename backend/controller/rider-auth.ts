import express from "express";
import { pool } from "../database/pool.js";
import {
  findValidWorksheet,
  requireWorksheet,
  RiderSessionRequest,
} from "../middleware/rider-session.js";

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
    const session = await findValidWorksheet(worksheetCode);

    if (!session) {
      res.status(401).json({ message: "เลขใบงานไม่ถูกต้อง หรือไม่มีงานสำหรับวันนี้" });
      return;
    }

    if (session.rider.status === "INACTIVE") {
      res.status(403).json({ message: "Rider คนนี้ถูกปิดการใช้งาน" });
      return;
    }

    res.status(200).json({
      worksheetCode: session.worksheetCode,
      rider: session.rider,
    });
  } catch (error) {
    console.error("Rider worksheet login failed:", error);
    res.status(500).json({ message: "ไม่สามารถเข้าสู่ระบบด้วยเลขใบงานได้" });
  }
});

riderAuthRouter.get("/me", requireWorksheet, async (req: RiderSessionRequest, res) => {
  try {
    if (req.rider) {
      res.status(200).json({ rider: req.rider });
      return;
    }

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

