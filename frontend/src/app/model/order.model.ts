export type OrderStatus = 'PENDING' | 'ASSIGNED' | 'DELIVERING' | 'DELIVERED' | 'CANCELLED';

export interface Order {
  order_id: number;
  box_quantity: number;
  order_date: string;
  status: OrderStatus;
  is_simulated: boolean;
  created_at: string;
  customer_id: number;
  customer_first_name: string;
  customer_last_name: string;
  customer_phone: string;
  customer_address: string;
  customer_latitude: string; // pg คืนค่า NUMERIC เป็น string
  customer_longitude: string;
  distance_km?: number; // มีเฉพาะผลจาก /orders/nearby
}
