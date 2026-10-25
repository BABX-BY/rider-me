import type { RoutingOrder } from './planning-input';
import type { Coordinate } from './route-distance';
import {
  assignOrdersToRiders,
  type RiderAssignment,
  type RoutingRider,
  type RouteGroupingOptions,
} from './route-assignment';
import { calculateRouteTiming, type RouteTimingResult } from './route-timing';

export interface ScheduledTrip extends RiderAssignment {
  roundNumber: number;
  departureMinute: number;
  timing: RouteTimingResult;
}

export interface DeliverySchedule {
  trips: ScheduledTrip[];
  unassignedOrders: RoutingOrder[];
}

const MAX_ORDERS_PER_RIDER = 3;

export function scheduleDeliveryRounds(
  store: Coordinate,
  orders: readonly RoutingOrder[],
  riders: readonly RoutingRider[],
  departureMinute = 11 * 60 + 30,
  deadlineMinute = 12 * 60 + 30,
  speedKmh = 30,
  grouping: RouteGroupingOptions = {},
): DeliverySchedule {
  if (
    !Number.isFinite(departureMinute) ||
    departureMinute < 0 ||
    !Number.isFinite(deadlineMinute) ||
    deadlineMinute < 0 ||
    !Number.isFinite(speedKmh) ||
    speedKmh <= 0
  ) {
    throw new Error('เวลาและความเร็วที่ใช้จัดรอบไม่ถูกต้อง');
  }

  if (new Set(orders.map((order) => order.orderId)).size !== orders.length) {
    throw new Error('มีรหัสออเดอร์ซ้ำในข้อมูลที่นำมาจัดรอบ');
  }

  // เก็บเวลาที่ไรเดอร์แต่ละคนพร้อมออกเดินทาง
  const riderStates = riders
    .filter((rider) => rider.status === 'AVAILABLE')
    .map((rider, inputOrder) => ({
      rider,
      inputOrder,
      availableMinute: departureMinute,
      roundNumber: 0,
      assignedOrderCount: 0,
    }));

  if (new Set(riderStates.map((state) => state.rider.rider_id)).size !== riderStates.length) {
    throw new Error('มีรหัสไรเดอร์ซ้ำในข้อมูลที่นำมาจัดรอบ');
  }

  let remaining = [...orders];
  const trips: ScheduledTrip[] = [];

  while (remaining.length > 0 && riderStates.length > 0) {
    // รวมทุกรอบแล้ว ไรเดอร์หนึ่งคนรับได้ไม่เกิน 3 ออเดอร์ต่อแผน
    const eligibleRiders = riderStates.filter(
      (state) => state.assignedOrderCount < MAX_ORDERS_PER_RIDER &&
        (!grouping.singleTripPerRider || state.roundNumber === 0),
    );

    if (eligibleRiders.length === 0) break;

    // เลือกคนที่พร้อมเร็วที่สุด
    // ถ้าเวลาตรงกัน ให้คนที่วิ่งรอบน้อยกว่าออกก่อน
    eligibleRiders.sort(
      (a, b) =>
        a.availableMinute - b.availableMinute ||
        a.roundNumber - b.roundNumber ||
        a.inputOrder - b.inputOrder,
    );

    const next = eligibleRiders[0];

    // ตรวจค่าต้นฉบับก่อนลดโควตา เพื่อไม่ให้ค่าผิด เช่น Infinity ถูกแปลงเป็น 3
    if (!Number.isInteger(next.rider.max_orders_per_route) || next.rider.max_orders_per_route < 1) {
      throw new Error('จำนวนออเดอร์ต่อรอบของไรเดอร์ ' + next.rider.name + ' ไม่ถูกต้อง');
    }

    // จำกัดทั้งงานต่อรอบและโควตาที่เหลือของคนนี้ โดยไม่แก้ข้อมูลไรเดอร์เดิม
    const remainingAllowance = MAX_ORDERS_PER_RIDER - next.assignedOrderCount;
    const riderForTrip = {
      ...next.rider,
      max_orders_per_route: Math.min(next.rider.max_orders_per_route, remainingAllowance),
    };
    const result = assignOrdersToRiders(store, remaining, [riderForTrip], grouping);
    const assignment = result.assignments[0];

    if (!assignment) break;

    const timing = calculateRouteTiming(
      assignment.route,
      next.availableMinute,
      deadlineMinute,
      speedKmh,
    );

    next.roundNumber += 1;
    next.assignedOrderCount += assignment.route.stops.length;

    trips.push({
      ...assignment,
      roundNumber: next.roundNumber,
      departureMinute: next.availableMinute,
      timing,
    });

    // พร้อมรับรอบใหม่เมื่อกลับถึงร้าน
    next.availableMinute = timing.returnMinute;

    // รอบถัดไปใช้เฉพาะออเดอร์ที่ยังไม่ได้จัด
    remaining = result.unassignedOrders;
  }

  return {
    trips,
    unassignedOrders: remaining,
  };
}
