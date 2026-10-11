import express from "express";
import { pool } from "../database/pool";
import { RiderSessionRequest, requireRiderToken } from "../middleware/rider-session";
import { createRiderToken } from "../security/rider-session";

export const riderAuthRouter = express.Router();

function normalizePhone(value: unknown): string {
  return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

function normalizeVehiclePlate(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/[\s-]/g, "").toUpperCase() : "";
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

riderAuthRouter.post("/login", async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const vehiclePlate = normalizeVehiclePlate(req.body?.vehiclePlate);

  if (!phone || !vehiclePlate) {
    res.status(400).json({ message: "กรุณากรอกเบอร์โทรและทะเบียนรถ" });
    return;
  }

  try {
    const result = await pool.query(
      `
        SELECT rider_id, name, phone, vehicle_plate, status, max_orders_per_route
        FROM riders
        WHERE regexp_replace(phone, '[^0-9]', '', 'g') = $1
          AND regexp_replace(UPPER(vehicle_plate), '[[:space:]-]', '', 'g') = $2
      `,
      [phone, vehiclePlate],
    );
    const rider = result.rows[0];

    if (!rider) {
      res.status(401).json({ message: "เบอร์โทรหรือทะเบียนรถไม่ถูกต้อง" });
      return;
    }

    if (rider.status === "INACTIVE") {
      res.status(403).json({ message: "Rider คนนี้ถูกปิดการใช้งาน" });
      return;
    }

    res.status(200).json({
      rider,
      token: createRiderToken(rider.rider_id),
      expiresInHours: 12,
    });
  } catch (error) {
    console.error("Rider login failed:", error);
    res.status(500).json({ message: "ไม่สามารถเข้าสู่ระบบ Rider ได้" });
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
