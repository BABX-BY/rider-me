import { describe, expect, it } from 'vitest';
import type { Order } from '../../../model/order.model';
import type { Rider } from '../../../model/rider.model';
import { preparePlanningOrders } from '../planning/planning-orders';
import { planDeliveryRoutes } from '../planning/route-planner';
import { toRouteViews } from './route-view-adapter';

const store = { latitude: 16.244335, longitude: 103.2494546 };
const rider: Rider = {
  rider_id: 41,
  name: 'ไรเดอร์ทดสอบ',
  phone: '0000000000',
  vehicle_plate: 'ทดสอบ 41',
  status: 'AVAILABLE',
  max_orders_per_route: 1,
};

function order(id: number): Order {
  return {
    order_id: id,
    customer_id: 9,
    box_quantity: 1,
    order_date: '2026-10-11',
    status: 'PENDING',
    created_at: '2026-10-11T03:00:00Z',
    is_simulated: true,
    customer_first_name: 'ลูกค้าทดสอบ',
    customer_last_name: 'คนเดิม',
    customer_phone: '0000000000',
    customer_address: 'ที่อยู่ทดสอบ',
    customer_latitude: '16.245',
    customer_longitude: '103.250',
  };
}

describe('toRouteViews', () => {
  it('keeps a rider color stable when an alternative uses a different rider subset', () => {
    const roster = [{ ...rider, rider_id: 1 }, rider];
    const prepared = preparePlanningOrders(store, '2026-10-11', [order(101), order(102)]);
    const routing = prepared.items.map((item) => item.routing);
    const oneRiderPlan = planDeliveryRoutes(store, routing, [rider], {
      includeReturnDistance: true,
    });
    const twoRiderPlan = planDeliveryRoutes(store, routing, roster, {
      includeReturnDistance: true,
    });

    const first = toRouteViews(oneRiderPlan, prepared, roster);
    const second = toRouteViews(twoRiderPlan, prepared, roster);

    expect(first[0].color).toBe(second.find((view) => view.riderId === rider.rider_id)?.color);
  });

  it('keeps separate orders for the same customer and unique trips for one rider', () => {
    const prepared = preparePlanningOrders(store, '2026-10-11', [order(101), order(102)]);
    const plan = planDeliveryRoutes(
      store,
      prepared.items.map((item) => item.routing),
      [rider],
      {
        includeReturnDistance: true,
      },
    );

    const views = toRouteViews(plan, prepared, [rider]);

    expect(views).toHaveLength(2);
    expect(new Set(views.map((view) => view.id)).size).toBe(2);
    expect(views.map((view) => view.riderId)).toEqual([41, 41]);
    expect(views.map((view) => view.roundNumber)).toEqual([1, 2]);
    expect(views[0].color).toBe(views[1].color);
    expect(views.flatMap((view) => view.stops.map((stop) => stop.id))).toEqual([101, 102]);
    expect(views[0].plate).toBe('ทดสอบ 41');
    expect(views[0].stops[0]).toMatchObject({
      customer: 'ลูกค้าทดสอบ คนเดิม',
      phone: '0000000000',
      address: 'ที่อยู่ทดสอบ',
      latitude: 16.245,
      longitude: 103.25,
    });
  });

  it('matches customer details by order ID even when prepared items change order', () => {
    const first = { ...order(101), customer_first_name: 'ลูกค้า A' };
    const second = { ...order(102), customer_first_name: 'ลูกค้า B' };
    const prepared = preparePlanningOrders(store, '2026-10-11', [first, second]);
    const plan = planDeliveryRoutes(
      store,
      prepared.items.map((item) => item.routing),
      [rider],
      {
        includeReturnDistance: true,
      },
    );

    const views = toRouteViews(plan, { ...prepared, items: [...prepared.items].reverse() }, [
      rider,
    ]);

    expect(views[0].stops[0].customer).toBe('ลูกค้า A คนเดิม');
    expect(views[1].stops[0].customer).toBe('ลูกค้า B คนเดิม');
  });

  it('keeps an unassigned plan empty instead of showing example routes', () => {
    const prepared = preparePlanningOrders(store, '2026-10-11', [order(101)]);
    const plan = planDeliveryRoutes(
      store,
      prepared.items.map((item) => item.routing),
      [],
      {
        includeReturnDistance: true,
      },
    );

    expect(toRouteViews(plan, prepared, [])).toEqual([]);
    expect(plan.summary.unassignedOrderCount).toBe(1);
  });
});
