import { describe, expect, it } from 'vitest';
import type { RoutingOrder } from './planning-input';
import type { RoutingRider } from './route-assignment';
import { buildRoutePlanAlternatives, routePlanSignature } from './route-alternatives';
import { planDeliveryRoutes, type RoutePlanResult } from './route-planner';

const store = { latitude: 0, longitude: 0 };
const options = { includeReturnDistance: true };
const points = [
  [-0.004, -0.015],
  [-0.005, -0.002],
  [-0.011, 0.008],
  [0.003, 0.005],
  [0.012, 0.018],
  [0.015, -0.007],
];

function orders(boxes = [1, 1, 1, 1, 1, 1]): RoutingOrder[] {
  return points.map(([latitude, longitude], index) => ({
    orderId: index + 1,
    customerId: index + 1,
    boxQuantity: boxes[index],
    latitude,
    longitude,
  }));
}

function rider(id: number, maxOrders = 3, status = 'AVAILABLE'): RoutingRider {
  return {
    rider_id: id,
    name: `Rider ${id}`,
    max_orders_per_route: maxOrders,
    status,
  };
}

function partition(plan: RoutePlanResult): string {
  return plan.trips
    .map((trip) =>
      trip.route.stops
        .map((stop) => stop.orderId)
        .sort((a, b) => a - b)
        .join(','),
    )
    .sort()
    .join('|');
}

function expectConstraints(
  plan: RoutePlanResult,
  input: readonly RoutingOrder[],
  riders: readonly RoutingRider[],
): void {
  const assignedIds = plan.trips.flatMap((trip) => trip.route.stops.map((stop) => stop.orderId));
  const accountedIds = [...assignedIds, ...plan.unassignedOrders.map((order) => order.orderId)];

  expect(new Set(accountedIds).size).toBe(input.length);
  expect(accountedIds.sort((a, b) => a - b)).toEqual(
    input.map((order) => order.orderId).sort((a, b) => a - b),
  );

  for (const configured of riders) {
    const trips = plan.trips
      .filter((trip) => trip.riderId === configured.rider_id)
      .sort((a, b) => a.roundNumber - b.roundNumber);
    expect(trips.reduce((sum, trip) => sum + trip.route.stops.length, 0)).toBeLessThanOrEqual(3);

    for (let index = 0; index < trips.length; index += 1) {
      const trip = trips[index];
      expect(configured.status).toBe('AVAILABLE');
      expect(trip.route.stops.length).toBeLessThanOrEqual(
        Math.min(3, configured.max_orders_per_route),
      );
      expect(trip.totalBoxes).toBeLessThanOrEqual(10);
      if (index > 0) expect(trip.departureMinute).toBe(trips[index - 1].timing.returnMinute);
    }
  }
}

describe('buildRoutePlanAlternatives', () => {
  it('produces distinct allocations, improves this fixture and retains the baseline', () => {
    const input = orders();
    const riders = [rider(1), rider(2)];
    const baseline = planDeliveryRoutes(store, input, riders, options);
    const alternatives = buildRoutePlanAlternatives(store, input, riders, options);

    expect(alternatives).toHaveLength(3);
    expect(new Set(alternatives.map((alternative) => alternative.id)).size).toBe(3);
    expect(
      new Set(alternatives.map((alternative) => partition(alternative.result))).size,
    ).toBeGreaterThanOrEqual(2);
    expect(
      alternatives.some((alternative) => alternative.id === routePlanSignature(baseline)),
    ).toBe(true);
    expect(alternatives[0].result.summary.profit).toBeGreaterThan(baseline.summary.profit);
    expect(alternatives[0].result.trips.reduce((sum, trip) => sum + trip.route.totalDistanceKm, 0))
      .toBeCloseTo(12.889240644126753, 9);
    expect(alternatives[0].result.summary.totalDistanceKm).toBe(12.89);

    for (const alternative of alternatives) expectConstraints(alternative.result, input, riders);
  });

  it('is deterministic for the same input', () => {
    const input = orders();
    const riders = [rider(1), rider(2)];

    expect(buildRoutePlanAlternatives(store, input, riders, options)).toEqual(
      buildRoutePlanAlternatives(store, input, riders, options),
    );
  });

  it('does not advertise cosmetic rider renaming or swapping as new alternatives', () => {
    const input = orders();
    const first = buildRoutePlanAlternatives(store, input, [rider(1), rider(2)], options);
    const renamed = buildRoutePlanAlternatives(store, input, [rider(99), rider(42)], options);
    const swapped = buildRoutePlanAlternatives(store, input, [rider(2), rider(1)], options);

    expect(renamed.map((alternative) => alternative.id)).toEqual(
      first.map((alternative) => alternative.id),
    );
    expect(swapped.map((alternative) => alternative.id)).toEqual(
      first.map((alternative) => alternative.id),
    );
  });

  it('prioritizes fewer late orders even when another plan has more profit', () => {
    const input = orders([1, 3, 3, 2, 1, 1]);
    const riders = [rider(1), rider(2)];
    const lateOptions = { ...options, departureMinute: 743.75 };
    const baseline = planDeliveryRoutes(store, input, riders, lateOptions);
    const alternatives = buildRoutePlanAlternatives(store, input, riders, lateOptions);

    expect(alternatives[0].result.summary.lateOrderCount).toBe(2);
    expect(baseline.summary.lateOrderCount).toBe(3);
    expect(alternatives[0].result.summary.profit).toBeLessThan(baseline.summary.profit);
    expect(
      alternatives.some((alternative) => alternative.id === routePlanSignature(baseline)),
    ).toBe(true);
  });

  it('ranks profit before elapsed time but keeps the fastest equally covered on-time option', () => {
    const input = orders([1, 2, 1, 1, 1, 1]);
    const riders = [rider(1), rider(2)];
    const fastest = planDeliveryRoutes(store, input, riders, {
      ...options,
      groupingStrategy: 'sweep-clockwise',
      sweepStartDegrees: 0,
    });
    const alternatives = buildRoutePlanAlternatives(store, input, riders, options);

    expect(alternatives[0].result.summary.profit).toBeGreaterThan(fastest.summary.profit);
    expect(alternatives[0].result.summary.elapsedMinutes).toBeGreaterThan(
      fastest.summary.elapsedMinutes,
    );
    expect(
      alternatives.some(
        (alternative) =>
          Math.abs(alternative.result.summary.elapsedMinutes - fastest.summary.elapsedMinutes) <
          1e-9,
      ),
    ).toBe(true);
    expect(
      alternatives.every((alternative) => alternative.result.summary.lateOrderCount === 0),
    ).toBe(true);
  });

  it('preserves capacity, leftovers, lower trip limits and rider availability in every candidate', () => {
    const input = [
      ...orders([1, 2, 3, 1, 2, 3]),
      {
        orderId: 7,
        customerId: 7,
        boxQuantity: 2,
        latitude: 0.005,
        longitude: 0.001,
      },
    ];
    const riders = [rider(1, 1), rider(2, 2), rider(3, 3, 'BUSY')];
    const alternatives = buildRoutePlanAlternatives(store, input, riders, options);

    for (const alternative of alternatives) {
      expect(alternative.result.summary.assignedOrderCount).toBe(6);
      expect(alternative.result.summary.unassignedOrderCount).toBe(1);
      expectConstraints(alternative.result, input, riders);
    }
  });

  it('handles a full thirty-order round without losing orders or exceeding personal capacity', () => {
    const input: RoutingOrder[] = Array.from({ length: 30 }, (_, index) => {
      const angle = (index * 137.508 * Math.PI) / 180;
      const degrees = (0.6 + (index % 7) * 0.25) / 111.195;
      return {
        orderId: index + 1,
        customerId: index + 1,
        boxQuantity: (index % 3) + 1,
        latitude: degrees * Math.cos(angle),
        longitude: degrees * Math.sin(angle),
      };
    });
    const riders = Array.from({ length: 10 }, (_, index) => rider(index + 1));
    const alternatives = buildRoutePlanAlternatives(store, input, riders, options);

    expect(alternatives.length).toBeLessThanOrEqual(3);
    for (const alternative of alternatives) {
      expect(alternative.result.summary.assignedOrderCount).toBe(30);
      expect(alternative.result.unassignedOrders).toEqual([]);
      expectConstraints(alternative.result, input, riders);
    }
  });

  it('returns one real outcome when there is only one order and one rider', () => {
    const input = orders().slice(0, 1);
    const alternatives = buildRoutePlanAlternatives(store, input, [rider(1)], options);

    expect(alternatives).toHaveLength(1);
    expect(alternatives[0].result.summary.assignedOrderCount).toBe(1);
  });

  it('does not fabricate alternatives for empty input or unavailable riders', () => {
    const empty = buildRoutePlanAlternatives(store, [], [rider(1)], options);
    const unavailable = buildRoutePlanAlternatives(store, orders(), [rider(1, 3, 'BUSY')], options);

    expect(empty).toHaveLength(1);
    expect(empty[0].result.trips).toEqual([]);
    expect(empty[0].result.summary.returnMinute).toBeNull();
    expect(unavailable).toHaveLength(1);
    expect(unavailable[0].result.trips).toEqual([]);
    expect(unavailable[0].result.unassignedOrders).toHaveLength(6);
  });

  it('does not mutate orders, rider configurations or options while exploring candidates', () => {
    const input = Object.freeze(orders().map((order) => Object.freeze(order)));
    const riders = Object.freeze([Object.freeze(rider(1)), Object.freeze(rider(2))]);
    const settings = Object.freeze({ ...options });
    const before = JSON.stringify({ input, riders, settings });

    buildRoutePlanAlternatives(Object.freeze({ ...store }), input, riders, settings);

    expect(JSON.stringify({ input, riders, settings })).toBe(before);
  });
});

describe('routePlanSignature', () => {
  it('ignores trip array order and cosmetic rider names while retaining each rider chain', () => {
    const plan = planDeliveryRoutes(store, orders(), [rider(1, 1), rider(2, 1)], options);
    const reordered: RoutePlanResult = {
      ...plan,
      trips: [...plan.trips].reverse().map((trip) => ({
        ...trip,
        riderId: trip.riderId + 100,
        riderName: 'renamed',
      })),
    };

    expect(routePlanSignature(reordered)).toBe(routePlanSignature(plan));
  });

  it('retains delivery sequence and trip boundaries instead of flattening orders', () => {
    const input = orders().slice(0, 3);
    const oneTrip = planDeliveryRoutes(store, input, [rider(1)], options);
    const threeTrips = planDeliveryRoutes(store, input, [rider(1, 1)], options);
    const threeRiders = planDeliveryRoutes(
      store,
      input,
      [rider(1, 1), rider(2, 1), rider(3, 1)],
      options,
    );
    const reversed: RoutePlanResult = {
      ...oneTrip,
      trips: oneTrip.trips.map((trip) => ({
        ...trip,
        route: { ...trip.route, stops: [...trip.route.stops].reverse() },
      })),
    };

    expect(routePlanSignature(oneTrip)).not.toBe(routePlanSignature(threeTrips));
    expect(routePlanSignature(threeTrips)).not.toBe(routePlanSignature(threeRiders));
    expect(routePlanSignature(oneTrip)).not.toBe(routePlanSignature(reversed));
  });

  it('ignores unassigned list order without losing the unassigned identities', () => {
    const plan = planDeliveryRoutes(store, orders(), [rider(1)], options);
    const reordered = { ...plan, unassignedOrders: [...plan.unassignedOrders].reverse() };
    const changed = { ...plan, unassignedOrders: plan.unassignedOrders.slice(1) };

    expect(routePlanSignature(reordered)).toBe(routePlanSignature(plan));
    expect(routePlanSignature(changed)).not.toBe(routePlanSignature(plan));
  });
});
