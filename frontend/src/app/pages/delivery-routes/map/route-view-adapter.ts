import type { Rider } from '../../../model/rider.model';
import type { PreparedPlanningOrders } from '../planning/planning-orders';
import type { RoutePlanResult } from '../planning/route-planner';
import { formatClockTime } from '../planning/route-timing';
import type { RouteStopView, RouteView } from './route-view';

export function toPendingStopViews(prepared: PreparedPlanningOrders | null): RouteStopView[] {
  return (prepared?.items ?? []).map(({ source, routing }) => ({
    id: routing.orderId,
    sequence: 0,
    customer: [source.customer_first_name, source.customer_last_name].filter(Boolean).join(' ') || `ออเดอร์ #${routing.orderId}`,
    phone: source.customer_phone || '',
    address: source.customer_address || 'ไม่ได้ระบุที่อยู่',
    boxes: routing.boxQuantity,
    latitude: routing.latitude,
    longitude: routing.longitude,
    eta: 'ยังไม่ได้จัดเส้นทาง',
    isLate: false,
    lateMinutes: 0,
  }));
}

const ROUTE_COLORS = [
  '#d94c60',
  '#168568',
  '#4873cf',
  '#8b5ac7',
  '#9a6700',
  '#087f8c',
  '#9c6644',
  '#6941c6',
  '#b4235c',
  '#526070',
] as const;

// แปลงผลคำนวณเป็นข้อมูลแสดงผล โดยจับคู่ลูกค้าด้วยรหัสออเดอร์
export function toRouteViews(
  plan: RoutePlanResult,
  prepared: PreparedPlanningOrders,
  riders: readonly Rider[],
): RouteView[] {
  const ordersById = new Map(prepared.items.map((item) => [item.source.order_id, item.source]));
  const ridersById = new Map(riders.map((rider) => [rider.rider_id, rider]));
  // ใช้รายชื่อทั้งชุด เพื่อให้คนเดิมมีสีเดิมเมื่อสลับแผนที่ใช้ไรเดอร์ไม่เท่ากัน
  const riderIds = [
    ...new Set([
      ...riders.map((rider) => rider.rider_id),
      ...plan.trips.map((trip) => trip.riderId),
    ]),
  ].sort((a, b) => a - b);
  const colorsByRider = new Map(
    riderIds.map((id, index) => [
      id,
      ROUTE_COLORS[index] ?? `hsl(${(index * 137.508) % 360} 65% 35%)`,
    ]),
  );

  return plan.trips.map((trip, index) => ({
    // รหัสสำหรับเลือกเส้นทางในหน้าจอเท่านั้น ไม่ใช่ route_plan_id ในฐานข้อมูล
    id: index + 1,
    riderId: trip.riderId,
    roundNumber: trip.roundNumber,
    name: trip.riderName,
    plate: ridersById.get(trip.riderId)?.vehicle_plate || 'ไม่ระบุทะเบียน',
    color: colorsByRider.get(trip.riderId)!,
    totalBoxes: trip.totalBoxes,
    distanceKm: trip.route.totalDistanceKm.toFixed(2),
    durationMinutes: Math.ceil(trip.timing.totalTravelMinutes),
    departureTime: formatClockTime(trip.departureMinute),
    lastArrival:
      trip.timing.lastDeliveryMinute === null
        ? '—'
        : formatClockTime(trip.timing.lastDeliveryMinute),
    returnTime: formatClockTime(trip.timing.returnMinute),
    riderIncome: trip.cost
      ? Number((trip.cost.dispatchCost + trip.cost.transportCost).toFixed(2))
      : undefined,
    dispatchFee: trip.cost?.dispatchCost,
    transportFee: trip.cost?.transportCost,
    stops: trip.timing.stops.map((stop) => {
      const source = ordersById.get(stop.orderId);

      return {
        id: stop.orderId,
        sequence: stop.sequence,
        customer:
          [source?.customer_first_name, source?.customer_last_name]
            .filter(Boolean)
            .join(' ')
            .trim() || `ออเดอร์ #${stop.orderId}`,
        phone: source?.customer_phone || '',
        address: source?.customer_address || 'ไม่ได้ระบุที่อยู่',
        boxes: stop.boxQuantity,
        latitude: stop.latitude,
        longitude: stop.longitude,
        eta: formatClockTime(stop.arrivalMinute),
        isLate: stop.isLate,
        lateMinutes: stop.lateMinutes,
      };
    }),
  }));
}
