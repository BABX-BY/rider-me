import type { RoutingOrder } from './planning-input';
import { buildRoutePlanAlternatives, routePlanSignature, type RoutePlanAlternative } from './route-alternatives';
import type { RoutingRider } from './route-assignment';
import { calculateTripCost } from './route-cost';
import type { Coordinate, RouteDistanceResult } from './route-distance';
import type { PlannedTrip, RoutePlanResult } from './route-planner';
import { calculateRouteTiming } from './route-timing';

export interface RoadDistanceMatrix {
  points: readonly Coordinate[];
  distancesKm: readonly (readonly number[])[];
}

interface OptimizerOptions {
  departureMinute?: number;
  deadlineMinute?: number;
  speedKmh?: number;
}

interface Score {
  count: number;
  late: number;
  profit: number;
  minutes: number;
  distance: number;
}

// Priority is delivery coverage, punctuality, then actual monetary profit.
// Maximising profit also minimises cost whenever the same orders are assigned.
function compare(a: Score, b: Score): number {
  return b.count - a.count || a.late - b.late || b.profit - a.profit ||
    Math.ceil(a.minutes) - Math.ceil(b.minutes) ||
    (Math.abs(a.distance - b.distance) < 1e-9 ? 0 : a.distance - b.distance);
}

/** Uses directed road distances, including each rider's return to the shop.
 * Up to ten orders: subset dynamic programming gives the optimal primary
 * objectives (coverage, late orders, profit). Larger rounds: deterministic
 * multi-start search with exact stop ordering and pairwise reallocation.
 */
export function optimizeDeliveryRoutes(
  store: Coordinate,
  orders: readonly RoutingOrder[],
  riders: readonly RoutingRider[],
  matrix: RoadDistanceMatrix,
  options: OptimizerOptions = {},
): RoutePlanAlternative[] {
  const departure = options.departureMinute ?? 690;
  const deadline = options.deadlineMinute ?? 750;
  const speed = options.speedKmh ?? 30;
  if (!Number.isFinite(departure) || departure < 0 || !Number.isFinite(deadline) || deadline < 0 ||
      !Number.isFinite(speed) || speed <= 0) throw new Error('เวลาและความเร็วที่ใช้จัดเส้นทางไม่ถูกต้อง');
  if (orders.length > 30 || new Set(orders.map((order) => order.orderId)).size !== orders.length ||
      orders.some((order) => !Number.isInteger(order.boxQuantity) || order.boxQuantity < 1 || order.boxQuantity > 3)) {
    throw new Error('ข้อมูลจัดเส้นทางต้องมีไม่เกิน 30 ออเดอร์ รหัสไม่ซ้ำ และออเดอร์ละ 1–3 กล่อง');
  }
  const available = riders.filter((rider) => rider.status === 'AVAILABLE')
    .sort((a, b) => Math.min(3, b.max_orders_per_route) - Math.min(3, a.max_orders_per_route) || a.rider_id - b.rider_id);
  if (new Set(available.map((rider) => rider.rider_id)).size !== available.length || available.some((rider) =>
    !Number.isInteger(rider.max_orders_per_route) || rider.max_orders_per_route < 1)) {
    throw new Error('รหัสหรือความจุของไรเดอร์ไม่ถูกต้อง');
  }
  const caps = available.map((rider) => Math.min(3, rider.max_orders_per_route));
  const input = [...orders].sort((a, b) => a.orderId - b.orderId);
  const indexOfPoint = (point: Coordinate) => matrix.points.findIndex((candidate) =>
    candidate.latitude === point.latitude && candidate.longitude === point.longitude);
  const shopIndex = indexOfPoint(store);
  const orderIndices = input.map(indexOfPoint);
  if (shopIndex < 0 || orderIndices.some((index) => index < 0) ||
      matrix.distancesKm.length !== matrix.points.length || matrix.distancesKm.some((row) =>
        row.length !== matrix.points.length || row.some((distance) => !Number.isFinite(distance) || distance < 0))) {
    throw new Error('ข้อมูลระยะทางตามถนนไม่ครบหรือไม่ตรงกับพิกัดออเดอร์');
  }
  const km = (from: number, to: number) => matrix.distancesKm[from < 0 ? shopIndex : orderIndices[from]][to < 0 ? shopIndex : orderIndices[to]];
  const cache = new Map<string, PlannedTrip>();
  const group = (members: readonly number[]): PlannedTrip => {
    const key = [...members].sort((a, b) => a - b).join(',');
    const cached = cache.get(key);
    if (cached) return cached;
    let best: PlannedTrip | undefined;
    const visit = (prefix: number[], remaining: readonly number[]) => {
      if (remaining.length) {
        for (const next of remaining) visit([...prefix, next], remaining.filter((index) => index !== next));
        return;
      }
      let cumulative = 0;
      let previous = -1;
      const stops = prefix.map((index, sequence) => {
        const distanceFromPreviousKm = km(previous, index);
        cumulative += distanceFromPreviousKm;
        previous = index;
        return { ...input[index], sequence: sequence + 1, distanceFromPreviousKm, cumulativeDistanceKm: cumulative };
      });
      const returnDistanceKm = prefix.length ? km(previous, -1) : 0;
      const route: RouteDistanceResult = { stops, returnDistanceKm, totalDistanceKm: cumulative + returnDistanceKm };
      const scheduled = { riderId: 0, riderName: '', totalBoxes: members.reduce((sum, index) => sum + input[index].boxQuantity, 0),
        route, roundNumber: 1, departureMinute: departure, timing: calculateRouteTiming(route, departure, deadline, speed) };
      const trip: PlannedTrip = { ...scheduled, cost: calculateTripCost(scheduled, true) };
      if (!best || trip.timing.lateOrderCount < best.timing.lateOrderCount ||
          (trip.timing.lateOrderCount === best.timing.lateOrderCount &&
           (trip.cost.profit > best.cost.profit || (trip.cost.profit === best.cost.profit && route.totalDistanceKm < best.route.totalDistanceKm - 1e-9)))) best = trip;
    };
    visit([], [...members].sort((a, b) => a - b));
    cache.set(key, best!);
    return best!;
  };
  const score = (allocation: readonly (readonly number[])[]): Score => {
    const value = { count: 0, late: 0, profit: 0, minutes: 0, distance: 0 };
    for (const members of allocation) {
      if (!members.length) continue;
      const trip = group(members);
      value.count += members.length;
      value.late += trip.timing.lateOrderCount;
      value.profit += Math.round(trip.cost.profit * 100);
      value.minutes = Math.max(value.minutes, trip.timing.totalTravelMinutes);
      value.distance += trip.route.totalDistanceKm;
    }
    return value;
  };
  const valid = (members: readonly number[], cap: number) => members.length <= cap &&
    members.reduce((sum, index) => sum + input[index].boxQuantity, 0) <= 10;
  const allIndices = input.map((_, index) => index);
  const candidates: number[][][] = [];

  // Retain the original heuristic as a real baseline, re-evaluated on roads.
  const oldPlans = buildRoutePlanAlternatives(store, input, available, {
    includeReturnDistance: true, singleTripPerRider: true, ...options,
  });
  for (const old of oldPlans) candidates.push(available.map((rider) =>
    old.result.trips.find((trip) => trip.riderId === rider.rider_id)?.route.stops.map((stop) =>
      input.findIndex((order) => order.orderId === stop.orderId)) ?? []));

  // Road-aware starts plus sweeps; different starts escape greedy grouping traps.
  const bearing = (index: number) => Math.atan2(
    (input[index].longitude - store.longitude) * Math.cos(store.latitude * Math.PI / 180),
    input[index].latitude - store.latitude);
  const seeds: number[][] = [
    [...allIndices].sort((a, b) => km(-1, a) + km(a, -1) - km(-1, b) - km(b, -1) || a - b),
    [...allIndices].sort((a, b) => km(-1, b) + km(b, -1) - km(-1, a) - km(a, -1) || a - b),
  ];
  for (const offset of [0, Math.PI * 2 / 3, Math.PI * 4 / 3]) {
    const angle = (index: number) => (bearing(index) - offset + Math.PI * 4) % (Math.PI * 2);
    const sweep = [...allIndices].sort((a, b) => angle(a) - angle(b) || a - b);
    seeds.push(sweep, [...sweep].reverse());
  }
  for (const seed of seeds) {
    const allocation = caps.map(() => [] as number[]);
    const remaining = new Set(seed);
    for (let riderIndex = 0; riderIndex < caps.length; riderIndex += 1) {
      while (remaining.size && allocation[riderIndex].length < caps[riderIndex]) {
        const existing = allocation[riderIndex];
        let next = -1;
        let bestIncrease = Infinity;
        for (const index of remaining) {
          if (!valid([...existing, index], caps[riderIndex])) continue;
          // The first seed chooses an anchor. Subsequent points minimise added road cost.
          const increase = existing.length ? group([...existing, index]).cost.totalCost - group(existing).cost.totalCost : 0;
          if (increase < bestIncrease - 1e-9) { next = index; bestIncrease = increase; }
        }
        if (next < 0) break;
        existing.push(next);
        remaining.delete(next);
      }
    }
    candidates.push(allocation);
  }

  const improve = (initial: number[][]): number[][] => {
    let current = initial.map((members) => [...members]);
    let currentScore = score(current);
    // Every accepted change strictly improves the same objective; stop at a local
    // optimum or this deterministic work bound (never random "lucky" results).
    for (let iteration = 0; iteration < 60; iteration += 1) {
      let best = current;
      let bestScore = currentScore;
      for (let first = 0; first < caps.length; first += 1) {
        for (let second = first + 1; second < caps.length; second += 1) {
          const union = [...current[first], ...current[second]].sort((a, b) => a - b);
          for (let mask = 0; mask < 2 ** union.length; mask += 1) {
            const a = union.filter((_, index) => mask & (1 << index));
            const b = union.filter((_, index) => !(mask & (1 << index)));
            if (!valid(a, caps[first]) || !valid(b, caps[second])) continue;
            const candidate = [...current];
            candidate[first] = a;
            candidate[second] = b;
            const candidateScore = score(candidate);
            if (compare(candidateScore, bestScore) < 0) { best = candidate; bestScore = candidateScore; }
          }
        }
      }
      const assigned = new Set(current.flat());
      for (const index of allIndices.filter((value) => !assigned.has(value))) {
        for (let riderIndex = 0; riderIndex < caps.length; riderIndex += 1) {
          const original = current[riderIndex];
          // Insert a leftover, or replace any single assigned order when capacity is full.
          for (let removed = -1; removed < original.length; removed += 1) {
            const members = [...original.filter((_, position) => position !== removed), index];
            if (!valid(members, caps[riderIndex])) continue;
            const candidate = [...current]; candidate[riderIndex] = members;
            const candidateScore = score(candidate);
            if (compare(candidateScore, bestScore) < 0) { best = candidate; bestScore = candidateScore; }
          }
        }
      }
      if (best === current) break;
      current = best; currentScore = bestScore;
    }
    return current;
  };
  const explored: number[][][] = [...candidates];
  const initialSignatures = new Set<string>();
  for (const initial of candidates) {
    const signature = JSON.stringify(initial);
    if (initialSignatures.has(signature)) continue;
    initialSignatures.add(signature);
    explored.push(improve(initial));
  }

  // Exact subset DP on small rounds validates and improves the heuristic result.
  if (input.length <= 10) {
    type State = { allocation: number[][]; value: Score };
    let states = new Map<number, State>([[0, { allocation: [], value: score([]) }]]);
    const subsets: { mask: number; members: number[] }[] = [{ mask: 0, members: [] }];
    for (let a = 0; a < input.length; a += 1) {
      subsets.push({ mask: 1 << a, members: [a] });
      for (let b = a + 1; b < input.length; b += 1) {
        subsets.push({ mask: (1 << a) | (1 << b), members: [a, b] });
        for (let c = b + 1; c < input.length; c += 1) subsets.push({ mask: (1 << a) | (1 << b) | (1 << c), members: [a, b, c] });
      }
    }
    for (const cap of caps) {
      const next = new Map<number, State>();
      for (const [used, state] of states) {
        for (const subset of subsets) {
          if ((used & subset.mask) || !valid(subset.members, cap)) continue;
          const allocation = [...state.allocation, subset.members];
          const value = score(allocation);
          const mask = used | subset.mask;
          const existing = next.get(mask);
          if (!existing || compare(value, existing.value) < 0) next.set(mask, { allocation, value });
        }
      }
      states = next;
    }
    const best = [...states.values()].sort((a, b) => compare(a.value, b.value))[0];
    if (best) explored.push(best.allocation);
  }

  const resultFor = (allocation: number[][]): RoutePlanResult => {
    const trips: PlannedTrip[] = allocation.flatMap((members, index) => members.length ? [{ ...group(members),
      riderId: available[index].rider_id, riderName: available[index].name }] : []);
    const assigned = new Set(allocation.flat());
    const unassignedOrders = input.filter((_, index) => !assigned.has(index));
    const totalRevenue = trips.reduce((sum, trip) => sum + trip.cost.revenue, 0);
    const totalCost = Number(trips.reduce((sum, trip) => sum + trip.cost.totalCost, 0).toFixed(2));
    const returnMinute = trips.length ? Math.max(...trips.map((trip) => trip.timing.returnMinute)) : null;
    const lateOrderCount = trips.reduce((sum, trip) => sum + trip.timing.lateOrderCount, 0);
    const warnings = [];
    if (unassignedOrders.length) warnings.push('ยังมีออเดอร์ที่จัดไม่ได้ ' + unassignedOrders.length + ' รายการ');
    if (lateOrderCount) warnings.push('มีออเดอร์ที่คาดว่าจะส่งช้า ' + lateOrderCount + ' รายการ');
    return { trips, unassignedOrders, warnings, summary: {
      assignedOrderCount: assigned.size, unassignedOrderCount: unassignedOrders.length,
      assignedBoxCount: trips.reduce((sum, trip) => sum + trip.totalBoxes, 0),
      usedRiderCount: trips.length, tripCount: trips.length, lateOrderCount,
      totalDistanceKm: Number(trips.reduce((sum, trip) => sum + Number(trip.route.totalDistanceKm.toFixed(2)), 0).toFixed(2)),
      lastDeliveryMinute: trips.length ? Math.max(...trips.map((trip) => trip.timing.lastDeliveryMinute!)) : null,
      returnMinute, elapsedMinutes: returnMinute === null ? 0 : Math.ceil(returnMinute - departure),
      totalRevenue, totalCost, estimatedPenalty: trips.reduce((sum, trip) => sum + trip.cost.estimatedPenalty, 0),
      profit: Number((totalRevenue - totalCost).toFixed(2)),
    } };
  };
  const unique = new Map<string, { allocation: number[][]; alternative: RoutePlanAlternative }>();
  for (const allocation of explored) {
    const result = resultFor(allocation);
    const id = routePlanSignature(result);
    if (!unique.has(id)) unique.set(id, { allocation, alternative: { id, result } });
  }
  return [...unique.values()].sort((a, b) => compare(score(a.allocation), score(b.allocation)) ||
    a.alternative.id.localeCompare(b.alternative.id)).slice(0, 3).map((entry) => entry.alternative);
}
