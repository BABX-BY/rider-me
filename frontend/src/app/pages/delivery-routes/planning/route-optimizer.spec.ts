import { describe, expect, it } from 'vitest';
import type { RoutingOrder } from './planning-input';
import { buildRoutePlanAlternatives } from './route-alternatives';
import type { RoutingRider } from './route-assignment';
import { calculateDistanceKm } from './route-distance';
import { optimizeDeliveryRoutes, type RoadDistanceMatrix } from './route-optimizer';
import type { RoutePlanResult } from './route-planner';

const store = { latitude: 0, longitude: 0 };
const rider = (id: number, cap = 3, status = 'AVAILABLE'): RoutingRider => ({
  rider_id: id, name: `Rider ${id}`, max_orders_per_route: cap, status,
});
const orders = (count: number): RoutingOrder[] => Array.from({ length: count }, (_, index) => ({
  orderId: index + 1, customerId: index + 1, boxQuantity: index % 3 + 1,
  latitude: Math.cos(index * 2.4) * (0.005 + (index % 6) * 0.003),
  longitude: Math.sin(index * 2.4) * (0.005 + (index % 6) * 0.003),
}));
const matrixFor = (input: readonly RoutingOrder[], seed = 0): RoadDistanceMatrix => {
  const points = [store, ...input];
  return { points, distancesKm: points.map((from, i) => points.map((to, j) => i === j ? 0 :
    calculateDistanceKm(from, to) * (1 + (((i * 17 + j * 11 + seed) % 13) / 20)))) };
};

function constraints(plan: RoutePlanResult, input: readonly RoutingOrder[], riders: readonly RoutingRider[]) {
  const assigned = plan.trips.flatMap((trip) => trip.route.stops.map((stop) => stop.orderId));
  const accounted = [...assigned, ...plan.unassignedOrders.map((order) => order.orderId)];
  expect(new Set(accounted).size).toBe(input.length);
  expect(accounted.sort((a, b) => a - b)).toEqual(input.map((order) => order.orderId).sort((a, b) => a - b));
  expect(new Set(plan.trips.map((trip) => trip.riderId)).size).toBe(plan.trips.length);
  for (const trip of plan.trips) {
    const owner = riders.find((item) => item.rider_id === trip.riderId)!;
    expect(owner.status).toBe('AVAILABLE');
    expect(trip.route.stops.length).toBeLessThanOrEqual(Math.min(3, owner.max_orders_per_route));
    expect(trip.totalBoxes).toBeLessThanOrEqual(10);
    expect(trip.route.totalDistanceKm).toBeCloseTo(
      trip.route.stops.reduce((sum, stop) => sum + stop.distanceFromPreviousKm, 0) + trip.route.returnDistanceKm, 10);
    expect(trip.cost.revenue).toBe(trip.totalBoxes * 65);
    expect(trip.cost.foodCost).toBe(trip.totalBoxes * 40);
    expect(trip.cost.dispatchCost).toBe(15);
    expect(trip.cost.transportCost).toBeCloseTo(trip.route.totalDistanceKm * trip.totalBoxes * 2, 10);
    expect(trip.cost.totalCost).toBe(Number((trip.totalBoxes * 40 + 15 +
      trip.route.totalDistanceKm * trip.totalBoxes * 2 + trip.timing.lateOrderCount * 20).toFixed(2)));
  }
  expect(plan.summary.profit).toBe(Number((plan.summary.totalRevenue - plan.summary.totalCost).toFixed(2)));
}

// Independent exhaustive oracle: assign every order to a rider or leave it out;
// enumerate every stop permutation; do not call production cost/timing helpers.
function oracle(input: RoutingOrder[], riders: RoutingRider[], matrix: RoadDistanceMatrix, departure = 690) {
  let best = { count: -1, late: Infinity, outboundCost: Infinity, outboundDistance: Infinity, outboundMinutes: Infinity };
  const active = riders.filter((item) => item.status === 'AVAILABLE');
  const allocations = active.map(() => [] as number[]);
  const permutations = (items: number[]): number[][] => items.length ? items.flatMap((item) =>
    permutations(items.filter((other) => other !== item)).map((rest) => [item, ...rest])) : [[]];
  const evaluate = () => {
    let count = 0, late = 0, outboundCost = 0, outboundDistance = 0, outboundMinutes = 0;
    for (const members of allocations) {
      if (!members.length) continue;
      const boxes = members.reduce((sum, index) => sum + input[index].boxQuantity, 0);
      let bestTrip = { late: Infinity, outboundCost: Infinity, outboundDistance: Infinity, outboundMinutes: Infinity };
      for (const sequence of permutations(members)) {
        let prior = 0, distance = 0, tripLate = 0;
        for (const index of sequence) {
          distance += matrix.distancesKm[prior][index + 1];
          if (departure + distance * 2 > 750) tripLate += 1;
          prior = index + 1;
        }
        const tripOutboundDistance = distance;
        const tripOutboundCost = Number((boxes * 40 + 15 + tripOutboundDistance * boxes * 2 + tripLate * 20).toFixed(2));
        distance += matrix.distancesKm[prior][0];
        const tripOutboundMinutes = tripOutboundDistance * 2;
        const winsTripTieBreak = tripOutboundCost < bestTrip.outboundCost - 1e-9 ||
          (Math.abs(tripOutboundCost - bestTrip.outboundCost) < 1e-9 &&
            (tripOutboundDistance < bestTrip.outboundDistance - 1e-9 ||
              (Math.abs(tripOutboundDistance - bestTrip.outboundDistance) < 1e-9 &&
                tripOutboundMinutes < bestTrip.outboundMinutes)));
        if (tripLate < bestTrip.late || (tripLate === bestTrip.late && winsTripTieBreak)) {
          bestTrip = { late: tripLate, outboundCost: tripOutboundCost, outboundDistance: tripOutboundDistance, outboundMinutes: tripOutboundMinutes };
        }
      }
      count += members.length; late += bestTrip.late; outboundCost += bestTrip.outboundCost;
      outboundDistance += bestTrip.outboundDistance; outboundMinutes = Math.max(outboundMinutes, bestTrip.outboundMinutes);
    }
    const winsAllocationTieBreak = outboundCost < best.outboundCost - 1e-9 ||
      (Math.abs(outboundCost - best.outboundCost) < 1e-9 &&
        (outboundDistance < best.outboundDistance - 1e-9 ||
          (Math.abs(outboundDistance - best.outboundDistance) < 1e-9 && outboundMinutes < best.outboundMinutes)));
    if (count > best.count || (count === best.count && late < best.late) ||
      (count === best.count && late === best.late && winsAllocationTieBreak)) {
      best = { count, late, outboundCost, outboundDistance, outboundMinutes };
    }
  };
  const assign = (index: number) => {
    if (index === input.length) { evaluate(); return; }
    assign(index + 1);
    for (let owner = 0; owner < active.length; owner += 1) {
      if (allocations[owner].length >= Math.min(3, active[owner].max_orders_per_route)) continue;
      allocations[owner].push(index); assign(index + 1); allocations[owner].pop();
    }
  };
  assign(0);
  return best;
}

describe('optimizeDeliveryRoutes', () => {
  it('splits into an empty available rider when the transport saving exceeds the extra dispatch fee', () => {
    const input = [
      { orderId: 1, customerId: 1, boxQuantity: 3, latitude: 0.02, longitude: 0 },
      { orderId: 2, customerId: 2, boxQuantity: 3, latitude: -0.02, longitude: 0 },
    ];
    const matrix = { points: [store, ...input], distancesKm: [[0, 2, 2], [2, 0, 4], [2, 4, 0]] };
    const result = optimizeDeliveryRoutes(store, input, [rider(1), rider(2)], matrix)[0].result;
    expect(result.trips).toHaveLength(2);
    expect(result.summary.totalRevenue).toBe(390);
    expect(result.summary.totalDistanceKm).toBe(8);
    expect(result.summary.totalCost).toBe(318);
    expect(result.summary.profit).toBe(72);
    expect(351 - result.summary.totalCost).toBe(33);
  });

  it('respects directed road distances instead of choosing a short-looking straight line', () => {
    const input = orders(3).map((order) => ({ ...order, boxQuantity: 1 }));
    const matrix = { points: [store, ...input], distancesKm: [
      [0, 1, 5, 5], [8, 0, 1, 7], [7, 8, 0, 1], [1, 9, 8, 0],
    ] };
    const result = optimizeDeliveryRoutes(store, input, [rider(1)], matrix)[0].result;
    expect(result.trips[0].route.stops.map((stop) => stop.orderId)).toEqual([1, 2, 3]);
    expect(result.summary.totalDistanceKm).toBe(4);
    expect(result.trips[0].route.returnDistanceKm).toBe(1);
    expect(result.summary.totalCost).toBe(159);
    expect(result.summary.profit).toBe(36);
  });

  it('chooses the cheapest outbound order sequence even when its return leg is longer', () => {
    const input = [
      { orderId: 1, customerId: 1, boxQuantity: 1, latitude: 0.01, longitude: 0 },
      { orderId: 2, customerId: 2, boxQuantity: 1, latitude: 0.02, longitude: 0 },
    ];
    const matrix = { points: [store, ...input], distancesKm: [
      [0, 1, 10],
      [1, 0, 1],
      [100, 10, 0],
    ] };
    const trip = optimizeDeliveryRoutes(store, input, [rider(1)], matrix)[0].result.trips[0];
    expect(trip.route.stops.map((stop) => stop.orderId)).toEqual([1, 2]);
    expect(trip.route.returnDistanceKm).toBe(100);
    expect(trip.route.totalDistanceKm).toBe(102);
  });

  it('groups customers by the road connection across a barrier rather than coordinate proximity', () => {
    const input = orders(4).map((order) => ({ ...order, boxQuantity: 1 }));
    const matrix = { points: [store, ...input], distancesKm: [
      [0, 2, 2, 2, 2], [2, 0, 8, 0.2, 8], [2, 8, 0, 8, 0.2],
      [2, 0.2, 8, 0, 8], [2, 8, 0.2, 8, 0],
    ] };
    const result = optimizeDeliveryRoutes(store, input, [rider(1, 2), rider(2, 2)], matrix)[0].result;
    const partition = result.trips.map((trip) => trip.route.stops.map((stop) => stop.orderId).sort().join(',')).sort();
    expect(partition).toEqual(['1,3', '2,4']);
    expect(result.summary.totalDistanceKm).toBe(8.4);
    expect(result.summary.totalCost).toBe(223.6);
  });

  it.each([0, 1, 2, 3, 4, 5])('matches exhaustive coverage, punctuality and outbound cost, directed fixture %i', (seed) => {
    const input = orders(5);
    const riders = [rider(1, seed % 2 ? 2 : 3), rider(2, 3)];
    const matrix = matrixFor(input, seed);
    const departureMinute = seed % 2 ? 744 : 690;
    const expected = oracle(input, riders, matrix, departureMinute);
    const result = optimizeDeliveryRoutes(store, input, riders, matrix, { departureMinute })[0].result;
    expect(result.summary.assignedOrderCount).toBe(expected.count);
    expect(result.summary.lateOrderCount).toBe(expected.late);
    const actualOutboundCost = result.trips.reduce((sum, trip) => sum + Number((trip.totalBoxes * 40 + 15 +
      (trip.route.stops.at(-1)?.cumulativeDistanceKm ?? 0) * trip.totalBoxes * 2 + trip.timing.lateOrderCount * 20).toFixed(2)), 0);
    expect(actualOutboundCost).toBeCloseTo(expected.outboundCost, 2);
    expect(result.trips.reduce((sum, trip) => sum + (trip.route.stops.at(-1)?.cumulativeDistanceKm ?? 0), 0))
      .toBeCloseTo(expected.outboundDistance, 8);
    constraints(result, input, riders);
  });

  it('handles partial coverage and chooses an outbound-only objective', () => {
    const input = orders(5);
    const riders = [rider(1, 1), rider(2, 2), rider(3, 3, 'BUSY')];
    const matrix = matrixFor(input, 3);
    const expected = oracle(input, riders, matrix);
    const result = optimizeDeliveryRoutes(store, input, riders, matrix)[0].result;
    expect(result.summary.assignedOrderCount).toBe(3);
    const actualOutboundCost = result.trips.reduce((sum, trip) => sum + Number((trip.totalBoxes * 40 + 15 +
      (trip.route.stops.at(-1)?.cumulativeDistanceKm ?? 0) * trip.totalBoxes * 2 + trip.timing.lateOrderCount * 20).toFixed(2)), 0);
    expect(actualOutboundCost).toBeCloseTo(expected.outboundCost, 2);
    expect(result.trips.reduce((sum, trip) => sum + (trip.route.stops.at(-1)?.cumulativeDistanceKm ?? 0), 0))
      .toBeCloseTo(expected.outboundDistance, 8);
    constraints(result, input, riders);
  });

  it.each([10, 11, 15, 20, 26, 30])('preserves constraints and accounting for %i orders over several asymmetric road rounds', (count) => {
    const input = orders(count);
    const riders = Array.from({ length: 10 }, (_, index) => rider(index + 1));
    const matrix = matrixFor(input, count);
    const result = optimizeDeliveryRoutes(store, input, riders, matrix);
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(3);
    expect(new Set(result.map((plan) => plan.id)).size).toBe(result.length);
    expect(result[0].result.summary.assignedOrderCount).toBe(count);
    for (const plan of result) constraints(plan.result, input, riders);
    // Initial heuristic regroupings remain candidates, so outbound optimisation
    // cannot return a longer delivery path than their best road reevaluation.
    const original = buildRoutePlanAlternatives(store, input, riders, { includeReturnDistance: true, singleTripPerRider: true });
    const originalOutboundCosts = original.map((plan) => plan.result.trips.reduce((sum, trip) => {
      let previous = 0, distance = 0;
      for (const stop of trip.route.stops) {
        distance += matrix.distancesKm[previous][stop.orderId]; previous = stop.orderId;
      }
      return sum + Number((trip.totalBoxes * 40 + 15 + distance * trip.totalBoxes * 2 + trip.timing.lateOrderCount * 20).toFixed(2));
    }, 0));
    const optimizedOutboundCost = result[0].result.trips.reduce((sum, trip) => sum + Number((trip.totalBoxes * 40 + 15 +
      (trip.route.stops.at(-1)?.cumulativeDistanceKm ?? 0) * trip.totalBoxes * 2 + trip.timing.lateOrderCount * 20).toFixed(2)), 0);
    expect(optimizedOutboundCost).toBeLessThanOrEqual(Math.min(...originalOutboundCosts) + 1e-9);
  });

  it('is deterministic and does not mutate order, rider or matrix inputs', () => {
    const input = orders(6);
    const riders = [rider(2), rider(1)];
    const matrix = matrixFor(input);
    const before = JSON.stringify({ input, riders, matrix });
    const first = optimizeDeliveryRoutes(store, input, riders, matrix);
    expect(optimizeDeliveryRoutes(store, input, riders, matrix)).toEqual(first);
    expect(optimizeDeliveryRoutes(store, [...input].reverse(), [...riders].reverse(), matrix)).toEqual(first);
    expect(JSON.stringify({ input, riders, matrix })).toBe(before);
  });

  it('handles empty orders and unavailable riders without fabricating a trip', () => {
    expect(optimizeDeliveryRoutes(store, [], [rider(1)], matrixFor([]))[0].result.trips).toEqual([]);
    const input = orders(2);
    const result = optimizeDeliveryRoutes(store, input, [rider(1, 3, 'BUSY')], matrixFor(input))[0].result;
    expect(result.trips).toEqual([]);
    expect(result.unassignedOrders).toHaveLength(2);
    expect(result.summary.returnMinute).toBeNull();
  });

  it('rejects incomplete or invalid road matrices instead of silently using straight lines', () => {
    const input = orders(2);
    const matrix = matrixFor(input);
    expect(() => optimizeDeliveryRoutes(store, input, [rider(1)], { ...matrix, distancesKm: [[0]] })).toThrow();
    expect(() => optimizeDeliveryRoutes(store, input, [rider(1)], { ...matrix, points: [store] })).toThrow();
    expect(() => optimizeDeliveryRoutes(store, input, [rider(1)], { ...matrix,
      distancesKm: matrix.distancesKm.map((row) => row.map(() => NaN)) })).toThrow();
  });

  it('rejects duplicate orders, duplicate available riders and invalid capacities', () => {
    const input = orders(2);
    const matrix = matrixFor(input);
    expect(() => optimizeDeliveryRoutes(store, [input[0], input[0]], [rider(1)], matrix)).toThrow();
    expect(() => optimizeDeliveryRoutes(store, input, [rider(1), rider(1)], matrix)).toThrow();
    expect(() => optimizeDeliveryRoutes(store, input, [rider(1, Infinity)], matrix)).toThrow();
    expect(() => optimizeDeliveryRoutes(store, input, [rider(1, 0)], matrix)).toThrow();
    expect(() => optimizeDeliveryRoutes(store, input, [rider(1)], matrix, { speedKmh: 0 })).toThrow();
  });
});
