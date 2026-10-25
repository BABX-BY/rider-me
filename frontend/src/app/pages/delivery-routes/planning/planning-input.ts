import type { Order } from '../../../model/order.model';

// เลือกเฉพาะข้อมูลที่เราต้องใช้จากโมเดล Order เดิม
type SourceOrder = Pick<
  Order,
  | 'order_id'
  | 'customer_id'
  | 'box_quantity'
  | 'customer_latitude'
  | 'customer_longitude'
>;

// ข้อมูลออเดอร์ที่พร้อมนำไปคำนวณ
export interface RoutingOrder {
  orderId: number;
  customerId: number;
  boxQuantity: number;
  latitude: number;
  longitude: number;
}

// สำเร็จจะได้ข้อมูลพร้อมใช้ ถ้าไม่สำเร็จจะได้เหตุผล
export type RoutingOrderResult =
  | { ok: true; value: RoutingOrder }
  | { ok: false; orderId: number; reason: string };

export function toRoutingOrder(order: SourceOrder): RoutingOrderResult {
  const latitudeText = String(order.customer_latitude ?? '').trim();
  const longitudeText = String(order.customer_longitude ?? '').trim();

  // ต้องตรวจค่าว่างก่อน เพราะ Number('') จะได้ 0
  if (latitudeText === '' || longitudeText === '') {
    return {
      ok: false,
      orderId: order.order_id,
      reason: 'ไม่ได้ระบุพิกัดจัดส่ง',
    };
  }

  const latitude = Number(latitudeText);
  const longitude = Number(longitudeText);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return {
      ok: false,
      orderId: order.order_id,
      reason: 'พิกัดจัดส่งไม่ถูกต้อง',
    };
  }

  if (
    !Number.isInteger(order.box_quantity) ||
    order.box_quantity < 1 ||
    order.box_quantity > 3
  ) {
    return {
      ok: false,
      orderId: order.order_id,
      reason: 'จำนวนกล่องต้องเป็นจำนวนเต็มระหว่าง 1–3',
    };
  }

  return {
    ok: true,
    value: {
      orderId: order.order_id,
      customerId: order.customer_id,
      boxQuantity: order.box_quantity,
      latitude,
      longitude,
    },
  };
}