export type RiderStopStatus = 'PENDING' | 'DELIVERED' | 'FAILED';
export type RiderWorkStopStatus = RiderStopStatus;

export interface RiderWorkStop {
  routeStopId: number;
  sequence: number;
  orderId: number;
  customerName: string;
  address: string;
  boxes: number;
  latitude: number | null;
  longitude: number | null;
  status: RiderStopStatus;
}

export interface RiderWorkSummary {
  workDate: string;
  totalBoxes: number;
  totalStops: number;
  deliveredStops: number;
  pendingStops: number;
  storeName: string;
  storePhone: string;
  storeAddress: string;
  storeLatitude: number | null;
  storeLongitude: number | null;
  stops: RiderWorkStop[];
}
