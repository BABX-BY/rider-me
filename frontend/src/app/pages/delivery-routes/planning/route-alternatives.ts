import type { RoutingOrder } from './planning-input';
import type { Coordinate } from './route-distance';
import type { RouteGroupingOptions, RoutingRider } from './route-assignment';
import {
  planDeliveryRoutes,
  type RoutePlanResult,
  type RoutePlannerOptions,
} from './route-planner';

export interface RoutePlanAlternative {
  // รหัสเฉพาะสำหรับเปรียบเทียบทางเลือก ไม่ใช่รหัสแผนในฐานข้อมูล
  id: string;
  result: RoutePlanResult;
}

const GROUPING_CANDIDATES: readonly RouteGroupingOptions[] = [
  { groupingStrategy: 'nearest' },
  { groupingStrategy: 'sweep-clockwise', sweepStartDegrees: 0 },
  { groupingStrategy: 'sweep-clockwise', sweepStartDegrees: 120 },
  { groupingStrategy: 'sweep-clockwise', sweepStartDegrees: 240 },
  { groupingStrategy: 'sweep-counterclockwise', sweepStartDegrees: 0 },
  { groupingStrategy: 'sweep-counterclockwise', sweepStartDegrees: 120 },
  { groupingStrategy: 'sweep-counterclockwise', sweepStartDegrees: 240 },
  { groupingStrategy: 'farthest-seed' },
];

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// เปรียบเทียบงานและลำดับจริง โดยไม่นับการสลับชื่อ/รหัสไรเดอร์เป็นแผนใหม่
export function routePlanSignature(plan: RoutePlanResult): string {
  const tripsByRider = new Map<number, RoutePlanResult['trips']>();
  for (const trip of plan.trips) {
    const chain = tripsByRider.get(trip.riderId) ?? [];
    chain.push(trip);
    tripsByRider.set(trip.riderId, chain);
  }

  const chains = [...tripsByRider.values()].map((trips) =>
    [...trips]
      .sort((a, b) => a.roundNumber - b.roundNumber)
      .map((trip) => trip.route.stops.map((stop) => stop.orderId)),
  );
  chains.sort((a, b) => compareText(JSON.stringify(a), JSON.stringify(b)));

  return JSON.stringify({
    chains,
    unassigned: plan.unassignedOrders.map((order) => order.orderId).sort((a, b) => a - b),
  });
}

// กันเพียงความคลาดเคลื่อน floating point โดยไม่ปัดเลขที่ใช้คำนวณจริง
function compareMetric(a: number, b: number): number {
  const difference = a - b;
  return Math.abs(difference) <= 1e-9 ? 0 : difference < 0 ? -1 : 1;
}

function rankPlans(a: RoutePlanAlternative, b: RoutePlanAlternative): number {
  const first = a.result.summary;
  const second = b.result.summary;

  return (
    second.assignedOrderCount - first.assignedOrderCount ||
    first.lateOrderCount - second.lateOrderCount ||
    compareMetric(second.profit, first.profit) ||
    compareMetric(first.elapsedMinutes, second.elapsedMinutes) ||
    compareMetric(first.totalDistanceKm, second.totalDistanceKm) ||
    compareText(a.id, b.id)
  );
}

export function buildRoutePlanAlternatives(
  store: Coordinate,
  orders: readonly RoutingOrder[],
  riders: readonly RoutingRider[],
  options: RoutePlannerOptions,
): RoutePlanAlternative[] {
  const baselineResult = planDeliveryRoutes(store, orders, riders, options);
  const baseline = { id: routePlanSignature(baselineResult), result: baselineResult };
  const unique = new Map<string, RoutePlanAlternative>([[baseline.id, baseline]]);

  for (const grouping of GROUPING_CANDIDATES) {
    const result = planDeliveryRoutes(store, orders, riders, { ...options, ...grouping });
    const id = routePlanSignature(result);
    if (!unique.has(id)) unique.set(id, { id, result });
  }

  const ranked = [...unique.values()].sort(rankPlans);
  const best = ranked[0];
  const selected: RoutePlanAlternative[] = [];
  const include = (candidate: RoutePlanAlternative) => {
    if (selected.length < 3 && !selected.some((plan) => plan.id === candidate.id)) {
      selected.push(candidate);
    }
  };

  include(best);

  // เก็บตัวเลือกที่เร็วที่สุดในกลุ่มที่จัดได้เท่ากันและมีงานเลทน้อยที่สุดด้วย
  const fastest = ranked
    .filter(
      (plan) =>
        plan.result.summary.assignedOrderCount === best.result.summary.assignedOrderCount &&
        plan.result.summary.lateOrderCount === best.result.summary.lateOrderCount,
    )
    .sort(
      (a, b) =>
        compareMetric(a.result.summary.elapsedMinutes, b.result.summary.elapsedMinutes) ||
        rankPlans(a, b),
    )[0];
  include(fastest);
  include(baseline);

  for (const candidate of ranked) include(candidate);

  // เป็นตัวเลือกจากหลาย heuristic ไม่ใช่คำรับรองคำตอบที่ดีที่สุดทั่วทั้งระบบ
  return selected.sort(rankPlans);
}
