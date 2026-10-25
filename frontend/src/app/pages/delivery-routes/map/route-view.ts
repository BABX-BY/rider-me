export interface RouteMapStore {
  name: string;
  latitude: number;
  longitude: number;
}

export interface RouteStopView {
  // Use the order ID so selection stays unique across riders and rounds.
  id: number;
  sequence: number;
  customer: string;
  phone: string;
  address: string;
  boxes: number;
  latitude: number;
  longitude: number;
  eta: string;
  isLate: boolean;
  lateMinutes: number;
}

export interface RouteView {
  // Unique trip ID within the current plan, distinct from the rider ID.
  id: number;
  riderId: number;
  roundNumber: number;
  name: string;
  plate: string;
  color: string;
  totalBoxes: number;
  distanceKm: string;
  durationMinutes: number;
  departureTime: string;
  lastArrival: string;
  returnTime: string;
  stops: readonly RouteStopView[];
}
