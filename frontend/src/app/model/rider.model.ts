export interface Rider {
  rider_id: number;
  name: string;
  phone: string;
  vehicle_plate: string;
  status: 'AVAILABLE' | 'BUSY' | 'INACTIVE' | string;
  max_orders_per_route: number;
}
