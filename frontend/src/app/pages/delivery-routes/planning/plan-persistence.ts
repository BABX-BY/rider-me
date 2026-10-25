import type { SelectedPlanRequest } from '../../../services/api/route-api';
import type { RoutePlanResult } from './route-planner';

export interface PlanningStore {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
}

// ส่งลำดับออเดอร์ของแผนที่เลือก พร้อมข้อมูลที่ใช้คำนวณสำหรับตรวจว่าข้อมูลยังไม่เปลี่ยน
export function toSelectedPlanRequest(
  store: PlanningStore,
  routeDate: string,
  plan: RoutePlanResult,
): SelectedPlanRequest {
  return {
    routeDate,
    storeId: store.id,
    storeLatitude: store.latitude,
    storeLongitude: store.longitude,
    trips: plan.trips.map((trip) => ({
      riderId: trip.riderId,
      orderIds: trip.route.stops.map((stop) => stop.orderId),
    })),
    orders: plan.trips.flatMap((trip) => trip.route.stops.map((stop) => ({
      orderId: stop.orderId,
      customerId: stop.customerId,
      boxQuantity: stop.boxQuantity,
      latitude: stop.latitude,
      longitude: stop.longitude,
    }))),
  };
}
