import express from "express";
import { pool } from "../database/pool.js";

export const customerRouter = express.Router();
const SERVICE_RADIUS_KM = 3;
const EARTH_RADIUS_KM = 6371;

function distanceKm(latitudeA: number, longitudeA: number, latitudeB: number, longitudeB: number): number {
  const dLat = ((latitudeB - latitudeA) * Math.PI) / 180;
  const dLon = ((longitudeB - longitudeA) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((latitudeA * Math.PI) / 180) * Math.cos((latitudeB * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getActiveStoreLocation(): Promise<{ latitude: number; longitude: number } | null> {
  const result = await pool.query(
    `SELECT latitude, longitude FROM stores WHERE is_active = TRUE ORDER BY store_id LIMIT 1`,
  );
  const store = result.rows[0];
  if (!store) return null;
  return { latitude: Number(store.latitude), longitude: Number(store.longitude) };
}

function outsideServiceArea(
  store: { latitude: number; longitude: number } | null,
  latitude: number,
  longitude: number,
): boolean {
  return !store || distanceKm(store.latitude, store.longitude, latitude, longitude) > SERVICE_RADIUS_KM;
}

customerRouter.get("/", async (req, res) => {
  const search =
    typeof req.query.name === "string" ? req.query.name.trim() : "";

  try {
    const result = search
      ? await pool.query(
          `
          SELECT
            customer_id,
            first_name,
            last_name,
            phone,
            address,
            latitude,
            longitude,
            created_at,
            updated_at
          FROM customers
          WHERE
            first_name ILIKE $1
            OR last_name ILIKE $1
          ORDER BY customer_id
          `,
          [`%${search}%`],
        )
      : await pool.query(`
          SELECT
            customer_id,
            first_name,
            last_name,
            phone,
            address,
            latitude,
            longitude,
            created_at,
            updated_at
          FROM customers
          ORDER BY customer_id
        `);

    res.status(200).json(result.rows);
  } catch (error) {
    console.error("ไม่สามารถค้นหาข้อมูลลูกค้าได้:", error);

    res.status(500).json({
      message: "ไม่สามารถค้นหาข้อมูลลูกค้าได้",
    });
  }
});

customerRouter.post("/", async (req, res) => {
  const { first_name, last_name, phone, address, latitude, longitude } =
    req.body;

  const lat = Number(latitude);
  const lon = Number(longitude);

  if (
    typeof first_name !== "string" ||
    first_name.trim() === "" ||
    typeof last_name !== "string" ||
    last_name.trim() === "" ||
    typeof phone !== "string" ||
    phone.trim() === "" ||
    typeof address !== "string" ||
    address.trim() === "" ||
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    !Number.isFinite(lon) ||
    lon < -180 ||
    lon > 180
  ) {
    res.status(400).json({
      message:
        "กรุณาส่ง first_name, last_name, phone, address, latitude และ longitude ให้ถูกต้อง",
    });
    return;
  }

  try {
    const store = await getActiveStoreLocation();
    if (outsideServiceArea(store, lat, lon)) {
      res.status(400).json({ message: "พิกัดลูกค้าอยู่นอกพื้นที่บริการรัศมี 3 กม." });
      return;
    }

    const result = await pool.query(
      `
      INSERT INTO customers
        (first_name, last_name, phone, address, latitude, longitude)
      VALUES
        ($1, $2, $3, $4, $5, $6)
      RETURNING
        customer_id,
        first_name,
        last_name,
        phone,
        address,
        latitude,
        longitude,
        created_at,
        updated_at
      `,
      [
        first_name.trim(),
        last_name.trim(),
        phone.trim(),
        address.trim(),
        lat,
        lon,
      ],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("ไม่สามารถเพิ่มข้อมูลลูกค้าได้:", error);
    res.status(500).json({
      message: "ไม่สามารถเพิ่มข้อมูลลูกค้าได้",
    });
  }
});

customerRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({
      message: "customer id ต้องเป็นจำนวนเต็มบวก",
    });
    return;
  }

  try {
    const result = await pool.query(
      `
      DELETE FROM customers
      WHERE customer_id = $1
      RETURNING customer_id
      `,
      [id],
    );

    if (result.rowCount === 0) {
      res.status(404).json({
        message: "ไม่พบข้อมูลลูกค้า",
      });
      return;
    }

    res.status(200).json({
      message: "ลบข้อมูลลูกค้าสำเร็จ",
      customer_id: result.rows[0].customer_id,
    });
  } catch (error: unknown) {
    console.error("ไม่สามารถลบข้อมูลลูกค้าได้:", error);

    const databaseError = error as { code?: string };

    if (databaseError.code === "23001" || databaseError.code === "23503") {
      res.status(409).json({
        message: "ไม่สามารถลบลูกค้าที่มีรายการสั่งซื้ออยู่ได้",
      });
      return;
    }

    res.status(500).json({
      message: "ไม่สามารถลบข้อมูลลูกค้าได้",
    });
  }
});

customerRouter.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({
      message: "customer id ต้องเป็นจำนวนเต็มบวก",
    });
    return;
  }

  const body = req.body ?? {};

  const editableFields = [
    "first_name",
    "last_name",
    "phone",
    "address",
    "latitude",
    "longitude",
  ] as const;

  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const field of editableFields) {
    if (body[field] === undefined) {
      continue;
    }

    if (["first_name", "last_name", "phone", "address"].includes(field)) {
      if (typeof body[field] !== "string" || body[field].trim() === "") {
        res.status(400).json({
          message: `${field} ต้องเป็นข้อความและห้ามว่าง`,
        });
        return;
      }

      setClauses.push(`${field} = $${values.length + 1}`);
      values.push(body[field].trim());
      continue;
    }

    const coordinate = Number(body[field]);

    if (
      !Number.isFinite(coordinate) ||
      (field === "latitude" && (coordinate < -90 || coordinate > 90)) ||
      (field === "longitude" && (coordinate < -180 || coordinate > 180))
    ) {
      res.status(400).json({
        message: `${field} ไม่ถูกต้อง`,
      });
      return;
    }

    setClauses.push(`${field} = $${values.length + 1}`);
    values.push(coordinate);
  }

  if (setClauses.length === 0) {
    res.status(400).json({
      message: "ต้องส่งข้อมูลอย่างน้อยหนึ่งฟิลด์เพื่อแก้ไข",
    });
    return;
  }

  try {
    if (setClauses.some((clause) => clause.startsWith("latitude =") || clause.startsWith("longitude ="))) {
      const current = await pool.query(
        `SELECT latitude, longitude FROM customers WHERE customer_id = $1`,
        [id],
      );
      if (current.rowCount === 0) {
        res.status(404).json({ message: "ไม่พบข้อมูลลูกค้า" });
        return;
      }

      const currentLatitude = Number(current.rows[0].latitude);
      const currentLongitude = Number(current.rows[0].longitude);
      const nextLatitude = body.latitude === undefined ? currentLatitude : Number(body.latitude);
      const nextLongitude = body.longitude === undefined ? currentLongitude : Number(body.longitude);
      const store = await getActiveStoreLocation();
      if (outsideServiceArea(store, nextLatitude, nextLongitude)) {
        res.status(400).json({ message: "พิกัดลูกค้าอยู่นอกพื้นที่บริการรัศมี 3 กม." });
        return;
      }
    }

    values.push(id);

    const result = await pool.query(
      `
      UPDATE customers
      SET ${setClauses.join(", ")}
      WHERE customer_id = $${values.length}
      RETURNING
        customer_id,
        first_name,
        last_name,
        phone,
        address,
        latitude,
        longitude,
        created_at,
        updated_at
      `,
      values,
    );

    if (result.rowCount === 0) {
      res.status(404).json({
        message: "ไม่พบข้อมูลลูกค้า",
      });
      return;
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("ไม่สามารถแก้ไขข้อมูลลูกค้าได้:", error);

    res.status(500).json({
      message: "ไม่สามารถแก้ไขข้อมูลลูกค้าได้",
    });
  }
});

customerRouter.get("/nearby", async (req, res) => {
  const latitude = Number(req.query.latitude);
  const longitude = Number(req.query.longitude);
  const radiusKm = 1;

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
      WITH nearby_customers AS (
        SELECT
          customer_id,
          first_name,
          last_name,
          phone,
          address,
          latitude,
          longitude,
          created_at,
          updated_at,
          6371 * 2 * ASIN(
            SQRT(
              POWER(SIN(RADIANS(latitude - $1) / 2), 2) +
              COS(RADIANS($1)) *
              COS(RADIANS(latitude)) *
              POWER(SIN(RADIANS(longitude - $2) / 2), 2)
            )
          ) AS distance_km
        FROM customers
      )
      SELECT
        customer_id,
        first_name,
        last_name,
        phone,
        address,
        latitude,
        longitude,
        created_at,
        updated_at,
        distance_km
      FROM nearby_customers
      WHERE distance_km <= $3
      ORDER BY distance_km, customer_id
      `,
      [latitude, longitude, radiusKm],
    );

    res.status(200).json(result.rows);
  } catch (error) {
    console.error("ไม่สามารถค้นหาลูกค้าใกล้เคียงได้:", error);

    res.status(500).json({
      message: "ไม่สามารถค้นหาลูกค้าใกล้เคียงได้",
    });
  }
});
