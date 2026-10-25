import type { RoutingOrder } from './planning-input';
import { calculateDistanceKm, type Coordinate } from './route-distance';

export function orderByNearestNeighbor(
    store: Coordinate,
    orders: readonly RoutingOrder[],
): RoutingOrder[] {
    // สำเนารายการ เพื่อไม่ให้การจัดลำดับเปลี่ยนข้อมูลต้นฉบับ
    const remaining = [...orders];
    const ordered: RoutingOrder[] = [];

    let current: Coordinate = store;

    while (remaining.length > 0) {
        let nearestIndex = 0;
        let nearestDistanceKm = Infinity;

        // เปรียบเทียบระยะจากตำแหน่งปัจจุบันไปยังทุกออเดอร์ที่เหลือ
        for (let index = 0; index < remaining.length; index++) {
            const distanceKm = calculateDistanceKm(current, remaining[index]);

            if (distanceKm < nearestDistanceKm) {
                nearestIndex = index;
                nearestDistanceKm = distanceKm;
            }
        }

        // นำออเดอร์ที่ใกล้ที่สุดออกจากรายการรอ แล้วเพิ่มเข้าลำดับส่ง
        const [nextOrder] = remaining.splice(nearestIndex, 1);

        ordered.push(nextOrder);

        // รอบถัดไปจะวัดระยะจากลูกค้าคนที่เพิ่งเลือก
        current = nextOrder;
    }

    return ordered;
}