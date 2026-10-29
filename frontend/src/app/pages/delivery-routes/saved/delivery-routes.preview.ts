// Display models for records read from the worksheet API.
export interface PreviewStop {
  id: number;
  sequence: number;
  customer: string;
  address: string;
  boxes: number;
  latitude: number;
  longitude: number;
  eta: string;
}

export interface PreviewRoute {
  id: number;
  worksheetCode: string;
  estimatedPenalty: number;
  name: string;
  plate: string;
  color: string;
  totalBoxes: number;
  distanceKm: string;
  durationMinutes: number;
  lastArrival: string;
  revenue?: number;
  cost?: number;
  profit?: number;
  deliveredStops?: number;
  pendingStops?: number;
  stops: readonly PreviewStop[];
  riderIncome?: number;
}

export interface PreviewStore {
  name: string;
  phone: string;
  address: string;
  latitude: number;
  longitude: number;
}

