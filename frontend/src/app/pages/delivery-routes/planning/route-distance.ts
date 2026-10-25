import type { RoutingOrder } from './planning-input';

// ใช้เฉพาะพิกัดจากข้อมูลที่เตรียมแล้ว
export type Coordinate = Pick<RoutingOrder, 'latitude' | 'longitude'>;

// รัศมีเฉลี่ยของโลก หน่วยกิโลเมตร
const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
    return degrees * Math.PI / 180;
}

// รับพิกัดตัวเลขที่ผ่านการตรวจแล้ว คืนระยะทางเป็นกิโลเมตร
export function calculateDistanceKm(
    start: Coordinate,
    end: Coordinate,
): number {
    const latitude1 = toRadians(start.latitude);
    const latitude2 = toRadians(end.latitude);

    const deltaLatitude = toRadians(end.latitude - start.latitude);
    const deltaLongitude = toRadians(end.longitude - start.longitude);

    const a =
        Math.sin(deltaLatitude / 2) ** 2 +
        Math.cos(latitude1) *
        Math.cos(latitude2) *
        Math.sin(deltaLongitude / 2) ** 2;

    // กันความคลาดเคลื่อนของเลขทศนิยมทำให้ค่าเกินช่วง 0–1
    const limitedA = Math.min(1, Math.max(0, a));

    const centralAngle =
        2 * Math.atan2(
            Math.sqrt(limitedA),
            Math.sqrt(1 - limitedA),
        );

    return EARTH_RADIUS_KM * centralAngle;
}

// ข้อมูลจุดส่ง พร้อมระยะทางที่คำนวณแล้ว
export interface RouteStopDistance extends RoutingOrder {
  sequence: number;
  distanceFromPreviousKm: number;
  cumulativeDistanceKm: number;
}

export interface RouteDistanceResult {
  stops: RouteStopDistance[];
  returnDistanceKm: number;
  totalDistanceKm: number;
}

export function calculateRouteDistance(
  store: Coordinate,
  orderedOrders: readonly RoutingOrder[],
): RouteDistanceResult {
  const stops: RouteStopDistance[] = [];

  let previous: Coordinate = store;
  let cumulativeDistanceKm = 0;

  for (let index = 0; index < orderedOrders.length; index++) {
    const order = orderedOrders[index];

    // วัดจากจุดก่อนหน้าไปยังลูกค้าคนปัจจุบัน
    const distanceFromPreviousKm = calculateDistanceKm(previous, order);

    cumulativeDistanceKm += distanceFromPreviousKm;

    stops.push({
      ...order,
      sequence: index + 1,
      distanceFromPreviousKm,
      cumulativeDistanceKm,
    });

    // ลูกค้าคนนี้กลายเป็นจุดเริ่มต้นของช่วงถัดไป
    previous = order;
  }

  // จากลูกค้าคนสุดท้ายกลับร้าน
  const returnDistanceKm =
    orderedOrders.length === 0
      ? 0
      : calculateDistanceKm(previous, store);

  return {
    stops,
    returnDistanceKm,
    totalDistanceKm: cumulativeDistanceKm + returnDistanceKm,
  };
}