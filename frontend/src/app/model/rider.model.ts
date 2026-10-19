export interface Rider {
  rider_id: number;
  name: string;
  phone: string;
  vehicle_plate: string;
  status: 'AVAILABLE' | 'BUSY' | 'INACTIVE' | string;
  max_orders_per_route: number;
  worksheet_code?: string | null;
  order_count?: number;
  delivered_order_count?: number;
  pending_order_count?: number;
  failed_order_count?: number;
  total_box_count?: number;
  delivered_box_count?: number;
  pending_box_count?: number;
  failed_box_count?: number;
}
