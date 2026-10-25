import type { Rider } from '../../../model/rider.model';
import type { RoutingOrder } from './planning-input';
import {
  calculateDistanceKm,
  calculateRouteDistance,
  type Coordinate,
  type RouteDistanceResult,
} from './route-distance';
import { orderByNearestNeighbor } from './route-ordering';

export type RoutingRider = Pick<Rider, 'rider_id' | 'name' | 'status' | 'max_orders_per_route'>;

export interface RiderAssignment {
  riderId: number;
  riderName: string;
  totalBoxes: number;
  route: RouteDistanceResult;
}

export interface RouteAssignmentResult {
  assignments: RiderAssignment[];
  unassignedOrders: RoutingOrder[];
}

export type RouteGroupingStrategy =
  'nearest' | 'sweep-clockwise' | 'sweep-counterclockwise' | 'farthest-seed';

export interface RouteGroupingOptions {
  groupingStrategy?: RouteGroupingStrategy;
  sweepStartDegrees?: number;
  // ใบงานจริงรองรับหนึ่งเส้นทางต่อไรเดอร์ ไม่แยกรอบกลับไปรับของเพิ่ม
  singleTripPerRider?: boolean;
}

function orderForGrouping(
  store: Coordinate,
  orders: readonly RoutingOrder[],
  options: RouteGroupingOptions,
): RoutingOrder[] {
  const strategy = options.groupingStrategy ?? 'nearest';

  if (strategy === 'nearest') return orderByNearestNeighbor(store, orders);

  if (strategy === 'farthest-seed') {
    const seed = [...orders].sort(
      (a, b) =>
        calculateDistanceKm(store, b) - calculateDistanceKm(store, a) || a.orderId - b.orderId,
    )[0];
    return seed
      ? [
          seed,
          ...orderByNearestNeighbor(
            seed,
            orders.filter((order) => order !== seed),
          ),
        ]
      : [];
  }

  if (strategy !== 'sweep-clockwise' && strategy !== 'sweep-counterclockwise') {
    throw new Error('วิธีจัดกลุ่มออเดอร์ไม่ถูกต้อง');
  }

  const start = options.sweepStartDegrees ?? 0;
  if (!Number.isFinite(start)) throw new Error('มุมเริ่มจัดกลุ่มไม่ถูกต้อง');

  const normalize = (angle: number) => ((angle % 360) + 360) % 360;
  const longitudeScale = Math.cos((store.latitude * Math.PI) / 180);
  const sweepAngle = (order: RoutingOrder) => {
    const bearing =
      (Math.atan2(
        (order.longitude - store.longitude) * longitudeScale,
        order.latitude - store.latitude,
      ) *
        180) /
      Math.PI;
    return strategy === 'sweep-clockwise' ? normalize(bearing - start) : normalize(start - bearing);
  };

  return [...orders].sort(
    (a, b) =>
      sweepAngle(a) - sweepAngle(b) ||
      calculateDistanceKm(store, a) - calculateDistanceKm(store, b) ||
      a.orderId - b.orderId,
  );
}

// แต่ละกลุ่มมีไม่เกิน 3 ออเดอร์ จึงลองลำดับได้มากที่สุดเพียง 6 แบบ
function shortestTripOrder(store: Coordinate, orders: readonly RoutingOrder[]): RoutingOrder[] {
  let best = [...orders];
  let bestDistance = calculateRouteDistance(store, best).totalDistanceKm;

  const visit = (prefix: RoutingOrder[], remaining: readonly RoutingOrder[]) => {
    if (remaining.length === 0) {
      const distance = calculateRouteDistance(store, prefix).totalDistanceKm;
      if (distance < bestDistance - 1e-9) {
        best = [...prefix];
        bestDistance = distance;
      }
      return;
    }
    for (let index = 0; index < remaining.length; index += 1) {
      visit(
        [...prefix, remaining[index]],
        remaining.filter((_, candidateIndex) => candidateIndex !== index),
      );
    }
  };

  visit([], orders);
  return best;
}

export function assignOrdersToRiders(
  store: Coordinate,
  orders: readonly RoutingOrder[],
  riders: readonly RoutingRider[],
  grouping: RouteGroupingOptions = {},
): RouteAssignmentResult {
  // รายการที่ยังไม่ได้มอบหมาย โดยไม่เปลี่ยนข้อมูลต้นฉบับ
  const remaining = [...orders];
  const assignments: RiderAssignment[] = [];

  for (const rider of riders) {
    if (remaining.length === 0) break;
    if (rider.status !== 'AVAILABLE') continue;

    if (!Number.isInteger(rider.max_orders_per_route) || rider.max_orders_per_route < 1) {
      throw new Error('จำนวนออเดอร์ต่อรอบของไรเดอร์ ' + rider.name + ' ไม่ถูกต้อง');
    }

    // ใช้ข้อจำกัดของไรเดอร์ แต่ไม่เกิน 3 ออเดอร์ตามโจทย์
    const maxOrders = Math.min(3, rider.max_orders_per_route);

    // ไรเดอร์แต่ละคนเริ่มค้นหาจุดส่งจากร้าน
    const nearbyOrders = orderForGrouping(store, remaining, grouping);
    const selected: RoutingOrder[] = [];
    let totalBoxes = 0;

    for (const order of nearbyOrders) {
      if (selected.length >= maxOrders) break;
      if (totalBoxes + order.boxQuantity > 10) continue;

      selected.push(order);
      totalBoxes += order.boxQuantity;

      // เอาออกจากรายการรอ เพื่อไม่มอบหมายซ้ำให้คนถัดไป
      remaining.splice(remaining.indexOf(order), 1);
    }

    if (selected.length === 0) continue;

    // เปรียบเทียบสองลำดับ เฉพาะออเดอร์ของไรเดอร์คนนี้
    const originalOrders = orders.filter((order) => selected.includes(order));

    const originalRoute = calculateRouteDistance(store, originalOrders);
    const strategy = grouping.groupingStrategy ?? 'nearest';
    const candidateRoute = calculateRouteDistance(
      store,
      strategy === 'nearest' ? selected : shortestTripOrder(store, selected),
    );

    const route =
      strategy !== 'nearest' || candidateRoute.totalDistanceKm < originalRoute.totalDistanceKm
        ? candidateRoute
        : originalRoute;

    assignments.push({
      riderId: rider.rider_id,
      riderName: rider.name,
      totalBoxes,
      route,
    });
  }

  return {
    assignments,
    unassignedOrders: remaining,
  };
}
