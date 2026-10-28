import assert from "node:assert/strict";
import { once } from "node:events";
import { mock, test } from "node:test";
import { Pool } from "pg";
import { BUSINESS_DATE_SQL } from "../database/business-date.js";
import { confirmSelectedPlan, parseSelectedPlan, PlanError, selectedTripMetrics, type SelectedPlan } from "./selected-plan.js";

const store = { latitude: 16.244335, longitude: 103.2494546 };
const orders = [101, 102, 103].map((orderId, index) => ({
  orderId, customerId: orderId, boxQuantity: index + 1,
  latitude: store.latitude + (index + 1) * 0.001,
  longitude: store.longitude + (index % 2 ? -0.002 : 0.001),
}));
const body = (): SelectedPlan => ({
  routeDate: "2026-10-26", storeId: 1, storeLatitude: store.latitude, storeLongitude: store.longitude,
  orders: structuredClone(orders), trips: [{ riderId: 41, orderIds: [103, 101, 102] }],
});

test("rejects an absent plan instead of running a second optimizer", () => {
  for (const input of [null, {}, [], { trips: [], orders: [] }]) {
    assert.throws(() => parseSelectedPlan(input), PlanError);
  }
});

test("rejects duplicate orders, mismatched snapshots and repeated riders", () => {
  for (const change of [
    (value: SelectedPlan) => { value.trips[0]!.orderIds = [101, 101, 103]; },
    (value: SelectedPlan) => { value.orders.pop(); },
    (value: SelectedPlan) => { value.trips = [{ riderId: 41, orderIds: [101] }, { riderId: 41, orderIds: [102, 103] }]; },
    (value: SelectedPlan) => { value.trips[0]!.orderIds.push(104); },
    (value: SelectedPlan) => { value.orders[0]!.boxQuantity = 4; },
    (value: SelectedPlan) => { value.orders[0]!.latitude = Number.NaN; },
    (value: SelectedPlan) => { value.routeDate = "2026-02-30"; },
    (value: SelectedPlan) => { value.routeDate = "2026-99-99"; },
  ]) {
    const value = body();
    change(value);
    assert.throws(() => parseSelectedPlan(value), PlanError);
  }
});

test("recalculates the chosen order without reordering and matches the frontend cost and ETA", async () => {
  // Dynamic imports keep this cross-project contract test out of the backend application build.
  const distanceModule = new URL("../../frontend/src/app/pages/delivery-routes/planning/route-distance.ts", import.meta.url).href;
  const timingModule = new URL("../../frontend/src/app/pages/delivery-routes/planning/route-timing.ts", import.meta.url).href;
  const costModule = new URL("../../frontend/src/app/pages/delivery-routes/planning/route-cost.ts", import.meta.url).href;
  const { calculateRouteDistance } = await import(distanceModule);
  const { calculateRouteTiming } = await import(timingModule);
  const { calculateTripCost } = await import(costModule);
  for (const indices of [[2, 0, 1], [0, 1, 2], [1, 2, 0]]) {
    const selected = indices.map((index) => orders[index]!);
    const route = calculateRouteDistance(store, selected);
    const timing = calculateRouteTiming(route);
    const cost = calculateTripCost({ totalBoxes: 6, route, timing }, true);
    const server = selectedTripMetrics(store, selected);
    assert.deepEqual(server.stops.map((stop) => stop.orderId), selected.map((order) => order.orderId));
    assert.ok(Math.abs(server.totalDistanceKm - route.totalDistanceKm) < 1e-9);
    assert.ok(Math.abs(server.totalCost - cost.totalCost) < 1e-9);
    assert.ok(Math.abs(server.profit - cost.profit) < 1e-9);
    assert.deepEqual(server.stops.map((stop) => stop.arrivalMinute), timing.stops.map((stop: { arrivalMinute: number }) => stop.arrivalMinute));
  }
});

test("penalties are per late order, and food and dispatch are included in total cost", () => {
  const metrics = selectedTripMetrics(store, [{ ...orders[0]!, latitude: store.latitude + 1, boxQuantity: 3 }]);
  assert.equal(metrics.penalty, 20);
  assert.equal(metrics.totalCost, Number((120 + 15 + metrics.totalDistanceKm * 6 + 20).toFixed(2)));
  assert.equal(metrics.profit, Number((195 - metrics.totalCost).toFixed(2)));
});

test("road calculations include directed return legs and agree with independent money/ETA arithmetic", () => {
  const metrics = selectedTripMetrics(store, orders, [1, 2, 3, 4]);
  assert.equal(metrics.totalDistanceKm, 10);
  assert.deepEqual(metrics.stops.map((stop) => stop.distanceKm), [1, 2, 3]);
  assert.deepEqual(metrics.stops.map((stop) => stop.arrivalMinute), [692, 696, 702]);
  assert.equal(metrics.elapsedMinutes, 20);
  assert.equal(metrics.revenue, 390);
  assert.equal(metrics.totalCost, 240 + 15 + 10 * 6 * 2);
  assert.equal(metrics.profit, 15);
  const late = selectedTripMetrics(store, orders, [30, 0.001, 1, 4]);
  assert.deepEqual(late.stops.map((stop) => stop.isLate), [false, true, true]);
  assert.equal(late.penalty, 40);
  assert.throws(() => selectedTripMetrics(store, orders, [1, 2]), PlanError);
});

test("road requests require complete valid preview leg snapshots", () => {
  for (const legs of [undefined, [1, 2], [1, 2, 3, -1], [1, 2, 3, Number.NaN]]) {
    const value = { ...body(), distanceBasis: "road", trips: [{ riderId: 41, orderIds: [103, 101, 102], roadLegDistancesKm: legs }] };
    assert.throws(() => parseSelectedPlan(value), PlanError);
  }
  assert.throws(() => parseSelectedPlan({ ...body(), distanceBasis: "client-price" }), PlanError);
  assert.equal(parseSelectedPlan(body()).distanceBasis, "haversine");
});

test("a changed or tampered road preview is rejected before obtaining database locks", async () => {
  const connect = mock.fn(async () => { throw new Error("must not connect"); });
  const fetchMock = mock.method(globalThis, "fetch", async () => Response.json({
    code: "Ok", distances: [[0, 1000, 2000, 3000], [1000, 0, 1000, 2000],
      [2000, 1000, 0, 1000], [3000, 2000, 1000, 0]],
  }));
  try {
    const value = { ...body(), distanceBasis: "road", trips: [{ riderId: 41, orderIds: [103, 101, 102], roadLegDistancesKm: [0, 0, 0, 0] }] };
    await assert.rejects(confirmSelectedPlan({ connect } as unknown as Pick<Pool, "connect">, value),
      (error: unknown) => error instanceof PlanError && error.status === 409);
    assert.equal(connect.mock.callCount(), 0);
  } finally { fetchMock.mock.restore(); }
});

// Opt in explicitly: RUN_DB_PLAN_TESTS=1 node --env-file=.env --import tsx --test services/selected-plan.test.ts
// All six tables are TEMP tables under pg_temp. The outer transaction always rolls back.
test("HTTP confirm -> PostgreSQL -> worksheet login -> rider work -> cancel", {
  skip: process.env.RUN_DB_PLAN_TESTS !== "1", timeout: 60000,
}, async (t) => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required for the isolated PostgreSQL test");
  const db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const client = await db.connect();
  let server: ReturnType<(typeof import("../app.js"))["app"]["listen"]> | undefined;
  let applicationPool: Pool | undefined;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path = pg_temp");
    await client.query(`
      CREATE TEMP TABLE stores (store_id int PRIMARY KEY, store_name text, phone text, address text,
        latitude numeric, longitude numeric, is_active boolean DEFAULT TRUE);
      CREATE TEMP TABLE customers (customer_id int PRIMARY KEY, first_name text, last_name text,
        phone text, address text, latitude numeric, longitude numeric);
      CREATE TEMP TABLE riders (rider_id int PRIMARY KEY, name text, phone text, vehicle_plate text,
        status text, max_orders_per_route int);
      CREATE TEMP TABLE orders (order_id int PRIMARY KEY, customer_id int REFERENCES customers,
        box_quantity int CHECK (box_quantity BETWEEN 1 AND 3), order_date date, status text, created_at timestamptz DEFAULT CURRENT_TIMESTAMP);
      CREATE TEMP TABLE route_plans (route_plan_id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        store_id int REFERENCES stores, route_date date, version int, status text,
        total_distance numeric(10,2), estimated_minutes int, total_cost numeric(10,2),
        total_revenue numeric(10,2), total_profit numeric(10,2), calculated_at timestamptz DEFAULT CURRENT_TIMESTAMP,
        worksheet_code varchar(30) UNIQUE);
      CREATE TEMP TABLE route_stops (route_stop_id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        route_plan_id int REFERENCES route_plans, rider_id int REFERENCES riders, order_id int REFERENCES orders,
        stop_sequence int, distance_from_previous numeric(10,2), estimated_arrival timestamptz,
        delivery_status text, delivered_at timestamptz,
        UNIQUE(route_plan_id, stop_sequence), UNIQUE(route_plan_id, order_id));
    `);
    await client.query("INSERT INTO stores VALUES (1, 'ร้านทดสอบ', '000', 'ทดสอบ', $1, $2, TRUE)", [store.latitude, store.longitude]);
    await client.query("INSERT INTO riders VALUES (41, 'ทดสอบ A', '000', 'TEST41', 'AVAILABLE', 3), (42, 'ทดสอบ B', '000', 'TEST42', 'AVAILABLE', 3)");
    const today = (await client.query(`SELECT ${BUSINESS_DATE_SQL}::text AS day`)).rows[0].day as string;
    for (const order of [...orders, { ...orders[0]!, orderId: 104, customerId: 104 }]) {
      await client.query("INSERT INTO customers VALUES ($1, 'ลูกค้า', 'ทดสอบ', '000', 'ทดสอบ', $2, $3)", [order.customerId, order.latitude, order.longitude]);
      await client.query("INSERT INTO orders(order_id, customer_id, box_quantity, order_date, status) VALUES ($1,$2,$3,$4,'PENDING')",
        [order.orderId, order.customerId, order.boxQuantity, today]);
    }
    const query = async (sql: string, values?: unknown[]) => {
      if (sql === "BEGIN") return client.query("SAVEPOINT selected_plan_test");
      if (sql === "COMMIT") return client.query("RELEASE SAVEPOINT selected_plan_test");
      if (sql === "ROLLBACK") {
        await client.query("ROLLBACK TO SAVEPOINT selected_plan_test");
        return client.query("RELEASE SAVEPOINT selected_plan_test");
      }
      return client.query(sql, values);
    };
    const poolModule = await import("../database/pool.js");
    applicationPool = poolModule.pool;
    mock.method(applicationPool, "connect", (async () => ({ query, release() {} })) as unknown as Pool["connect"]);
    mock.method(applicationPool, "query", query as unknown as Pool["query"]);
    const { app } = await import("../app.js");
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const post = (path: string, value: unknown) => fetch(base + path, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value),
    });
    const payload = body();
    payload.routeDate = today;
    payload.trips = [{ riderId: 41, orderIds: [103, 101] }, { riderId: 42, orderIds: [102] }];

    await t.test("loads the real planning store and rejects the old empty generate call", async () => {
      const context = await (await fetch(base + "/route-plans/planning-store")).json();
      assert.equal(context.store.store_id, 1);
      assert.equal(context.businessDate, today);
      assert.equal((await post("/route-plans/generate", {})).status, 400);
      assert.equal((await post("/route-plans/road-matrix", { points: [] })).status, 400);
    });
    await t.test("rejects stale quantity, location, unavailable rider and historical dates without writing", async () => {
      for (const field of ["box_quantity", "latitude"] as const) {
        if (field === "box_quantity") await client.query("UPDATE orders SET box_quantity = 2 WHERE order_id = 101");
        else await client.query("UPDATE customers SET latitude = latitude + 0.001 WHERE customer_id = 101");
        assert.equal((await post("/route-plans/confirm", payload)).status, 409);
        if (field === "box_quantity") await client.query("UPDATE orders SET box_quantity = 1 WHERE order_id = 101");
        else await client.query("UPDATE customers SET latitude = $1 WHERE customer_id = 101", [orders[0]!.latitude]);
      }
      await client.query("UPDATE riders SET status = 'BUSY' WHERE rider_id = 41");
      assert.equal((await post("/route-plans/confirm", payload)).status, 409);
      await client.query("UPDATE riders SET status = 'AVAILABLE' WHERE rider_id = 41");
      assert.equal((await post("/route-plans/confirm", { ...payload, routeDate: "2000-01-01" })).status, 400);
      assert.equal((await client.query("SELECT COUNT(*)::int AS count FROM route_plans")).rows[0].count, 0);
      assert.equal((await client.query("SELECT COUNT(*)::int AS count FROM orders WHERE status <> 'PENDING'")).rows[0].count, 0);
    });
    await t.test("rolls back every plan and order if a stop insert fails halfway", async () => {
      await client.query("ALTER TABLE pg_temp.route_stops ADD CONSTRAINT test_insert_failure CHECK(order_id <> 102)");
      const mutedError = mock.method(console, "error", () => {});
      try {
        assert.equal((await post("/route-plans/confirm", payload)).status, 500);
        assert.equal((await client.query("SELECT COUNT(*)::int AS count FROM route_plans")).rows[0].count, 0);
        assert.equal((await client.query("SELECT COUNT(*)::int AS count FROM route_stops")).rows[0].count, 0);
        assert.equal((await client.query("SELECT COUNT(*)::int AS count FROM orders WHERE status <> 'PENDING'")).rows[0].count, 0);
      } finally {
        mutedError.mock.restore();
        await client.query("ALTER TABLE pg_temp.route_stops DROP CONSTRAINT test_insert_failure");
      }
    });
    let codes: { riderId: number; worksheetCode: string; routePlanId: number }[] = [];
    await t.test("stores exactly the selected rider/order sequence and 11:30 Bangkok ETAs", async () => {
      const response = await post("/route-plans/confirm", payload);
      assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
      codes = (await response.json()).plans;
      const stored = await (await fetch(base + "/route-plans?date=" + today + "&status=SELECTED")).json();
      assert.equal(stored.length, 2);
      for (const code of codes) {
        const trip = payload.trips.find((item) => item.riderId === code.riderId)!;
        const stops = await (await fetch(base + `/route-stops?route_plan_id=${code.routePlanId}`)).json();
        assert.deepEqual(stops.map((stop: { order_id: number }) => stop.order_id), trip.orderIds);
        const expected = selectedTripMetrics(store, trip.orderIds.map((id) => orders.find((order) => order.orderId === id)!));
        const plan = stored.find((item: { route_plan_id: number }) => item.route_plan_id === code.routePlanId);
        assert.equal(Number(plan.total_cost), Number(expected.totalCost.toFixed(2)));
        assert.equal(Number(plan.total_profit), Number(expected.profit.toFixed(2)));
        const midnight = new Date(today + "T00:00:00+07:00").getTime();
        assert.ok(Math.abs(new Date(stops[0].estimated_arrival).getTime() - (midnight + expected.stops[0]!.arrivalMinute * 60000)) < 2);
      }
      assert.equal((await client.query("SELECT status FROM orders WHERE order_id = 104")).rows[0].status, "PENDING");
      assert.equal((await post("/route-plans/confirm", payload)).status, 409);
      assert.equal((await client.query("SELECT COUNT(*)::int AS count FROM route_plans")).rows[0].count, 2);
    });
    await t.test("existing teammate worksheet login and rider work return the same order sequence", async () => {
      for (const code of codes) {
        const login = await post("/rider/auth/worksheet", { worksheetCode: code.worksheetCode });
        assert.equal(login.status, 200);
        const response = await fetch(base + "/rider/work", { headers: { "x-worksheet-code": code.worksheetCode } });
        assert.equal(response.status, 200);
        const { work } = await response.json();
        assert.deepEqual(work.stops.map((stop: { orderId: number }) => stop.orderId), payload.trips.find((trip) => trip.riderId === code.riderId)!.orderIds);
      }
    });
    await t.test("cancel resets only assigned orders, invalidates codes, and allows a new version", async () => {
      assert.equal((await post("/route-plans/cancel-today", {})).status, 200);
      assert.equal((await post("/rider/auth/worksheet", { worksheetCode: codes[0]!.worksheetCode })).status, 401);
      assert.equal((await client.query("SELECT COUNT(*)::int AS count FROM orders WHERE status = 'PENDING'")).rows[0].count, 4);
      const retry = await post("/route-plans/confirm", payload);
      assert.equal(retry.status, 201);
      codes = (await retry.json()).plans;
      assert.ok(codes.every((code) => code.worksheetCode.includes("V2")));
    });
    await t.test("road preview and confirmation persist the same trusted legs, costs, return and ETAs", async () => {
      assert.equal((await post("/route-plans/cancel-today", {})).status, 200);
      const actualFetch = globalThis.fetch;
      const providerFetch = mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).startsWith("https://router.project-osrm.org/")) {
          return Response.json({ code: "Ok", distances: [
            [0, 1000, 2000, 3000], [1000, 0, 1000, 2000],
            [2000, 1000, 0, 1000], [3000, 2000, 1000, 0],
          ] });
        }
        return actualFetch(input, init);
      });
      try {
        const previewResponse = await post("/route-plans/road-matrix", { points: [store, ...orders] });
        assert.equal(previewResponse.status, 200);
        const preview = await previewResponse.json();
        assert.equal(preview.distanceBasis, "road");
        assert.equal(preview.distancesKm[0][3], 3);
        const roadPayload = { ...payload, distanceBasis: "road", trips: [
          { riderId: 41, orderIds: [103, 101], roadLegDistancesKm: [3, 2, 1] },
          { riderId: 42, orderIds: [102], roadLegDistancesKm: [2, 2] },
        ] };
        const confirmed = await post("/route-plans/confirm", roadPayload);
        assert.equal(confirmed.status, 201, JSON.stringify(await confirmed.clone().json()));
        const result = await confirmed.json();
        assert.equal(result.distanceBasis, "road");
        codes = result.plans;
        for (const code of codes) {
          const trip = roadPayload.trips.find((item) => item.riderId === code.riderId)!;
          const expected = selectedTripMetrics(store,
            trip.orderIds.map((id) => orders.find((order) => order.orderId === id)!), trip.roadLegDistancesKm);
          const plan = (await client.query("SELECT * FROM route_plans WHERE route_plan_id = $1", [code.routePlanId])).rows[0];
          const stops = (await client.query("SELECT * FROM route_stops WHERE route_plan_id = $1 ORDER BY stop_sequence", [code.routePlanId])).rows;
          assert.equal(Number(plan.total_distance), expected.totalDistanceKm);
          assert.equal(Number(plan.total_cost), expected.totalCost);
          assert.equal(Number(plan.total_revenue), expected.revenue);
          assert.equal(Number(plan.total_profit), expected.profit);
          assert.equal(plan.estimated_minutes, Math.ceil(expected.elapsedMinutes));
          assert.deepEqual(stops.map((stop) => Number(stop.distance_from_previous)), trip.roadLegDistancesKm.slice(0, -1));
          const midnight = new Date(today + "T00:00:00+07:00").getTime();
          assert.deepEqual(stops.map((stop) => new Date(stop.estimated_arrival).getTime()),
            expected.stops.map((stop) => midnight + stop.arrivalMinute * 60000));
        }
      } finally { providerFetch.mock.restore(); }
    });
    await t.test("delivery status update still works and prevents canceling a started worksheet", async () => {
      const code = codes[0]!;
      const stops = await (await fetch(base + `/route-stops?route_plan_id=${code.routePlanId}`)).json();
      const delivery = await fetch(base + `/route-stops/${stops[0].route_stop_id}/status`, {
        method: "PATCH", headers: { "Content-Type": "application/json", "x-worksheet-code": code.worksheetCode },
        body: JSON.stringify({ deliveryStatus: "DELIVERED" }),
      });
      assert.equal(delivery.status, 200);
      assert.equal((await post("/route-plans/cancel-today", {})).status, 409);
      assert.equal((await client.query("SELECT status FROM orders WHERE order_id = $1", [stops[0].order_id])).rows[0].status, "DELIVERED");
    });
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    mock.restoreAll();
    await client.query("ROLLBACK");
    client.release();
    await db.end();
    if (applicationPool) await applicationPool.end();
  }
});
