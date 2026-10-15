import express from "express";
import { pool } from "../database/pool.js";

export const orderRouter = express.Router();

orderRouter.get("/", async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        o.order_id,
        o.box_quantity,
        o.order_date,
        o.status,
        o.created_at,
        c.customer_id,
        c.first_name AS customer_first_name,
        c.last_name AS customer_last_name,
        c.phone AS customer_phone,
        c.address AS customer_address,
        c.latitude AS customer_latitude,
        c.longitude AS customer_longitude
      FROM orders AS o
      INNER JOIN customers AS c
        ON c.customer_id = o.customer_id
      ORDER BY o.order_id
    `);

    res.status(200).json(result.rows);
  } catch (error) {
    console.error("ไม่สามารถแสดงรายการสั่งซื้อได้:", error);

    res.status(500).json({
      message: "ไม่สามารถแสดงรายการสั่งซื้อได้",
    });
  }
});

orderRouter.post("/", async (req, res) => {
  const customerId = Number(req.body?.customer_id);
  const boxQuantity = Number(req.body?.box_quantity);

  if (
    !Number.isInteger(customerId) ||
    customerId <= 0 ||
    !Number.isInteger(boxQuantity) ||
    boxQuantity < 1 ||
    boxQuantity > 3
  ) {
    res.status(400).json({
      message:
        "customer_id ต้องเป็นจำนวนเต็ม และ box_quantity ต้องอยู่ระหว่าง 1 ถึง 3",
    });
    return;
  }

  try {
    const countResult = await pool.query(
      "SELECT COUNT(*)::int AS order_count FROM orders",
    );

    if (countResult.rows[0].order_count >= 30) {
      res.status(409).json({
        message: "ระบบจำลองออเดอร์ได้ไม่เกิน 30 รายการ",
      });
      return;
    }

    const customerResult = await pool.query(
      "SELECT customer_id FROM customers WHERE customer_id = $1",
      [customerId],
    );

    if (customerResult.rowCount === 0) {
      res.status(404).json({
        message: "ไม่พบข้อมูลลูกค้าที่ระบุ",
      });
      return;
    }

    const insertResult = await pool.query(
      `
      INSERT INTO orders
        (customer_id, box_quantity, order_date)
      VALUES
        ($1, $2, CURRENT_DATE)
      RETURNING order_id
      `,
      [customerId, boxQuantity],
    );

    const result = await pool.query(
      `
      SELECT
        o.order_id,
        o.box_quantity,
        o.order_date,
        o.status,
        o.created_at,
        c.customer_id,
        c.first_name AS customer_first_name,
        c.last_name AS customer_last_name,
        c.phone AS customer_phone,
        c.address AS customer_address,
        c.latitude AS customer_latitude,
        c.longitude AS customer_longitude
      FROM orders AS o
      INNER JOIN customers AS c
        ON c.customer_id = o.customer_id
      WHERE o.order_id = $1
      `,
      [insertResult.rows[0].order_id],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("ไม่สามารถเพิ่มรายการสั่งซื้อได้:", error);

    res.status(500).json({
      message: "ไม่สามารถเพิ่มรายการสั่งซื้อได้",
    });
  }
});

orderRouter.patch("/:id", async (req, res) => {
  const orderId = Number(req.params.id);
  const boxQuantity = Number(req.body?.box_quantity);

  if (
    !Number.isInteger(orderId) ||
    orderId <= 0 ||
    !Number.isInteger(boxQuantity) ||
    boxQuantity < 1 ||
    boxQuantity > 3
  ) {
    res.status(400).json({
      message:
        "order id ต้องเป็นจำนวนเต็มบวก และ box_quantity ต้องอยู่ระหว่าง 1 ถึง 3",
    });
    return;
  }

  try {
    const existingOrder = await pool.query(
      `SELECT status FROM orders WHERE order_id = $1`,
      [orderId],
    );

    if (existingOrder.rowCount === 0) {
      res.status(404).json({
        message: "ไม่พบรายการสั่งซื้อ",
      });
      return;
    }

    if (existingOrder.rows[0].status !== "PENDING") {
      res.status(409).json({
        message: "สามารถแก้ไขออเดอร์ได้เฉพาะที่มีสถานะ PENDING เท่านั้น",
      });
      return;
    }

    const updateResult = await pool.query(
      `
      UPDATE orders
      SET box_quantity = $1
      WHERE order_id = $2
      RETURNING order_id
      `,
      [boxQuantity, orderId],
    );

    if (updateResult.rowCount === 0) {
      res.status(404).json({
        message: "ไม่พบรายการสั่งซื้อ",
      });
      return;
    }

    const result = await pool.query(
      `
      SELECT
        o.order_id,
        o.box_quantity,
        o.order_date,
        o.status,
        o.created_at,
        c.customer_id,
        c.first_name AS customer_first_name,
        c.last_name AS customer_last_name,
        c.phone AS customer_phone,
        c.address AS customer_address,
        c.latitude AS customer_latitude,
        c.longitude AS customer_longitude
      FROM orders AS o
      INNER JOIN customers AS c
        ON c.customer_id = o.customer_id
      WHERE o.order_id = $1
      `,
      [orderId],
    );

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("ไม่สามารถแก้ไขจำนวนกล่องได้:", error);

    res.status(500).json({
      message: "ไม่สามารถแก้ไขจำนวนกล่องได้",
    });
  }
});

orderRouter.delete("/:id", async (req, res) => {
  const orderId = Number(req.params.id);

  if (!Number.isInteger(orderId) || orderId <= 0) {
    res.status(400).json({
      message: "order id ต้องเป็นจำนวนเต็มบวก",
    });
    return;
  }

  try {
    const existingOrder = await pool.query(
      `SELECT status FROM orders WHERE order_id = $1`,
      [orderId],
    );

    if (existingOrder.rowCount === 0) {
      res.status(404).json({
        message: "ไม่พบรายการสั่งซื้อ",
      });
      return;
    }

    if (existingOrder.rows[0].status !== "PENDING") {
      res.status(409).json({
        message: "สามารถลบออเดอร์ได้เฉพาะที่มีสถานะ PENDING เท่านั้น",
      });
      return;
    }

    const result = await pool.query(
      `
      DELETE FROM orders
      WHERE order_id = $1
      RETURNING order_id
      `,
      [orderId],
    );

    if (result.rowCount === 0) {
      res.status(404).json({
        message: "ไม่พบรายการสั่งซื้อ",
      });
      return;
    }

    res.status(200).json({
      message: "ลบรายการสั่งซื้อสำเร็จ",
      order_id: result.rows[0].order_id,
    });
  } catch (error: unknown) {
    console.error("ไม่สามารถลบรายการสั่งซื้อได้:", error);

    const databaseError = error as { code?: string };

    if (databaseError.code === "23503") {
      res.status(409).json({
        message: "ไม่สามารถลบออเดอร์ที่อยู่ในแผนการจัดส่งได้",
      });
      return;
    }

    res.status(500).json({
      message: "ไม่สามารถลบรายการสั่งซื้อได้",
    });
  }
});

orderRouter.delete("/", async (_req, res) => {
  try {
    const result = await pool.query(
      `
      DELETE FROM orders
      RETURNING order_id
      `,
    );

    res.status(200).json({
      message: "ล้างรายการสั่งซื้อทั้งหมดสำเร็จ",
      deleted_count: result.rowCount ?? 0,
    });
  } catch (error: unknown) {
    console.error("ไม่สามารถล้างรายการสั่งซื้อได้:", error);

    const databaseError = error as { code?: string };

    if (databaseError.code === "23503") {
      res.status(409).json({
        message: "ไม่สามารถล้างออเดอร์ที่อยู่ในแผนการจัดส่งได้",
      });
      return;
    }

    res.status(500).json({
      message: "ไม่สามารถล้างรายการสั่งซื้อได้",
    });
  }
});

orderRouter.get("/nearby", async (req, res) => {
  const latitude = Number(req.query.latitude);
  const longitude = Number(req.query.longitude);
  const radiusKm = 2;

  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    res.status(400).json({
      message: "latitude หรือ longitude ไม่ถูกต้อง",
    });
    return;
  }

  try {
    const result = await pool.query(
      `
      WITH nearby_orders AS (
        SELECT
          o.order_id,
          o.box_quantity,
          o.order_date,
          o.status,
          o.created_at,
          c.customer_id,
          c.first_name AS customer_first_name,
          c.last_name AS customer_last_name,
          c.phone AS customer_phone,
          c.address AS customer_address,
          c.latitude AS customer_latitude,
          c.longitude AS customer_longitude,
          6371 * 2 * ASIN(
            SQRT(
              POWER(SIN(RADIANS(c.latitude - $1) / 2), 2) +
              COS(RADIANS($1)) *
              COS(RADIANS(c.latitude)) *
              POWER(SIN(RADIANS(c.longitude - $2) / 2), 2)
            )
          ) AS distance_km
        FROM orders AS o
        INNER JOIN customers AS c
          ON c.customer_id = o.customer_id
      )
      SELECT
        order_id,
        box_quantity,
        order_date,
        status,
        created_at,
        customer_id,
        customer_first_name,
        customer_last_name,
        customer_phone,
        customer_address,
        customer_latitude,
        customer_longitude,
        distance_km
      FROM nearby_orders
      WHERE distance_km <= $3
      ORDER BY distance_km, order_id
      `,
      [latitude, longitude, radiusKm],
    );

    res.status(200).json(result.rows);
  } catch (error) {
    console.error("ไม่สามารถค้นหาออเดอร์ใกล้เคียงได้:", error);

    res.status(500).json({
      message: "ไม่สามารถค้นหาออเดอร์ใกล้เคียงได้",
    });
  }
});
