import type { ScheduledTrip } from './route-scheduler';

export const COST_RULES = {
    pricePerBox: 65,
    foodCostPerBox: 40,
    dispatchCostPerTrip: 15,
    transportCostPerKmPerBox: 2,
    latePenaltyPerOrder: 20,
} as const;

export interface TripCostResult {
    revenue: number;
    foodCost: number;
    dispatchCost: number;
    transportCost: number;
    estimatedPenalty: number;
    totalCost: number;
    profit: number;
}

export function calculateTripCost(
    trip: ScheduledTrip,
    includeReturnDistance: boolean,
): TripCostResult {
    // เลือกระยะสำหรับคิดเงิน โดยไม่เปลี่ยนระยะและเวลาวิ่งจริง
    const distanceKm = includeReturnDistance
        ? trip.route.totalDistanceKm
        : trip.route.totalDistanceKm - trip.route.returnDistanceKm;

    const revenue = trip.totalBoxes * COST_RULES.pricePerBox;

    const foodCost = trip.totalBoxes * COST_RULES.foodCostPerBox;

    // คิดทุกครั้งที่ออกส่ง แม้เป็นไรเดอร์คนเดิม
    const dispatchCost = COST_RULES.dispatchCostPerTrip;

    const transportCost =
        distanceKm *
        trip.totalBoxes *
        COST_RULES.transportCostPerKmPerBox;

    // ค่าปรับคิดต่อออเดอร์ ไม่ได้คูณจำนวนกล่อง
    const estimatedPenalty =
        trip.timing.lateOrderCount * COST_RULES.latePenaltyPerOrder;

    const totalCost =
        Number((foodCost + dispatchCost + transportCost + estimatedPenalty).toFixed(2));

    return {
        revenue,
        foodCost,
        dispatchCost,
        transportCost,
        estimatedPenalty,
        totalCost,
        profit: Number((revenue - totalCost).toFixed(2)),
    };
}
