import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouteMap } from './route-map';
import { PreviewRoute, PreviewStop, PreviewStore } from './delivery-routes.preview';
import { RouteApi, RoutePlanRecord, RouteStopRecord } from '../../services/api/route-api';

@Component({
  selector: 'app-delivery-routes',
  imports: [RouteMap, DecimalPipe],
  templateUrl: './delivery-routes.html',
  styleUrls: ['./delivery-routes.css', './route-legend.css'],
})
export class DeliveryRoutes {
  private readonly routeApi = inject(RouteApi);
  protected readonly loading = signal(true);
  protected readonly generating = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly dataNotice = signal('');
  protected readonly activeRouteId = signal<number | null>(null);
  protected readonly selectedStopId = signal<number | null>(null);
  protected readonly store = signal<PreviewStore | null>(null);
  protected readonly routes = signal<readonly PreviewRoute[]>([]);
  protected readonly totalOrders = computed(() =>
    this.routes().reduce((total, route) => total + route.stops.length, 0),
  );
  protected readonly totalBoxes = computed(() =>
    this.routes().reduce((total, route) => total + route.totalBoxes, 0),
  );
  protected readonly totalDistance = computed(() =>
    this.routes().reduce((total, route) => total + Number(route.distanceKm || 0), 0),
  );
  protected readonly totalDuration = computed(() =>
    this.routes().reduce((total, route) => Math.max(total, route.durationMinutes), 0),
  );
  protected readonly totalRevenue = computed(() =>
    this.routes().reduce((total, route) => total + (route.revenue ?? 0), 0),
  );
  protected readonly totalCost = computed(() =>
    this.routes().reduce((total, route) => total + (route.cost ?? 0), 0),
  );
  protected readonly totalProfit = computed(() =>
    this.routes().reduce((total, route) => total + (route.profit ?? 0), 0),
  );

  constructor() {
    void this.loadRoutes();
  }

  protected showAllRoutes(): void {
    this.activeRouteId.set(null);
    this.selectedStopId.set(null);
  }

  protected refreshRoutes(): void {
    void this.loadRoutes();
  }

  protected selectRoute(id: number): void {
    this.activeRouteId.set(this.activeRouteId() === id ? null : id);
    this.selectedStopId.set(null);
  }

  protected selectStop(id: number): void {
    const route = this.routes().find((item) => item.stops.some((stop) => stop.id === id));
    if (route) {
      this.activeRouteId.set(route.id);
      this.selectedStopId.set(id);
    }
  }

  protected async generateRoutes(): Promise<void> {
    this.generating.set(true);
    this.errorMessage.set('');
    try {
      await this.routeApi.generateTodayRoutes();
      await this.loadRoutes();
    } catch (error) {
      console.error('ไม่สามารถสร้างใบงานของวันนี้ได้:', error);
      this.errorMessage.set('ไม่สามารถจัดเส้นทางของวันนี้ได้');
    } finally {
      this.generating.set(false);
    }
  }

  private async loadRoutes(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set('');
    this.dataNotice.set('');
    try {
      let plans = await this.routeApi.getRoutePlans(this.today());
      if (plans.length === 0) {
        const availablePlans = await this.routeApi.getRoutePlans();
        const latestDate = availablePlans[0]?.route_date;
        plans = latestDate
          ? availablePlans.filter((plan) => plan.route_date === latestDate)
          : [];
        if (plans.length > 0) {
          this.dataNotice.set(
            `ยังไม่มีใบงานของวันนี้ กำลังแสดงใบงานที่เลือกไว้วันที่ ${latestDate}`,
          );
        }
      }
      const routeData = await Promise.all(
        plans.map(async (plan, index) => ({
          plan,
          stops: await this.routeApi.getRouteStops(plan.route_plan_id),
          color: this.routeColor(index),
        })),
      );
      this.routes.set(routeData.map(({ plan, stops, color }) => this.toPreviewRoute(plan, stops, color)));
      const firstPlan = plans[0];
      if (firstPlan) {
        this.store.set({
          name: firstPlan.store_name,
          phone: firstPlan.store_phone,
          address: firstPlan.store_address,
          latitude: Number(firstPlan.store_latitude),
          longitude: Number(firstPlan.store_longitude),
        });
      }
    } catch (error) {
      console.error('ไม่สามารถโหลดเส้นทางจัดส่งได้:', error);
      this.errorMessage.set('ไม่สามารถโหลดข้อมูลเส้นทางจาก Backend ได้');
      this.routes.set([]);
      this.store.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  private toPreviewRoute(
    plan: RoutePlanRecord,
    stops: readonly RouteStopRecord[],
    color: string,
  ): PreviewRoute {
    const firstStop = stops[0];
    const lastStop = stops[stops.length - 1];
    return {
      id: plan.route_plan_id,
      name: firstStop?.rider_name ?? `ไรเดอร์ #${firstStop?.rider_id ?? '-'}`,
      plate: firstStop?.vehicle_plate ?? '-',
      color,
      totalBoxes: stops.reduce((total, stop) => total + Number(stop.box_quantity || 0), 0),
      distanceKm: Number(plan.total_distance || 0).toFixed(2),
      durationMinutes: Number(plan.estimated_minutes || 0),
      lastArrival: this.formatTime(lastStop?.estimated_arrival),
      revenue: Number(plan.total_revenue || 0),
      cost: Number(plan.total_cost || 0),
      profit: Number(plan.total_profit || 0),
      deliveredStops: stops.filter((stop) => stop.delivery_status === 'DELIVERED').length,
      pendingStops: stops.filter((stop) => stop.delivery_status !== 'DELIVERED').length,
      stops: stops.map((stop): PreviewStop => ({
        id: stop.route_stop_id,
        sequence: stop.stop_sequence,
        customer: stop.customer_name,
        address: stop.customer_address,
        boxes: Number(stop.box_quantity || 0),
        latitude: Number(stop.customer_latitude),
        longitude: Number(stop.customer_longitude),
        eta: this.formatTime(stop.estimated_arrival),
      })),
    };
  }

  private today(): string {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
  }

  private formatTime(value: string | null | undefined): string {
    if (!value) return '-';
    return new Date(value).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  }

  private routeColor(index: number): string {
    const colors = ['#d94c60', '#168568', '#4873cf', '#d28b25', '#8b5cf6', '#0891b2'];
    return colors[index % colors.length];
  }
}
