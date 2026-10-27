-- Rider Project: PostgreSQL schema + spatially clustered seed data
-- PostgreSQL 14+ / UTF-8 / single restaurant
-- This script resets the six project tables in the current database. Use a test database.
-- All names, phone numbers, room labels and customer points are synthetic.
-- Exactly 27 customers and 27 orders are seeded: 9 spatial clusters x 3 customers.
-- This matches the rule that one rider handles no more than 3 orders.
-- The route API must still calculate and may choose a different grouping; the cluster order is only a useful test baseline.
-- Public map anchors used for realistic locations:
--   MSU Kham Riang: 16.24704, 103.24936 (https://mapcarta.com/W546649821)
--   Store test point on named road หน้า HS - ศาลหลักเมือง: 16.2443350, 103.2494546
--   Arunchai Grand 66RV+8J9: 16.2408125, 103.2440625
--   James Bond Mansion 66RV+R9W: 16.2420625, 103.2434375
--   The Best OSM building: 16.2359123, 103.2560879
--   PP Apartment OSM point: 16.2372539, 103.2634158
--   Dorm reference list: https://building.msu.ac.th/dorm_network_public_page_2569/index.php?area=&q=

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
    latitude NUMERIC(10,7) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude NUMERIC(10,7) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
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
    latitude NUMERIC(10,7) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude NUMERIC(10,7) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE riders (
    rider_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    vehicle_plate VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'BUSY', 'INACTIVE')) ,
    max_orders_per_route SMALLINT NOT NULL DEFAULT 3 CHECK (max_orders_per_route BETWEEN 1 AND 3)
);

CREATE TABLE orders (
    order_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(customer_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    box_quantity SMALLINT NOT NULL CHECK (box_quantity BETWEEN 1 AND 3),
    order_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ASSIGNED', 'DELIVERING', 'DELIVERED', 'CANCELLED')) ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE route_plans (
    route_plan_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    store_id INTEGER NOT NULL REFERENCES stores(store_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    route_date DATE NOT NULL,
    version INTEGER NOT NULL CHECK (version >= 1),
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SELECTED', 'REJECTED', 'COMPLETED')) ,
    total_distance NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (total_distance >= 0),
    estimated_minutes INTEGER NOT NULL DEFAULT 0 CHECK (estimated_minutes >= 0),
    total_cost NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
    total_revenue NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (total_revenue >= 0),
    total_profit NUMERIC(10,2) NOT NULL DEFAULT 0,
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    worksheet_code VARCHAR(30) NOT NULL UNIQUE
);

CREATE TABLE route_stops (
    route_stop_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    route_plan_id INTEGER NOT NULL REFERENCES route_plans(route_plan_id) ON UPDATE CASCADE ON DELETE CASCADE,
    rider_id INTEGER NOT NULL REFERENCES riders(rider_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    order_id INTEGER NOT NULL REFERENCES orders(order_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    stop_sequence INTEGER NOT NULL CHECK (stop_sequence >= 1),
    distance_from_previous NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (distance_from_previous >= 0),
    estimated_arrival TIMESTAMPTZ,
    delivery_status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (delivery_status IN ('PENDING', 'DELIVERED', 'FAILED')) ,
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

INSERT INTO stores (store_name, phone, address, latitude, longitude, is_active) VALUES
('ข้าวกล่องเดลิเวอรี ขามเรียง (ข้อมูลจำลอง)', '0900000000', 'จุดร้านจำลองบนถนนหน้า HS - ศาลหลักเมือง ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม', 16.2443350, 103.2494546, TRUE);

INSERT INTO riders (name, phone, vehicle_plate, status, max_orders_per_route) VALUES
('ไรเดอร์ทดสอบ 1', '0890000001', 'มค-1001', 'AVAILABLE', 3),
('ไรเดอร์ทดสอบ 2', '0890000002', 'มค-1002', 'AVAILABLE', 3),
('ไรเดอร์ทดสอบ 3', '0890000003', 'มค-1003', 'AVAILABLE', 3),
('ไรเดอร์ทดสอบ 4', '0890000004', 'มค-1004', 'AVAILABLE', 3),
('ไรเดอร์ทดสอบ 5', '0890000005', 'มค-1005', 'AVAILABLE', 3),
('ไรเดอร์ทดสอบ 6', '0890000006', 'มค-1006', 'AVAILABLE', 3),
('ไรเดอร์ทดสอบ 7', '0890000007', 'มค-1007', 'AVAILABLE', 3),
('ไรเดอร์ทดสอบ 8', '0890000008', 'มค-1008', 'AVAILABLE', 3),
('ไรเดอร์ทดสอบ 9', '0890000009', 'มค-1009', 'AVAILABLE', 3);

INSERT INTO customers (first_name, last_name, phone, address, latitude, longitude) VALUES
('ธนกฤต', 'แสงทอง', '0900000001', 'Arunchai Grand, จุดทดสอบกลุ่ม 1-1, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม', 16.2408125, 103.2440625), -- cluster 1: ARUNCHAI
('พิมพ์ชนก', 'วัฒนชัย', '0900000002', 'Arunchai Grand, จุดทดสอบกลุ่ม 1-2, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม', 16.2409000, 103.2439000), -- cluster 1: ARUNCHAI
('ณัฐวุฒิ', 'คำดี', '0900000003', 'Arunchai Grand, จุดทดสอบกลุ่ม 1-3, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม', 16.2407000, 103.2442000), -- cluster 1: ARUNCHAI
('ชลธิชา', 'ศรีสุข', '0900000004', 'เจมส์บอนด์แมนชั่น, จุดทดสอบกลุ่ม 2-1, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม', 16.2420625, 103.2434375), -- cluster 2: JAMES_BOND
('ภาคิน', 'บุญมี', '0900000005', 'เจมส์บอนด์แมนชั่น, จุดทดสอบกลุ่ม 2-2, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม', 16.2422000, 103.2433000), -- cluster 2: JAMES_BOND
('กัญญารัตน์', 'อินทร์คำ', '0900000006', 'เจมส์บอนด์แมนชั่น, จุดทดสอบกลุ่ม 2-3, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม', 16.2419500, 103.2436000), -- cluster 2: JAMES_BOND
('ศุภกร', 'วิเศษวงศ์', '0900000007', 'โซนโรงเรียนสาธิต มมส., จุดทดสอบกลุ่ม 3-1, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม', 16.2450100, 103.2462300), -- cluster 3: DEMO_SCHOOL
('อรปรียา', 'มณีรัตน์', '0900000008', 'โซนโรงเรียนสาธิต มมส., จุดทดสอบกลุ่ม 3-2, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม', 16.2451200, 103.2461000), -- cluster 3: DEMO_SCHOOL
('วรเมธ', 'จันทร์ดี', '0900000009', 'โซนโรงเรียนสาธิต มมส., จุดทดสอบกลุ่ม 3-3, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม', 16.2449000, 103.2463500), -- cluster 3: DEMO_SCHOOL
('มนัสวี', 'พูนทรัพย์', '0900000010', 'โซนคณะวิทยาการสารสนเทศ มมส., จุดทดสอบกลุ่ม 4-1, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม', 16.2466800, 103.2519900), -- cluster 4: MSU_INFO
('กิตติศักดิ์', 'ไชยรัตน์', '0900000011', 'โซนคณะวิทยาการสารสนเทศ มมส., จุดทดสอบกลุ่ม 4-2, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม', 16.2468000, 103.2518500), -- cluster 4: MSU_INFO
('ณิชาภา', 'แสนคำ', '0900000012', 'โซนคณะวิทยาการสารสนเทศ มมส., จุดทดสอบกลุ่ม 4-3, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม', 16.2465500, 103.2521000), -- cluster 4: MSU_INFO
('ปกรณ์', 'วงศ์สวัสดิ์', '0900000013', 'โซนหอพักกุดรัง มมส., จุดทดสอบกลุ่ม 5-1, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม', 16.2478000, 103.2468000), -- cluster 5: KUDRANG
('สิริกานต์', 'คงมั่น', '0900000014', 'โซนหอพักกุดรัง มมส., จุดทดสอบกลุ่ม 5-2, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม', 16.2479500, 103.2466500), -- cluster 5: KUDRANG
('ธนภัทร', 'มีสุข', '0900000015', 'โซนหอพักกุดรัง มมส., จุดทดสอบกลุ่ม 5-3, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม', 16.2476500, 103.2469500), -- cluster 5: KUDRANG
('นันทิชา', 'ทองใบ', '0900000016', 'โซนหอพักซอยศรีสะอาด, จุดทดสอบกลุ่ม 6-1, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม', 16.2512369, 103.2432242), -- cluster 6: SRI_SA_AD_SOUTH
('ชยพล', 'แก้วคำ', '0900000017', 'โซนหอพักซอยศรีสะอาด, จุดทดสอบกลุ่ม 6-2, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม', 16.2514500, 103.2433500), -- cluster 6: SRI_SA_AD_SOUTH
('รินรดา', 'สุขเกษม', '0900000018', 'โซนหอพักซอยศรีสะอาด, จุดทดสอบกลุ่ม 6-3, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม', 16.2510500, 103.2431000), -- cluster 6: SRI_SA_AD_SOUTH
('ก้องภพ', 'ศรีอุดม', '0900000019', 'โซนหอพักซอยศรีสะอาดด้านเหนือ, จุดทดสอบกลุ่ม 7-1, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม', 16.2545078, 103.2445734), -- cluster 7: SRI_SA_AD_NORTH
('ปาริชาติ', 'บุญส่ง', '0900000020', 'โซนหอพักซอยศรีสะอาดด้านเหนือ, จุดทดสอบกลุ่ม 7-2, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม', 16.2546500, 103.2447000), -- cluster 7: SRI_SA_AD_NORTH
('เอกภพ', 'ศรีสะอาด', '0900000021', 'โซนหอพักซอยศรีสะอาดด้านเหนือ, จุดทดสอบกลุ่ม 7-3, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม', 16.2543500, 103.2444500), -- cluster 7: SRI_SA_AD_NORTH
('วาสนา', 'แสงจันทร์', '0900000022', 'หอพักเดอะเบสท์, จุดทดสอบกลุ่ม 8-1, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม', 16.2359123, 103.2560879), -- cluster 8: THE_BEST
('ธีรภัทร', 'คงทอง', '0900000023', 'หอพักเดอะเบสท์, จุดทดสอบกลุ่ม 8-2, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม', 16.2360500, 103.2559000), -- cluster 8: THE_BEST
('สุภาวดี', 'มานะดี', '0900000024', 'หอพักเดอะเบสท์, จุดทดสอบกลุ่ม 8-3, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม', 16.2357500, 103.2562500), -- cluster 8: THE_BEST
('กฤตภาส', 'จันทร์หอม', '0900000025', 'พีพี อพาร์ทเมนท์, จุดทดสอบกลุ่ม 9-1, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม', 16.2372539, 103.2634158), -- cluster 9: PP_APARTMENT
('ณัฐชา', 'ภักดี', '0900000026', 'พีพี อพาร์ทเมนท์, จุดทดสอบกลุ่ม 9-2, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม', 16.2374000, 103.2632500), -- cluster 9: PP_APARTMENT
('พีรวิชญ์', 'ทองคำ', '0900000027', 'พีพี อพาร์ทเมนท์, จุดทดสอบกลุ่ม 9-3, ต.ขามเรียง อ.กันทรวิชัย จ.มหาสารคาม', 16.2371000, 103.2636000); -- cluster 9: PP_APARTMENT

INSERT INTO orders (customer_id, box_quantity, order_date, status)
SELECT c.customer_id, v.box_quantity, CURRENT_DATE, 'PENDING'
FROM (VALUES
    ('0900000001', 1),
    ('0900000002', 2),
    ('0900000003', 3),
    ('0900000004', 1),
    ('0900000005', 2),
    ('0900000006', 3),
    ('0900000007', 1),
    ('0900000008', 2),
    ('0900000009', 3),
    ('0900000010', 1),
    ('0900000011', 2),
    ('0900000012', 3),
    ('0900000013', 1),
    ('0900000014', 2),
    ('0900000015', 3),
    ('0900000016', 1),
    ('0900000017', 2),
    ('0900000018', 3),
    ('0900000019', 1),
    ('0900000020', 2),
    ('0900000021', 3),
    ('0900000022', 1),
    ('0900000023', 2),
    ('0900000024', 3),
    ('0900000025', 1),
    ('0900000026', 2),
    ('0900000027', 3)
) AS v(phone, box_quantity)
JOIN customers AS c ON c.phone = v.phone
ORDER BY c.customer_id;

-- Baseline spatial grouping for manual inspection (the API must recalculate):
-- baseline rider 1 -> orders 1-3, rider 2 -> orders 4-6, ..., rider 9 -> orders 25-27.
-- Each baseline group contains 3 orders and 6 boxes (1 + 2 + 3).
-- route_plans and route_stops remain empty until the route-calculation API creates a version.
-- All identity columns are intentionally omitted from seed INSERT statements.

-- Example 1 km customer search (replace :lat and :lon with the requested point):
-- SELECT c.*, 6371 * 2 * ASIN(SQRT(POWER(SIN(RADIANS(c.latitude - :lat) / 2), 2)
--        + COS(RADIANS(:lat)) * COS(RADIANS(c.latitude))
--        * POWER(SIN(RADIANS(c.longitude - :lon) / 2), 2))) AS distance_km
-- FROM customers c
-- WHERE 6371 * 2 * ASIN(SQRT(POWER(SIN(RADIANS(c.latitude - :lat) / 2), 2)
--        + COS(RADIANS(:lat)) * COS(RADIANS(c.latitude))
--        * POWER(SIN(RADIANS(c.longitude - :lon) / 2), 2))) <= 1;

COMMIT;
