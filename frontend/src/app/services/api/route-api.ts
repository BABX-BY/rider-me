import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { lastValueFrom } from 'rxjs';
import { Api } from '../../config/api';

export interface PlanningStoreResponse {
  businessDate: string;
  store: { store_id: number; store_name: string; latitude: number | string; longitude: number | string };
}

export interface SelectedPlanRequest {
  routeDate: string;
  storeId: number;
  storeLatitude: number;
  storeLongitude: number;
  orders: { orderId: number; customerId: number; boxQuantity: number; latitude: number; longitude: number }[];
  trips: { riderId: number; orderIds: number[] }[];
}

export interface ConfirmedPlanResponse {
  message: string;
  plans: { routePlanId: number; riderId: number; worksheetCode: string }[];
}

export interface RoutePlanRecord {
  route_plan_id: number;
  store_id: number;
  route_date: string;
  version: number;
  status: string;
  total_distance: number | string;
  estimated_minutes: number;
  total_cost: number | string;
  total_revenue: number | string;
  total_profit: number | string;
  calculated_at: string;
  worksheet_code: string;
  store_name: string;
  store_phone: string;
  store_address: string;
  store_latitude: number | string;
  store_longitude: number | string;
}

export interface RouteStopRecord {
  route_stop_id: number;
  route_plan_id: number;
  rider_id: number;
  rider_name: string;
  vehicle_plate: string;
  order_id: number;
  stop_sequence: number;
  distance_from_previous: number | string;
  estimated_arrival: string | null;
  delivery_status: string;
  delivered_at: string | null;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  customer_latitude: number | string | null;
  customer_longitude: number | string | null;
  box_quantity: number;
  order_date: string;
  order_status: string;
}

@Injectable({ providedIn: 'root' })
export class RouteApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(Api);

  async getRoutePlans(date?: string, status = 'SELECTED'): Promise<RoutePlanRecord[]> {
    let params = new HttpParams().set('status', status);
    if (date) params = params.set('date', date);
    return lastValueFrom(
      this.http.get<RoutePlanRecord[]>(`${this.api.API_ENDPOINT}/route-plans`, { params }),
    );
  }

  async getRouteStops(routePlanId: number): Promise<RouteStopRecord[]> {
    const params = new HttpParams().set('route_plan_id', routePlanId);
    return lastValueFrom(
      this.http.get<RouteStopRecord[]>(`${this.api.API_ENDPOINT}/route-stops`, { params }),
    );
  }

  async getPlanningStore(): Promise<PlanningStoreResponse> {
    return lastValueFrom(
      this.http.get<PlanningStoreResponse>(`${this.api.API_ENDPOINT}/route-plans/planning-store`),
    );
  }

  async confirmSelectedPlan(plan: SelectedPlanRequest): Promise<ConfirmedPlanResponse> {
    return lastValueFrom(
      this.http.post<ConfirmedPlanResponse>(`${this.api.API_ENDPOINT}/route-plans/confirm`, plan),
    );
  }

  async cancelTodayRoutes(): Promise<{
    message: string;
    canceled_plan_count: number;
    reset_order_count: number;
  }> {
    return lastValueFrom(
      this.http.post<{
        message: string;
        canceled_plan_count: number;
        reset_order_count: number;
      }>(`${this.api.API_ENDPOINT}/route-plans/cancel-today`, {}),
    );
  }
}
