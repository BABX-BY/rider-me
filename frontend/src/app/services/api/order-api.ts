import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { lastValueFrom } from 'rxjs';
import { Api } from '../../config/api';
import { Customer } from '../../model/customer.model';
import { Order } from '../../model/order.model';

interface DeleteOrderResponse {
  message: string;
  order_id: number;
}

interface ClearOrdersResponse {
  message: string;
  deleted_count: number;
}

@Injectable({
  providedIn: 'root',
})
export class OrderApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(Api);

  async getOrders(date?: string): Promise<Order[]> {
    const url = `${this.api.API_ENDPOINT}/orders`;
    const params = date ? new HttpParams().set('date', date) : undefined;
    return await lastValueFrom(this.http.get<Order[]>(url, { params }));
  }

  async createOrder(customerId: number, boxQuantity: number): Promise<Order> {
    const url = `${this.api.API_ENDPOINT}/orders`;
    return await lastValueFrom(
      this.http.post<Order>(url, { customer_id: customerId, box_quantity: boxQuantity }),
    );
  }

  async simulateOrders(items: Array<{ customer_id: number; box_quantity: number }>): Promise<Order[]> {
    const url = `${this.api.API_ENDPOINT}/orders/simulate`;
    return await lastValueFrom(this.http.post<Order[]>(url, { items }));
  }

  async getSimulationCustomers(): Promise<Customer[]> {
    const url = `${this.api.API_ENDPOINT}/orders/simulation-customers`;
    return await lastValueFrom(this.http.get<Customer[]>(url));
  }

  async updateOrder(orderId: number, boxQuantity: number): Promise<Order> {
    const url = `${this.api.API_ENDPOINT}/orders/${orderId}`;
    return await lastValueFrom(this.http.patch<Order>(url, { box_quantity: boxQuantity }));
  }

  async deleteOrder(orderId: number): Promise<DeleteOrderResponse> {
    const url = `${this.api.API_ENDPOINT}/orders/${orderId}`;
    return await lastValueFrom(this.http.delete<DeleteOrderResponse>(url));
  }

  async clearOrders(): Promise<ClearOrdersResponse> {
    const url = `${this.api.API_ENDPOINT}/orders`;
    return await lastValueFrom(this.http.delete<ClearOrdersResponse>(url));
  }

  async getNearbyOrders(latitude: number, longitude: number, radiusKm = 3): Promise<Order[]> {
    const url = `${this.api.API_ENDPOINT}/orders/nearby`;
    const params = new HttpParams()
      .set('latitude', latitude)
      .set('longitude', longitude)
      .set('radius_km', radiusKm);
    return await lastValueFrom(this.http.get<Order[]>(url, { params }));
  }
}
