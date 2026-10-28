import express from "express";
import { pool } from "../database/pool.js";
import { BUSINESS_DATE_SQL } from "../database/business-date.js";

export const orderRouter = express.Router();

const SERVICE_RADIUS_KM = 3;
const CUSTOMER_DISTANCE_SQL = `6371 * 2 * ASIN(
  SQRT(
    POWER(SIN(RADIANS(customer.latitude - store.latitude) / 2), 2) +
    COS(RADIANS(store.latitude)) * COS(RADIANS(customer.latitude)) *
    POWER(SIN(RADIANS(customer.longitude - store.longitude) / 2), 2)
  )
)`;

orderRouter.get("/", async (req, res) => {
  const requestedDate = typeof req.query.date === "string" ? req.query.date.trim() : "";
  try {
    const result = await pool.query(`
      SELECT
        o.order_id,
        o.box_quantity,
        o.order_date,
        o.status,
        o.is_simulated,
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
      WHERE o.order_date = COALESCE(NULLIF($1, '')::date, ${BUSINESS_DATE_SQL})
      ORDER BY o.order_id
    `, [requestedDate]);

    res.status(200).json(result.rows);
  } catch (error) {
    console.error("ไม่สามารถแสดงรายการสั่งซื้อได้:", error);

    res.status(500).json({
      message: "ไม่สามารถแสดงรายการสั่งซื้อได้",
    });
  }
});

orderRouter.post("/simulate", async (req, res) => {
  const rawItems: unknown[] = Array.isArray(req.body?.items) ? req.body.items : [];
  const items: Array<{ customerId: number; boxQuantity: number }> = [];

  if (rawItems.length === 0 || rawItems.length > 30) {
    res.status(400).json({ message: "ข้อมูลจำลองออเดอร์ไม่ถูกต้อง" });
    return;
  }

  for (const rawItem of rawItems) {
    if (rawItem === null || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      res.status(400).json({ message: "ข้อมูลจำลองออเดอร์ไม่ถูกต้อง" });
      return;
    }
    const item = rawItem as Record<string, unknown>;
    const customerId = Number(item.customer_id);
    const boxQuantity = Number(item.box_quantity);
    if (
      !Number.isInteger(customerId) ||
      customerId <= 0 ||
      !Number.isInteger(boxQuantity) ||
      boxQuantity < 1 ||
      boxQuantity > 3
    ) {
      res.status(400).json({ message: "ข้อมูลจำลองออเดอร์ไม่ถูกต้อง" });
      return;
    }
    items.push({ customerId, boxQuantity });
  }

  const customerIds = items.map((item) => item.customerId);
  if (new Set(customerIds).size !== customerIds.length) {
    res.status(400).json({ message: "จำลองออเดอร์ได้ลูกค้าละหนึ่งรายการต่อวัน" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext('rider-orders:' || ${BUSINESS_DATE_SQL}::text))`,
    );
    const countResult = await client.query(
      `SELECT COUNT(*)::int AS order_count FROM orders WHERE order_date = ${BUSINESS_DATE_SQL}`,
    );
    const totalAfterSimulation = countResult.rows[0].order_count + items.length;
    if (totalAfterSimulation < 20 || totalAfterSimulation > 30) {
      await client.query("ROLLBACK");
      res.status(409).json({ message: "หลังจำลองแล้ว ออเดอร์วันนี้ต้องมีรวม 20–30 รายการ" });
      return;
    }

    const customerResult = await client.query(
      `WITH active_store AS (
         SELECT latitude, longitude
         FROM stores
         WHERE is_active = TRUE
         ORDER BY store_id
         LIMIT 1
       )
       SELECT customer.customer_id
       FROM customers AS customer
       CROSS JOIN active_store AS store
       WHERE customer.customer_id = ANY($1::int[])
         AND ${CUSTOMER_DISTANCE_SQL} <= $2
         AND NOT EXISTS (
           SELECT 1 FROM orders AS existing_order
           WHERE existing_order.customer_id = customer.customer_id
             AND existing_order.order_date = ${BUSINESS_DATE_SQL}
         )
       FOR UPDATE OF customer`,
      [customerIds, SERVICE_RADIUS_KM],
    );
    if ((customerResult.rowCount ?? 0) !== customerIds.length) {
      await client.query("ROLLBACK");
      res.status(409).json({ message: "จำลองได้เฉพาะลูกค้าในระยะ 3 กม. ที่ยังไม่มีออร์เดอร์วันนี้" });
      return;
    }

    const values = items.flatMap((item) => [item.customerId, item.boxQuantity]);
    const placeholders = items.map((_: { customerId: number; boxQuantity: number }, index: number) => `($${index * 2 + 1}, $${index * 2 + 2}, ${BUSINESS_DATE_SQL}, TRUE)`);
    const result = await client.query(
      `WITH inserted AS (
         INSERT INTO orders (customer_id, box_quantity, order_date, is_simulated)
         VALUES ${placeholders.join(", ")}
         RETURNING order_id, customer_id, box_quantity, order_date, status, is_simulated, created_at
       )
       SELECT
         inserted.order_id,
         inserted.box_quantity,
         inserted.order_date,
         inserted.status,
        inserted.is_simulated,
         inserted.created_at,
         customer.customer_id,
         customer.first_name AS customer_first_name,
         customer.last_name AS customer_last_name,
         customer.phone AS customer_phone,
         customer.address AS customer_address,
         customer.latitude AS customer_latitude,
         customer.longitude AS customer_longitude
       FROM inserted
       INNER JOIN customers AS customer ON customer.customer_id = inserted.customer_id
       ORDER BY inserted.order_id`,
      values,
    );

    await client.query("COMMIT");
    res.status(201).json(result.rows);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("ไม่สามารถสร้างออเดอร์จำลองแบบชุดได้:", error);
    res.status(500).json({ message: "ไม่สามารถสร้างออเดอร์จำลองได้" });
  } finally {
    client.release();
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

  const client = await pool.connect();
  let createdNewOrder = true;
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext('rider-orders:' || ${BUSINESS_DATE_SQL}::text))`,
    );
    const customerResult = await client.query(
      "SELECT customer_id FROM customers WHERE customer_id = $1",
      [customerId],
    );

    if (customerResult.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({
        message: "ไม่พบข้อมูลลูกค้าที่ระบุ",
      });
      return;
    }

    const existingOrders = await client.query(
      `SELECT order_id, box_quantity, status
       FROM orders
       WHERE customer_id = $1 AND order_date = ${BUSINESS_DATE_SQL}
       ORDER BY order_id
       FOR UPDATE`,
      [customerId],
    );

    let orderId: number;
    if (existingOrders.rows.length > 1) {
      await client.query("ROLLBACK");
      res.status(409).json({ message: "ลูกค้ารายนี้มีหลายออร์เดอร์วันนี้ ต้องตรวจสอบรายการเดิมก่อนเพิ่ม" });
      return;
    }

    if (existingOrders.rows.length > 0) {
      createdNewOrder = false;
      if (existingOrders.rows.some((order) => order.status !== "PENDING")) {
        await client.query("ROLLBACK");
        res.status(409).json({ message: "ลูกค้ารายนี้มีออร์เดอร์ที่มอบหมายหรือเริ่มจัดส่งแล้ว จึงเพิ่มรายการซ้ำไม่ได้" });
        return;
      }

      const existingBoxQuantity = existingOrders.rows.reduce(
        (sum, order) => sum + Number(order.box_quantity),
        0,
      );
      const combinedQuantity = existingBoxQuantity + boxQuantity;
      if (combinedQuantity > 3) {
        await client.query("ROLLBACK");
        res.status(409).json({
          message: `ลูกค้ารายนี้มี ${existingBoxQuantity} กล่องแล้ว เพิ่มได้อีกไม่เกิน ${3 - existingBoxQuantity} กล่อง`,
        });
        return;
      }

      orderId = existingOrders.rows[0].order_id;
      await client.query(
        `UPDATE orders SET box_quantity = $1, is_simulated = FALSE WHERE order_id = $2`,
        [combinedQuantity, orderId],
      );
    } else {
      const countResult = await client.query(
        `SELECT COUNT(*)::int AS order_count FROM orders WHERE order_date = ${BUSINESS_DATE_SQL}`,
      );
      if (countResult.rows[0].order_count >= 30) {
        await client.query("ROLLBACK");
        res.status(409).json({ message: "ระบบจำลองออเดอร์ได้ไม่เกิน 30 รายการ" });
        return;
      }

      const insertResult = await client.query(
        `INSERT INTO orders (customer_id, box_quantity, order_date)
         VALUES ($1, $2, ${BUSINESS_DATE_SQL})
         RETURNING order_id`,
        [customerId, boxQuantity],
      );
      orderId = insertResult.rows[0].order_id;
    }

    const result = await client.query(
      `
      SELECT
        o.order_id,
        o.box_quantity,
        o.order_date,
        o.status,
        o.is_simulated,
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

    await client.query("COMMIT");
    res.status(createdNewOrder ? 201 : 200).json(result.rows[0]);
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Connection may already be closed after a database failure.
    }
    console.error("ไม่สามารถเพิ่มรายการสั่งซื้อได้:", error);

    const databaseError = error as { code?: string };
    if (databaseError.code === "23503") {
      res.status(409).json({ message: "ไม่สามารถรวมออร์เดอร์ที่อยู่ในใบงานจัดส่งแล้วได้" });
      return;
    }

    res.status(500).json({
      message: "ไม่สามารถเพิ่มรายการสั่งซื้อได้",
    });
  } finally {
    client.release();
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

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existingOrder = await client.query(
      `SELECT status FROM orders WHERE order_id = $1 FOR UPDATE`,
      [orderId],
    );

    if (existingOrder.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({
        message: "ไม่พบรายการสั่งซื้อ",
      });
      return;
    }

    if (existingOrder.rows[0].status !== "PENDING") {
      await client.query("ROLLBACK");
      res.status(409).json({
        message: "สามารถแก้ไขออเดอร์ได้เฉพาะที่มีสถานะ PENDING เท่านั้น",
      });
      return;
    }

    const updateResult = await client.query(
      `
      UPDATE orders
      SET box_quantity = $1,
          is_simulated = FALSE
      WHERE order_id = $2 AND status = 'PENDING'
      RETURNING order_id
      `,
      [boxQuantity, orderId],
    );

    if (updateResult.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({
        message: "ไม่พบรายการสั่งซื้อ",
      });
      return;
    }

    const result = await client.query(
      `
      SELECT
        o.order_id,
        o.box_quantity,
        o.order_date,
        o.status,
        o.is_simulated,
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

    await client.query("COMMIT");
    res.status(200).json(result.rows[0]);
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Connection may already be closed after a database failure.
    }
    console.error("ไม่สามารถแก้ไขจำนวนกล่องได้:", error);

    res.status(500).json({
      message: "ไม่สามารถแก้ไขจำนวนกล่องได้",
    });
  } finally {
    client.release();
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

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existingOrder = await client.query(
      `SELECT status FROM orders WHERE order_id = $1 FOR UPDATE`,
      [orderId],
    );

    if (existingOrder.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({
        message: "ไม่พบรายการสั่งซื้อ",
      });
      return;
    }

    if (existingOrder.rows[0].status !== "PENDING") {
      await client.query("ROLLBACK");
      res.status(409).json({
        message: "สามารถลบออเดอร์ได้เฉพาะที่มีสถานะ PENDING เท่านั้น",
      });
      return;
    }

    const result = await client.query(
      `
      DELETE FROM orders
      WHERE order_id = $1 AND status = 'PENDING'
      RETURNING order_id
      `,
      [orderId],
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({
        message: "ไม่พบรายการสั่งซื้อ",
      });
      return;
    }

    await client.query("COMMIT");
    res.status(200).json({
      message: "ลบรายการสั่งซื้อสำเร็จ",
      order_id: result.rows[0].order_id,
    });
  } catch (error: unknown) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Connection may already be closed after a database failure.
    }
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
  } finally {
    client.release();
  }
});

orderRouter.delete("/", async (_req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext('rider-orders:' || ${BUSINESS_DATE_SQL}::text))`,
    );
    const blockedResult = await client.query(
      `SELECT COUNT(*)::int AS blocked_count
       FROM orders AS order_row
       WHERE order_row.order_date = ${BUSINESS_DATE_SQL}
         AND order_row.is_simulated = TRUE
         AND (order_row.status <> 'PENDING' OR EXISTS (
           SELECT 1 FROM route_stops AS route_stop WHERE route_stop.order_id = order_row.order_id
         ))`,
    );
    if (blockedResult.rows[0].blocked_count > 0) {
      await client.query("ROLLBACK");
      res.status(409).json({
        message: "มีออร์เดอร์จำลองที่ถูกมอบหมายหรือมีจุดส่งในใบงานแล้ว จึงล้างไม่ได้",
      });
      return;
    }

    const result = await client.query(
      `
      DELETE FROM orders
      WHERE order_date = ${BUSINESS_DATE_SQL}
        AND status = 'PENDING'
        AND is_simulated = TRUE
      RETURNING order_id
      `,
    );

    await client.query("COMMIT");

    res.status(200).json({
      message: "ล้างออร์เดอร์จำลองที่รอดำเนินการของวันนี้สำเร็จ",
      deleted_count: result.rowCount ?? 0,
    });
  } catch (error: unknown) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Connection may already be closed after a database failure.
    }
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
  } finally {
    client.release();
  }
});

orderRouter.get("/nearby", async (req, res) => {
  const latitude = Number(req.query.latitude);
  const longitude = Number(req.query.longitude);
  const rawRadiusKm = req.query.radius_km;
  const radiusKm = rawRadiusKm === undefined
    ? 3
    : typeof rawRadiusKm === "string" ? Number(rawRadiusKm) : Number.NaN;

  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    !Number.isFinite(radiusKm) ||
    radiusKm < 1 ||
    radiusKm > 3
  ) {
    res.status(400).json({
      message: "latitude, longitude หรือ radius_km ไม่ถูกต้อง (รัศมี 1–3 กม.)",
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
          o.is_simulated,
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
        WHERE o.order_date = ${BUSINESS_DATE_SQL}
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
        is_simulated,
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
