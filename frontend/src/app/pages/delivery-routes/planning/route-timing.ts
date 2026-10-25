import type {
    RouteDistanceResult,
    RouteStopDistance,
} from './route-distance';

export interface RouteStopTiming extends RouteStopDistance {
    arrivalMinute: number;
    lateMinutes: number;
    isLate: boolean;
}

export interface RouteTimingResult {
    stops: RouteStopTiming[];
    totalTravelMinutes: number;
    lastDeliveryMinute: number | null;
    returnMinute: number;
    lateOrderCount: number;
}

export function calculateRouteTiming(
    route: RouteDistanceResult,
    departureMinute = 11 * 60 + 30,
    deadlineMinute = 12 * 60 + 30,
    speedKmh = 30,
): RouteTimingResult {
    if (!Number.isFinite(speedKmh) || speedKmh <= 0) {
        throw new Error('ความเร็วต้องเป็นตัวเลขมากกว่า 0');
    }

    if (
        !Number.isFinite(departureMinute) ||
        departureMinute < 0 ||
        !Number.isFinite(deadlineMinute) ||
        deadlineMinute < 0
    ) {
        throw new Error(
            'เวลาออกเดินทางและเวลาส่งภายในต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป',
        );
    }

    const stops = route.stops.map((stop) => {
        // ระยะสะสมจากร้านถึงลูกค้าคนนี้ แปลงเป็นนาที
        const elapsedMinutes =
            stop.cumulativeDistanceKm / speedKmh * 60;

        const arrivalMinute = departureMinute + elapsedMinutes;

        // ถึงตรงเวลา 12:30 พอดี ยังถือว่าส่งทัน
        const lateMinutes = Math.max(0, arrivalMinute - deadlineMinute);

        return {
            ...stop,
            arrivalMinute,
            lateMinutes,
            isLate: lateMinutes > 0,
        };
    });

    // ระยะรวมมีช่วงกลับร้านรวมอยู่แล้ว
    const totalTravelMinutes =
        route.totalDistanceKm / speedKmh * 60;

    return {
        stops,
        totalTravelMinutes,
        lastDeliveryMinute: stops.at(-1)?.arrivalMinute ?? null,
        returnMinute: departureMinute + totalTravelMinutes,
        lateOrderCount: stops.filter((stop) => stop.isLate).length,
    };
}

// แปลงนาทีตั้งแต่เที่ยงคืน เป็นข้อความสำหรับแสดงผล
export function formatClockTime(minutes: number): string {
    if (!Number.isFinite(minutes) || minutes < 0) {
        throw new Error('เวลาต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
    }

    // ปัดขึ้นเป็นวินาทีเฉพาะตอนแสดงผล
    const totalSeconds = Math.ceil(minutes * 60);
    const hours = Math.floor(totalSeconds / 3600);
    const minutePart = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return [hours, minutePart, seconds]
        .map((part) => String(part).padStart(2, '0'))
        .join(':');
}