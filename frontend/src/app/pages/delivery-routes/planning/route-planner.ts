import type { RoutingOrder } from './planning-input';
import type { Coordinate } from './route-distance';
import type { RouteGroupingOptions, RoutingRider } from './route-assignment';
import { scheduleDeliveryRounds, type ScheduledTrip } from './route-scheduler';
import { calculateTripCost, type TripCostResult } from './route-cost';

export interface RoutePlannerOptions extends RouteGroupingOptions {
  includeReturnDistance: boolean;
  departureMinute?: number;
  deadlineMinute?: number;
  speedKmh?: number;
}

export interface PlannedTrip extends ScheduledTrip {
  cost: TripCostResult;
}

export interface RoutePlanSummary {
  assignedOrderCount: number;
  unassignedOrderCount: number;
  assignedBoxCount: number;
  usedRiderCount: number;
  tripCount: number;
  lateOrderCount: number;
  totalDistanceKm: number;
  lastDeliveryMinute: number | null;
  returnMinute: number | null;
  elapsedMinutes: number;
  totalRevenue: number;
  totalCost: number;
  estimatedPenalty: number;
  profit: number;
}

export interface RoutePlanResult {
  trips: PlannedTrip[];
  unassignedOrders: RoutingOrder[];
  summary: RoutePlanSummary;
  warnings: string[];
}

export function planDeliveryRoutes(
  store: Coordinate,
  orders: readonly RoutingOrder[],
  riders: readonly RoutingRider[],
  options: RoutePlannerOptions,
): RoutePlanResult {
  const departureMinute = options.departureMinute ?? 11 * 60 + 30;
  const deadlineMinute = options.deadlineMinute ?? 12 * 60 + 30;
  const speedKmh = options.speedKmh ?? 30;

  // 1. จัดงานหลายรอบและคำนวณเวลา
  const schedule = scheduleDeliveryRounds(
    store,
    orders,
    riders,
    departureMinute,
    deadlineMinute,
    speedKmh,
    options,
  );

  // 2. เพิ่มต้นทุนให้แต่ละรอบ
  const trips: PlannedTrip[] = schedule.trips.map((trip) => ({
    ...trip,
    cost: calculateTripCost(trip, options.includeReturnDistance),
  }));

  // 3. หาเวลาส่งสุดท้ายและเวลากลับร้านล่าสุดจากทุกรอบ
  let lastDeliveryMinute: number | null = null;
  let returnMinute: number | null = null;

  for (const trip of trips) {
    const lastDelivery = trip.timing.lastDeliveryMinute;

    if (lastDelivery !== null) {
      lastDeliveryMinute = Math.max(lastDeliveryMinute ?? lastDelivery, lastDelivery);
    }

    returnMinute = Math.max(returnMinute ?? trip.timing.returnMinute, trip.timing.returnMinute);
  }

  const totalRevenue = trips.reduce((sum, trip) => sum + trip.cost.revenue, 0);

  const totalCost = trips.reduce((sum, trip) => sum + trip.cost.totalCost, 0);

  // 4. รวมเฉพาะออเดอร์ที่จัดลงแผนแล้ว
  const summary: RoutePlanSummary = {
    assignedOrderCount: trips.reduce((sum, trip) => sum + trip.route.stops.length, 0),
    unassignedOrderCount: schedule.unassignedOrders.length,
    assignedBoxCount: trips.reduce((sum, trip) => sum + trip.totalBoxes, 0),
    usedRiderCount: new Set(trips.map((trip) => trip.riderId)).size,
    tripCount: trips.length,
    lateOrderCount: trips.reduce((sum, trip) => sum + trip.timing.lateOrderCount, 0),
    // รวมค่าที่แต่ละใบงานจัดเก็บจริง (ระยะ 2 ตำแหน่ง) โดยยังใช้ระยะเต็มคำนวณเวลา/ต้นทุน
    totalDistanceKm: Number(trips.reduce((sum, trip) => sum + Number(trip.route.totalDistanceKm.toFixed(2)), 0).toFixed(2)),
    lastDeliveryMinute,
    returnMinute,
    elapsedMinutes: returnMinute === null ? 0 : Math.ceil(returnMinute - departureMinute),
    totalRevenue: Number(totalRevenue.toFixed(2)),
    totalCost: Number(totalCost.toFixed(2)),
    estimatedPenalty: trips.reduce((sum, trip) => sum + trip.cost.estimatedPenalty, 0),
    profit: Number((totalRevenue - totalCost).toFixed(2)),
  };

  // 5. เตรียมคำเตือนให้หน้าเว็บนำไปแสดง
  const warnings: string[] = [];

  if (summary.unassignedOrderCount > 0) {
    warnings.push('ยังมีออเดอร์ที่จัดไม่ได้ ' + summary.unassignedOrderCount + ' รายการ');
  }

  if (summary.lateOrderCount > 0) {
    warnings.push('มีออเดอร์ที่คาดว่าจะส่งช้า ' + summary.lateOrderCount + ' รายการ');
  }

  return {
    trips,
    unassignedOrders: schedule.unassignedOrders,
    summary,
    warnings,
  };
}
