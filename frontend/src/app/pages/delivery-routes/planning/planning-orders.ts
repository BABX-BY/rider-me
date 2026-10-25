import type { Order } from '../../../model/order.model';
import { toRoutingOrder, type RoutingOrder } from './planning-input';
import { calculateDistanceKm, type Coordinate } from './route-distance';

const bangkokFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

function isCalendarDate(value: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;

    const date = new Date(value + 'T00:00:00Z');

    return (
        Number.isFinite(date.getTime()) &&
        date.getUTCFullYear() === Number(match[1]) &&
        date.getUTCMonth() + 1 === Number(match[2]) &&
        date.getUTCDate() === Number(match[3])
    );
}

// รับวันล้วน หรือวันเวลาที่มีเขตเวลา แล้วคืนวันแบบ YYYY-MM-DD
export function toBangkokDateKey(value: string | Date): string | null {
    let date: Date;

    if (typeof value === 'string') {
        const text = value.trim();
        const datePart = text.slice(0, 10);

        if (!isCalendarDate(datePart)) return null;
        if (text === datePart) return datePart;

        if (
            !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(text)
        ) {
            return null;
        }

        date = new Date(text);
    } else {
        date = value;
    }

    if (!Number.isFinite(date.getTime())) return null;

    const parts = bangkokFormatter.formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;

    return year + '-' + month + '-' + day;
}

export interface PreparedPlanningOrders {
    items: { source: Order; routing: RoutingOrder }[];
    rejected: { orderId: number; reason: string }[];
    ignoredCount: number;
}

export function preparePlanningOrders(
    store: Coordinate,
    selectedDate: string,
    orders: readonly Order[],
): PreparedPlanningOrders {
    if (!isCalendarDate(selectedDate)) {
        throw new Error('วันที่จัดส่งไม่ถูกต้อง');
    }

    if (
        !Number.isFinite(store.latitude) ||
        !Number.isFinite(store.longitude) ||
        store.latitude < -90 ||
        store.latitude > 90 ||
        store.longitude < -180 ||
        store.longitude > 180
    ) {
        throw new Error('พิกัดร้านไม่ถูกต้อง');
    }

    const prepared: PreparedPlanningOrders = {
        items: [],
        rejected: [],
        ignoredCount: 0,
    };

    for (const order of orders) {
        if (order.status !== 'PENDING') {
            prepared.ignoredCount += 1;
            continue;
        }

        const orderDate = toBangkokDateKey(order.order_date);

        if (orderDate === null) {
            prepared.rejected.push({
                orderId: order.order_id,
                reason: 'วันที่ออเดอร์ไม่ถูกต้องหรือไม่มีเขตเวลา',
            });
            continue;
        }

        if (orderDate !== selectedDate) {
            prepared.ignoredCount += 1;
            continue;
        }

        const result = toRoutingOrder(order);

        if (!result.ok) {
            prepared.rejected.push({
                orderId: result.orderId,
                reason: result.reason,
            });
            continue;
        }

        if (calculateDistanceKm(store, result.value) > 3) {
            prepared.rejected.push({
                orderId: order.order_id,
                reason: 'จุดส่งอยู่นอกรัศมี 3 กม.',
            });
            continue;
        }

        // เก็บข้อมูลลูกค้าเดิมไว้สำหรับนำไปแสดงบนแผนที่ด้วย
        prepared.items.push({
            source: order,
            routing: result.value,
        });
    }

    return prepared;
}