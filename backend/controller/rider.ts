import express from "express";
import { pool } from "../database/pool";

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
