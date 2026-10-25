import { describe, expect, it } from 'vitest';
import type { RoutingOrder } from './planning-input';
import type { RoutingRider } from './route-assignment';
import { planDeliveryRoutes } from './route-planner';
import { scheduleDeliveryRounds, type DeliverySchedule } from './route-scheduler';

const store = { latitude: 16.244335, longitude: 103.2494546 };

function orders(count: number, atStore = false): RoutingOrder[] {
  return Array.from({ length: count }, (_, index) => ({
    orderId: index + 1,
    customerId: index + 1,
    boxQuantity: (index % 3) + 1,
    latitude: store.latitude + (atStore ? 0 : (index + 1) * 0.0001),
    longitude: store.longitude,
  }));
}

function rider(id: number, maxOrders = 3, status = 'AVAILABLE'): RoutingRider {
  return {
    rider_id: id,
    name: `Rider ${id}`,
    status,
    max_orders_per_route: maxOrders,
  };
}

function assignedCount(schedule: DeliverySchedule, riderId?: number): number {
  return schedule.trips
    .filter((trip) => riderId === undefined || trip.riderId === riderId)
    .reduce((sum, trip) => sum + trip.route.stops.length, 0);
}

function expectAllOrdersAccountedFor(
  schedule: DeliverySchedule,
  input: readonly RoutingOrder[],
): void {
  const assignedIds = schedule.trips.flatMap((trip) =>
    trip.route.stops.map((stop) => stop.orderId),
  );
  const allIds = [...assignedIds, ...schedule.unassignedOrders.map((order) => order.orderId)];

  expect(new Set(allIds).size).toBe(input.length);
  expect(allIds.sort((a, b) => a - b)).toEqual(
    input.map((order) => order.orderId).sort((a, b) => a - b),
  );
  expect(schedule.trips.every((trip) => trip.totalBoxes <= 10)).toBe(true);
}

describe('scheduleDeliveryRounds personal order limit', () => {
  it('uses one trip per rider when preparing compatible daily worksheets', () => {
    const result = scheduleDeliveryRounds(store, orders(4), [rider(1, 1), rider(2, 2)],
      690, 750, 30, { singleTripPerRider: true });
    expect(result.trips.map((trip) => trip.route.stops.length)).toEqual([1, 2]);
    expect(result.trips.map((trip) => trip.roundNumber)).toEqual([1, 1]);
    expect(result.unassignedOrders).toHaveLength(1);
    expectAllOrdersAccountedFor(result, orders(4));
  });
  it('leaves the fourth order unassigned when only one rider is available', () => {
    const input = orders(4);
    const result = scheduleDeliveryRounds(store, input, [rider(1)]);

    expect(assignedCount(result, 1)).toBe(3);
    expect(result.unassignedOrders).toHaveLength(1);
    expect(result.trips).toHaveLength(1);
    expectAllOrdersAccountedFor(result, input);
  });

  it('allows three one-order trips, but never a fourth trip for that rider', () => {
    const input = orders(5);
    const result = scheduleDeliveryRounds(store, input, [rider(1, 1)]);

    expect(result.trips.map((trip) => trip.route.stops.length)).toEqual([1, 1, 1]);
    expect(result.trips.map((trip) => trip.roundNumber)).toEqual([1, 2, 3]);
    expect(result.unassignedOrders).toHaveLength(2);

    for (let index = 1; index < result.trips.length; index += 1) {
      expect(result.trips[index].departureMinute).toBe(result.trips[index - 1].timing.returnMinute);
    }
    expectAllOrdersAccountedFor(result, input);
  });

  it('reduces the second trip to one order when two have already been assigned', () => {
    const input = orders(6);
    const result = scheduleDeliveryRounds(store, input, [rider(1, 2)]);

    expect(result.trips.map((trip) => trip.route.stops.length)).toEqual([2, 1]);
    expect(assignedCount(result, 1)).toBe(3);
    expect(result.unassignedOrders).toHaveLength(3);
    expectAllOrdersAccountedFor(result, input);
  });

  it('assigns at most six of seven orders to two riders', () => {
    const input = orders(7);
    const result = scheduleDeliveryRounds(store, input, [rider(1), rider(2)]);

    expect(assignedCount(result, 1)).toBe(3);
    expect(assignedCount(result, 2)).toBe(3);
    expect(result.unassignedOrders).toHaveLength(1);
    expectAllOrdersAccountedFor(result, input);
  });

  it('moves on to an eligible rider after the fastest rider reaches three orders', () => {
    const input = orders(7);
    const result = scheduleDeliveryRounds(store, input, [rider(1, 1), rider(2, 2)]);

    expect(assignedCount(result, 1)).toBe(3);
    expect(assignedCount(result, 2)).toBe(3);
    expect(
      result.trips.every((trip) => trip.route.stops.length <= (trip.riderId === 1 ? 1 : 2)),
    ).toBe(true);
    expect(result.unassignedOrders).toHaveLength(1);
    expectAllOrdersAccountedFor(result, input);
  });

  it('terminates zero-distance trips and gives equal-time riders turns fairly', () => {
    const input = orders(8, true);
    const result = scheduleDeliveryRounds(store, input, [rider(1, 1), rider(2, 1)]);

    expect(result.trips.map((trip) => trip.riderId)).toEqual([1, 2, 1, 2, 1, 2]);
    expect(result.trips.every((trip) => trip.timing.returnMinute === 690)).toBe(true);
    expect(result.unassignedOrders).toHaveLength(2);
    expectAllOrdersAccountedFor(result, input);
  });

  it('excludes busy and inactive riders from personal capacity', () => {
    const input = orders(7);
    const result = scheduleDeliveryRounds(store, input, [
      rider(1, 0, 'BUSY'),
      rider(2),
      rider(3, 0, 'INACTIVE'),
    ]);

    expect(result.trips.every((trip) => trip.riderId === 2)).toBe(true);
    expect(assignedCount(result)).toBe(3);
    expect(result.unassignedOrders).toHaveLength(4);
    expectAllOrdersAccountedFor(result, input);
  });

  it('keeps every order unassigned when no rider is available', () => {
    const input = orders(4);
    const result = scheduleDeliveryRounds(store, input, [rider(1, 3, 'BUSY')]);

    expect(result.trips).toEqual([]);
    expect(result.unassignedOrders).toEqual(input);
    expectAllOrdersAccountedFor(result, input);
  });

  it.each([0, -1, 1.5, NaN, Infinity])(
    'rejects an invalid capacity %s before reducing it to the remaining allowance',
    (capacity) => {
      expect(() => scheduleDeliveryRounds(store, orders(1), [rider(1, capacity)])).toThrow(
        'จำนวนออเดอร์ต่อรอบ',
      );
    },
  );

  it('preserves the existing clamp for a configured capacity larger than three', () => {
    const input = orders(4);
    const result = scheduleDeliveryRounds(store, input, [rider(1, 4)]);

    expect(assignedCount(result, 1)).toBe(3);
    expect(result.unassignedOrders).toHaveLength(1);
    expectAllOrdersAccountedFor(result, input);
  });

  it('does not mutate orders, riders or their arrays', () => {
    const input = Object.freeze(orders(5).map((order) => Object.freeze(order)));
    const riders = Object.freeze([Object.freeze(rider(1, 2))]);
    const before = JSON.stringify({ input, riders });

    const result = scheduleDeliveryRounds(store, input, riders);

    expect(JSON.stringify({ input, riders })).toBe(before);
    expect(riders[0].max_orders_per_route).toBe(2);
    expectAllOrdersAccountedFor(result, input);
  });

  it('exposes excess orders and the existing warning through the planner', () => {
    const result = planDeliveryRoutes(store, orders(7), [rider(1), rider(2)], {
      includeReturnDistance: true,
    });

    expect(result.summary.assignedOrderCount).toBe(6);
    expect(result.summary.unassignedOrderCount).toBe(1);
    expect(result.summary.usedRiderCount).toBe(2);
    expect(result.warnings).toContain('ยังมีออเดอร์ที่จัดไม่ได้ 1 รายการ');
  });
});
