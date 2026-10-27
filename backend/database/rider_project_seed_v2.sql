-- Rider Project: PostgreSQL schema + version 2 location seed
-- PostgreSQL 14+ / UTF-8 / one simulated store
-- WARNING: running this script drops and recreates all six project tables.
-- Seed data: 1 store, 10 synthetic riders and 27 synthetic customers. Names and phone numbers are fictitious.
-- orders, route_plans and route_stops are created with the existing schema but left empty.
-- Identity columns are omitted from INSERT statements so PostgreSQL generates IDs.
-- Store test point: road-side location on/near หน้า HS - ศาลหลักเมือง, Kham Riang.
--   The Demo School address and mapped point are recorded by OpenStreetMap/Mapcarta:
--   https://mapcarta.com/N6468098085
-- University and surrounding residential-area anchors:
--   MSU Kham Riang: 16.24704, 103.24936 https://mapcarta.com/W546649821
--   Tha Khon Yang residential area: 16.23661, 103.26338 https://mapcarta.com/W546649811
--   Arunchai Grand: 66RV+8J9, Kham Riang; seed anchor 16.2408125, 103.2440625
--   The Best and PP Apartment anchors are from the existing project seed's OSM references.
--   Official MSU dorm directory: https://building.msu.ac.th/dorm_network_public_page_2569/index.php?area=&q=
-- Customer pins are synthetic delivery points spread across residential zones around the store;
-- each is distinct, and the validation block checks all are within 3 km and separated by >= 50 m.

BEGIN;

SET TIME ZONE 'Asia/Bangkok';

DROP TABLE IF EXISTS route_stops CASCADE;

DROP TABLE IF EXISTS route_plans CASCADE;

DROP TABLE IF EXISTS orders CASCADE;

DROP TABLE IF EXISTS riders CASCADE;

DROP TABLE IF EXISTS customers CASCADE;

DROP TABLE IF EXISTS stores CASCADE;

CREATE TABLE stores (
    store_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    store_name VARCHAR(150) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    address VARCHAR(255) NOT NULL,
    latitude NUMERIC(10, 7) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude NUMERIC(10, 7) NOT NULL CHECK (
        longitude BETWEEN -180 AND 180
    ),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE customers (
    customer_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    address VARCHAR(255) NOT NULL,
    latitude NUMERIC(10, 7) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude NUMERIC(10, 7) NOT NULL CHECK (
        longitude BETWEEN -180 AND 180
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE riders (
    rider_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    vehicle_plate VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE' CHECK (
        status IN (
            'AVAILABLE',
            'BUSY',
            'INACTIVE'
        )
    ),
    max_orders_per_route SMALLINT NOT NULL DEFAULT 3 CHECK (
        max_orders_per_route BETWEEN 1 AND 3
    )
);

CREATE TABLE orders (
    order_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers (customer_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    box_quantity SMALLINT NOT NULL CHECK (box_quantity BETWEEN 1 AND 3),
    order_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (
        status IN (
            'PENDING',
            'ASSIGNED',
            'DELIVERING',
            'DELIVERED',
            'CANCELLED'
        )
    ),
    is_simulated BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE route_plans (
    route_plan_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    store_id INTEGER NOT NULL REFERENCES stores (store_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    route_date DATE NOT NULL,
    version INTEGER NOT NULL CHECK (version >= 1),
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (
        status IN (
            'DRAFT',
            'SELECTED',
            'REJECTED',
            'COMPLETED'
        )
    ),
    total_distance NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (total_distance >= 0),
    estimated_minutes INTEGER NOT NULL DEFAULT 0 CHECK (estimated_minutes >= 0),
    total_cost NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
    total_revenue NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (total_revenue >= 0),
    total_profit NUMERIC(10, 2) NOT NULL DEFAULT 0,
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    worksheet_code VARCHAR(30) NOT NULL UNIQUE
);

CREATE TABLE route_stops (
    route_stop_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    route_plan_id INTEGER NOT NULL REFERENCES route_plans (route_plan_id) ON UPDATE CASCADE ON DELETE CASCADE,
    rider_id INTEGER NOT NULL REFERENCES riders (rider_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    order_id INTEGER NOT NULL REFERENCES orders (order_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    stop_sequence INTEGER NOT NULL CHECK (stop_sequence >= 1),
    distance_from_previous NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (distance_from_previous >= 0),
    estimated_arrival TIMESTAMPTZ,
    delivery_status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (
        delivery_status IN (
            'PENDING',
            'DELIVERED',
            'FAILED'
        )
    ),
    delivered_at TIMESTAMPTZ,
    UNIQUE (route_plan_id, stop_sequence),
    UNIQUE (route_plan_id, order_id)
);

CREATE INDEX idx_customers_name ON customers (first_name, last_name);

CREATE INDEX idx_customers_location ON customers (latitude, longitude);

CREATE INDEX idx_orders_customer ON orders (customer_id);

CREATE INDEX idx_orders_date_status ON orders (order_date, status);

CREATE INDEX idx_riders_status ON riders (status);

CREATE INDEX idx_route_plans_store_date ON route_plans (store_id, route_date, version);

CREATE INDEX idx_route_stops_rider ON route_stops (route_plan_id, rider_id);

CREATE INDEX idx_route_stops_order ON route_stops (order_id);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stores_updated_at BEFORE UPDATE ON stores
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_customers_updated_at BEFORE UPDATE ON customers
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO
    stores (
        store_name,
        phone,
        address,
        latitude,
        longitude,
        is_active
    )
VALUES (
        'ร้านข้าวกล่องจำลอง มมส. (จุดทดสอบ)',
        '0900000000',
        'จุดร้านจำลองติดแนวถนนหน้า HS - ศาลหลักเมือง ใกล้มหาวิทยาลัยมหาสารคาม ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม',
        16.2443350,
        103.2494546,
        TRUE
    );

-- Synthetic rider data for local/API testing. Phone numbers and plates are fictitious.
INSERT INTO riders (name, phone, vehicle_plate, status, max_orders_per_route) VALUES
('กิตติพงศ์ ศรีสมมติ', '0890000001', 'ทด 1001', 'AVAILABLE', 3),
('ณัฐดนัย เมฆาจำลอง', '0890000002', 'ทด 1002', 'AVAILABLE', 3),
('พีรพล วัฒนาทดสอบ', '0890000003', 'ทด 1003', 'AVAILABLE', 3),
('ธนภัทร แสงทดลอง', '0890000004', 'ทด 1004', 'AVAILABLE', 3),
('วรเมธ นครสมมติ', '0890000005', 'ทด 1005', 'AVAILABLE', 3),
('ชยพล รุ่งจำลอง', '0890000006', 'ทด 1006', 'AVAILABLE', 3),
('ภาคิน ทองทดสอบ', '0890000007', 'ทด 1007', 'AVAILABLE', 3),
('ศุภกร เมืองสมมติ', '0890000008', 'ทด 1008', 'AVAILABLE', 3),
('เอกภพ ฟ้าจำลอง', '0890000009', 'ทด 1009', 'AVAILABLE', 3),
('รินรดา ดาวทดสอบ', '0890000010', 'ทด 1010', 'INACTIVE', 3);

-- Synthetic customer delivery points. IDs are generated by the IDENTITY columns.
INSERT INTO
    customers (
        first_name,
        last_name,
        phone,
        address,
        latitude,
        longitude
    )
VALUES (
        'ธนกฤต',
        'แสงทอง',
        '0900000001',
        'อรัญชัยแกรนด์ ห้อง 305, ถนนหน้า มมส. ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม',
        16.2408125,
        103.2440625
    ),
    (
        'พิมพ์ชนก',
        'วัฒนชัย',
        '0900000002',
        'เจมส์บอนด์แมนชั่น ห้อง 204, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม',
        16.2420625,
        103.2434375
    ),
    (
        'ณัฐวุฒิ',
        'คำดี',
        '0900000003',
        'หอพักนักศึกษาฝั่งตะวันตก มมส. ห้อง 202, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม',
        16.2415500,
        103.2431000
    ),
    (
        'ชลธิชา',
        'ศรีสุข',
        '0900000004',
        'บ้านเช่านักศึกษาชุมชนขามเรียง ห้อง 01, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม',
        16.2399500,
        103.2443500
    ),
    (
        'ภาคิน',
        'บุญมี',
        '0900000005',
        'หอพักนักศึกษาใกล้รั้ว มมส. ห้อง 106, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม',
        16.2428500,
        103.2429500
    ),
    (
        'กัญญารัตน์',
        'อินทร์คำ',
        '0900000006',
        'อพาร์ตเมนต์ชุมชนขามเรียง ห้อง 301, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม',
        16.2418500,
        103.2450500
    ),
    (
        'ศุภกร',
        'วิเศษวงศ์',
        '0900000007',
        'หอพักนักศึกษาซอยศรีสะอาด ห้อง 202, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม',
        16.2512369,
        103.2432242
    ),
    (
        'อรปรียา',
        'มณีรัตน์',
        '0900000008',
        'หอพักนักศึกษาซอยศรีสะอาด ห้อง 305, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม',
        16.2520500,
        103.2430000
    ),
    (
        'วรเมธ',
        'จันทร์ดี',
        '0900000009',
        'หอพักนักศึกษาฝั่งเหนือชุมชนขามเรียง ห้อง 406, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม',
        16.2530000,
        103.2441000
    ),
    (
        'มนัสวี',
        'พูนทรัพย์',
        '0900000010',
        'หอพักใกล้ถนนทางเข้ามหาวิทยาลัย ห้อง 203, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม',
        16.2545078,
        103.2445734
    ),
    (
        'กิตติศักดิ์',
        'ไชยรัตน์',
        '0900000011',
        'บ้านเช่านักศึกษาฝั่งเหนือ มมส. ห้อง 02, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม',
        16.2528000,
        103.2460000
    ),
    (
        'ณิชาภา',
        'แสนคำ',
        '0900000012',
        'หอพักนักศึกษาชุมชนขามเรียง ห้อง 208, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม',
        16.2507000,
        103.2464000
    ),
    (
        'ปกรณ์',
        'วงศ์สวัสดิ์',
        '0900000013',
        'หอพักกุดรัง มมส. ห้อง 211, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม',
        16.2478000,
        103.2468000
    ),
    (
        'สิริกานต์',
        'คงมั่น',
        '0900000014',
        'หอพักนักศึกษาฝั่งชุมชนขามเรียง ห้อง 307, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม',
        16.2493000,
        103.2467000
    ),
    (
        'ธนภัทร',
        'มีสุข',
        '0900000015',
        'บ้านเช่านักศึกษาใกล้มหาวิทยาลัย ห้อง 03, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม',
        16.2485000,
        103.2449000
    ),
    (
        'นันทิชา',
        'ทองใบ',
        '0900000016',
        'หอพักเดอะเบสท์ ห้อง 302, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม',
        16.2359123,
        103.2560879
    ),
    (
        'ชยพล',
        'แก้วคำ',
        '0900000017',
        'หอพักนักศึกษาย่านท่าขอนยาง ห้อง 205, ต.ท่าขอนยาง อ.กันทรวิชัย จ.มหาสารคาม',
        16.2367000,
        103.2553000
    ),
    (
        'รินรดา',
        'สุขเกษม',
        '0900000018',
        'บ้านเช่านักศึกษาท่าขอนยาง ห้อง 01, ต.ท่าขอนยาง อ.กันทรวิชัย จ.มหาสารคาม',
        16.2349000,
        103.2557000
    ),
    (
        'ก้องภพ',
        'ศรีอุดม',
        '0900000019',
        'หอพักนักศึกษาฝั่งถนน มมส.ใหม่ ห้อง 404, ต.ท่าขอนยาง อ.กันทรวิชัย จ.มหาสารคาม',
        16.2370000,
        103.2571000
    ),
    (
        'ปาริชาติ',
        'บุญส่ง',
        '0900000020',
        'พีพีอพาร์ทเมนท์ ห้อง 308, ต.ท่าขอนยาง อ.กันทรวิชัย จ.มหาสารคาม',
        16.2372539,
        103.2634158
    ),
    (
        'เอกภพ',
        'ศรีสะอาด',
        '0900000021',
        'หอพักนักศึกษาชุมชนท่าขอนยาง ห้อง 202, ต.ท่าขอนยาง อ.กันทรวิชัย จ.มหาสารคาม',
        16.2382000,
        103.2623000
    ),
    (
        'วาสนา',
        'แสงจันทร์',
        '0900000022',
        'บ้านเช่านักศึกษาท่าขอนยาง ห้อง 02, ต.ท่าขอนยาง อ.กันทรวิชัย จ.มหาสารคาม',
        16.2363000,
        103.2620000
    ),
    (
        'ธีรภัทร',
        'คงทอง',
        '0900000023',
        'หอพักนักศึกษาฝั่งถนน มมส.-บ้านดอนยม ห้อง 306, ต.ท่าขอนยาง อ.กันทรวิชัย จ.มหาสารคาม',
        16.2388000,
        103.2642000
    ),
    (
        'สุภาวดี',
        'มานะดี',
        '0900000024',
        'บ้านเช่านักศึกษาชุมชนท่าขอนยาง ห้อง 03, ต.ท่าขอนยาง อ.กันทรวิชัย จ.มหาสารคาม',
        16.2358000,
        103.2648000
    ),
    (
        'กฤตภาส',
        'จันทร์หอม',
        '0900000025',
        'หอพักนักศึกษาด้านตะวันออกของชุมชนขามเรียง ห้อง 105, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม',
        16.2520000,
        103.2520000
    ),
    (
        'ณัฐชา',
        'ภักดี',
        '0900000026',
        'อพาร์ตเมนต์นักศึกษาชุมชนขามเรียง ห้อง 210, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม',
        16.2532000,
        103.2540000
    ),
    (
        'พีรวิชญ์',
        'ทองคำ',
        '0900000027',
        'บ้านเช่านักศึกษาด้านตะวันออกชุมชนขามเรียง ห้อง 04, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม',
        16.2508000,
        103.2580000
    );

-- Data-only validation: one store, 10 riders, 27 customers, and other project tables remain empty.
-- Also prevent duplicate/overlapping customer pins and ensure the full customer set is in store radius.
DO $$
DECLARE
    store_count INTEGER;
    rider_count INTEGER;
    customer_count INTEGER;
    other_rows BIGINT;
    max_distance_km DOUBLE PRECISION;
    minimum_customer_gap_km DOUBLE PRECISION;
BEGIN
    SELECT COUNT(*) INTO store_count FROM stores;
    SELECT COUNT(*) INTO rider_count FROM riders;
    SELECT COUNT(*) INTO customer_count FROM customers;
    SELECT (SELECT COUNT(*) FROM orders)
         + (SELECT COUNT(*) FROM route_plans)
         + (SELECT COUNT(*) FROM route_stops)
      INTO other_rows;

    IF store_count <> 1 OR rider_count <> 10 OR customer_count <> 27 OR other_rows <> 0 THEN
        RAISE EXCEPTION 'Seed data count check failed: stores %, riders %, customers %, other table rows %',
            store_count, rider_count, customer_count, other_rows;
    END IF;

    SELECT MAX(6371 * 2 * ASIN(SQRT(LEAST(1.0,
        POWER(SIN(RADIANS(c.latitude - s.latitude) / 2), 2) +
        COS(RADIANS(s.latitude)) * COS(RADIANS(c.latitude)) *
        POWER(SIN(RADIANS(c.longitude - s.longitude) / 2), 2)
    ))))
      INTO max_distance_km
      FROM customers AS c
      CROSS JOIN stores AS s;

    IF max_distance_km > 3 THEN
        RAISE EXCEPTION 'Customer outside the 3 km store radius: maximum is % km', max_distance_km;
    END IF;

    SELECT MIN(6371 * 2 * ASIN(SQRT(LEAST(1.0,
        POWER(SIN(RADIANS(a.latitude - b.latitude) / 2), 2) +
        COS(RADIANS(a.latitude)) * COS(RADIANS(b.latitude)) *
        POWER(SIN(RADIANS(a.longitude - b.longitude) / 2), 2)
    ))))
      INTO minimum_customer_gap_km
      FROM customers AS a
      JOIN customers AS b ON a.customer_id < b.customer_id;

    IF minimum_customer_gap_km < 0.05 THEN
        RAISE EXCEPTION 'Customer pins overlap: closest pair is only % km apart', minimum_customer_gap_km;
    END IF;

    RAISE NOTICE 'Seed validated: % store, % customers; farthest customer is % km; closest customer pair is % km.',
        store_count, customer_count, round(max_distance_km::numeric, 3),
        round(minimum_customer_gap_km::numeric, 3);
END;
$$;
-- ===== ORDERS SEED: จำลองออเดอร์เข้าพร้อมกัน 20-30 รายการ =====
INSERT INTO
    orders (
        customer_id,
        box_quantity,
        order_date,
        status
    )
VALUES (1, 2, CURRENT_DATE, 'PENDING'),
    (2, 3, CURRENT_DATE, 'PENDING'),
    (3, 1, CURRENT_DATE, 'PENDING'),
    (4, 2, CURRENT_DATE, 'PENDING'),
    (5, 3, CURRENT_DATE, 'PENDING'),
    (6, 1, CURRENT_DATE, 'PENDING'),
    (7, 2, CURRENT_DATE, 'PENDING'),
    (8, 2, CURRENT_DATE, 'PENDING'),
    (9, 3, CURRENT_DATE, 'PENDING'),
    (
        10,
        1,
        CURRENT_DATE,
        'PENDING'
    ),
    (
        11,
        2,
        CURRENT_DATE,
        'PENDING'
    ),
    (
        12,
        3,
        CURRENT_DATE,
        'PENDING'
    ),
    (
        13,
        1,
        CURRENT_DATE,
        'PENDING'
    ),
    (
        14,
        2,
        CURRENT_DATE,
        'PENDING'
    ),
    (
        15,
        2,
        CURRENT_DATE,
        'PENDING'
    ),
    (
        16,
        3,
        CURRENT_DATE,
        'PENDING'
    ),
    (
        17,
        1,
        CURRENT_DATE,
        'PENDING'
    ),
    (
        18,
        2,
        CURRENT_DATE,
        'PENDING'
    ),
    (
        19,
        3,
        CURRENT_DATE,
        'PENDING'
    ),
    (
        20,
        1,
        CURRENT_DATE,
        'PENDING'
    ),
    (
        21,
        2,
        CURRENT_DATE,
        'PENDING'
    ),
    (1, 1, CURRENT_DATE, 'PENDING'),
    (5, 2, CURRENT_DATE, 'PENDING'),
    (
        23,
        3,
        CURRENT_DATE,
        'PENDING'
    ),
    (
        25,
        1,
        CURRENT_DATE,
        'PENDING'
    );

-- Sample route assignments for Rider worksheet testing.
-- The worksheet code belongs to route_plans and each sample plan is assigned to one rider.
INSERT INTO route_plans (
    store_id,
    route_date,
    version,
    status,
    total_distance,
    estimated_minutes,
    total_cost,
    total_revenue,
    total_profit,
    worksheet_code
)
VALUES
    (1, CURRENT_DATE, 1, 'SELECTED', 1.80, 12, 36.00, 390.00, 354.00, 'WORK-R01-DEMO'),
    (1, CURRENT_DATE, 1, 'SELECTED', 2.10, 15, 42.00, 390.00, 348.00, 'WORK-R02-DEMO'),
    (1, CURRENT_DATE, 1, 'SELECTED', 1.60, 11, 33.00, 455.00, 422.00, 'WORK-R03-DEMO'),
    (1, CURRENT_DATE, 1, 'SELECTED', 2.40, 17, 48.00, 390.00, 342.00, 'WORK-R04-DEMO'),
    (1, CURRENT_DATE, 1, 'SELECTED', 1.50, 10, 30.00, 325.00, 295.00, 'WORK-R05-DEMO'),
    (1, CURRENT_DATE, 1, 'SELECTED', 1.70, 12, 34.00, 260.00, 226.00, 'WORK-R06-DEMO'),
    (1, CURRENT_DATE, 1, 'SELECTED', 2.20, 15, 44.00, 325.00, 281.00, 'WORK-R07-DEMO'),
    (1, CURRENT_DATE, 1, 'SELECTED', 1.40, 10, 28.00, 195.00, 167.00, 'WORK-R08-DEMO'),
    (1, CURRENT_DATE, 1, 'SELECTED', 1.30, 9, 26.00, 195.00, 169.00, 'WORK-R09-DEMO'),
    (1, CURRENT_DATE, 1, 'SELECTED', 1.90, 13, 38.00, 260.00, 222.00, 'WORK-R10-DEMO');

INSERT INTO route_stops (
    route_plan_id,
    rider_id,
    order_id,
    stop_sequence,
    distance_from_previous,
    estimated_arrival,
    delivery_status
)
VALUES
    (1, 1, 1, 1, 0.40, CURRENT_TIMESTAMP + INTERVAL '8 minutes', 'PENDING'),
    (1, 1, 2, 2, 0.60, CURRENT_TIMESTAMP + INTERVAL '12 minutes', 'PENDING'),
    (1, 1, 3, 3, 0.80, CURRENT_TIMESTAMP + INTERVAL '16 minutes', 'PENDING'),
    (2, 2, 4, 1, 0.50, CURRENT_TIMESTAMP + INTERVAL '9 minutes', 'PENDING'),
    (2, 2, 5, 2, 0.70, CURRENT_TIMESTAMP + INTERVAL '14 minutes', 'PENDING'),
    (2, 2, 6, 3, 0.90, CURRENT_TIMESTAMP + INTERVAL '19 minutes', 'PENDING'),
    (3, 3, 7, 1, 0.30, CURRENT_TIMESTAMP + INTERVAL '7 minutes', 'PENDING'),
    (3, 3, 8, 2, 0.50, CURRENT_TIMESTAMP + INTERVAL '11 minutes', 'PENDING'),
    (3, 3, 9, 3, 0.80, CURRENT_TIMESTAMP + INTERVAL '16 minutes', 'PENDING'),
    (4, 4, 10, 1, 0.60, CURRENT_TIMESTAMP + INTERVAL '10 minutes', 'PENDING'),
    (4, 4, 11, 2, 0.80, CURRENT_TIMESTAMP + INTERVAL '15 minutes', 'PENDING'),
    (4, 4, 12, 3, 1.00, CURRENT_TIMESTAMP + INTERVAL '21 minutes', 'PENDING'),
    (5, 5, 13, 1, 0.40, CURRENT_TIMESTAMP + INTERVAL '8 minutes', 'PENDING'),
    (5, 5, 14, 2, 0.70, CURRENT_TIMESTAMP + INTERVAL '13 minutes', 'PENDING'),
    (5, 5, 15, 3, 0.40, CURRENT_TIMESTAMP + INTERVAL '17 minutes', 'PENDING'),
    (6, 6, 16, 1, 0.60, CURRENT_TIMESTAMP + INTERVAL '10 minutes', 'PENDING'),
    (6, 6, 17, 2, 1.10, CURRENT_TIMESTAMP + INTERVAL '17 minutes', 'PENDING'),
    (7, 7, 18, 1, 0.50, CURRENT_TIMESTAMP + INTERVAL '9 minutes', 'PENDING'),
    (7, 7, 19, 2, 1.20, CURRENT_TIMESTAMP + INTERVAL '16 minutes', 'PENDING'),
    (8, 8, 20, 1, 0.60, CURRENT_TIMESTAMP + INTERVAL '10 minutes', 'PENDING'),
    (8, 8, 21, 2, 0.80, CURRENT_TIMESTAMP + INTERVAL '15 minutes', 'PENDING'),
    (9, 9, 22, 1, 0.50, CURRENT_TIMESTAMP + INTERVAL '9 minutes', 'PENDING'),
    (9, 9, 23, 2, 0.80, CURRENT_TIMESTAMP + INTERVAL '14 minutes', 'PENDING'),
    (10, 10, 24, 1, 0.70, CURRENT_TIMESTAMP + INTERVAL '11 minutes', 'PENDING'),
    (10, 10, 25, 2, 1.20, CURRENT_TIMESTAMP + INTERVAL '18 minutes', 'PENDING');

DO $$
DECLARE
    route_plan_count INTEGER;
    route_stop_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO route_plan_count FROM route_plans WHERE route_date = CURRENT_DATE;
    SELECT COUNT(*) INTO route_stop_count FROM route_stops WHERE route_plan_id IN (
        SELECT route_plan_id FROM route_plans WHERE route_date = CURRENT_DATE
    );

    IF route_plan_count <> 10 OR route_stop_count <> 25 THEN
        RAISE EXCEPTION 'ตัวอย่างใบงานไม่ครบ: route_plans %, route_stops %', route_plan_count, route_stop_count;
    END IF;

    RAISE NOTICE 'สร้างข้อมูลตัวอย่างใบงานสำเร็จ: % ใบงาน, % จุดส่ง', route_plan_count, route_stop_count;
END;
$$;

DO $$
DECLARE
    order_count INTEGER;
    total_boxes INTEGER;
BEGIN
    SELECT COUNT(*) INTO order_count FROM orders WHERE order_date = CURRENT_DATE;
    SELECT COALESCE(SUM(box_quantity), 0) INTO total_boxes FROM orders WHERE order_date = CURRENT_DATE;

    IF order_count < 20 OR order_count > 30 THEN
        RAISE EXCEPTION 'จำนวนออเดอร์ไม่อยู่ในช่วง 20-30 ตามโจทย์: มี % รายการ', order_count;
    END IF;

    RAISE NOTICE 'สร้างออเดอร์สำเร็จ: % รายการ รวม % กล่อง', order_count, total_boxes;
END;
$$;
-- Useful review query after the seed runs: inspect each customer distance from the store.
SELECT c.customer_id, c.first_name, c.last_name, c.address,
       c.latitude, c.longitude,
       ROUND((6371 * 2 * ASIN(SQRT(LEAST(1.0,
           POWER(SIN(RADIANS(c.latitude - s.latitude) / 2), 2) +
           COS(RADIANS(s.latitude)) * COS(RADIANS(c.latitude)) *
           POWER(SIN(RADIANS(c.longitude - s.longitude) / 2), 2)
       ))))::numeric, 3) AS distance_km
FROM customers AS c
CROSS JOIN stores AS s
ORDER BY distance_km, c.customer_id;

COMMIT;
