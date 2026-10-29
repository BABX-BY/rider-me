import { DecimalPipe } from '@angular/common';
import { Component, computed, EventEmitter, inject, Output, signal } from '@angular/core';
import { toBangkokDateKey } from '../planning/planning-orders';
import { RouteMap } from './route-map';
import { PreviewRoute, PreviewStop, PreviewStore } from './delivery-routes.preview';
import { RouteApi, RoutePlanRecord, RouteStopRecord } from '../../../services/api/route-api';

@Component({
  selector: 'app-saved-delivery-routes',
  imports: [RouteMap, DecimalPipe],
  templateUrl: './delivery-routes.html',
  styleUrls: ['../delivery-routes.css', '../route-legend.css'],
})
export class SavedDeliveryRoutes {
  @Output() readonly planCanceled = new EventEmitter<void>();
  private readonly routeApi = inject(RouteApi);
  protected readonly loading = signal(true);
  protected readonly canceling = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly dataNotice = signal('');
  protected readonly businessDate = signal('');
  protected readonly businessDateLabel = computed(() =>
    this.businessDate() ? this.formatDateLabel(this.businessDate()) : 'กำลังโหลดวันที่ของร้าน...',
  );
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
  protected readonly estimatedPenalty = computed(() =>
    this.routes().reduce((total, route) => total + route.estimatedPenalty, 0),
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

  protected async cancelTodayRoutes(): Promise<void> {
    if (!window.confirm('ยืนยันยกเลิกใบงานของวันนี้หรือไม่? ออเดอร์จะกลับเป็นรอดำเนินการ และยังไม่ถูกลบ')) {
      return;
    }

    this.canceling.set(true);
    this.errorMessage.set('');
    try {
      const result = await this.routeApi.cancelTodayRoutes();
      this.dataNotice.set(`${result.message} (${result.reset_order_count} ออเดอร์)`);
      await this.loadRoutes();
      this.planCanceled.emit();
    } catch (error) {
      console.error('ไม่สามารถยกเลิกใบงานวันนี้ได้:', error);
      this.errorMessage.set('ยกเลิกใบงานไม่ได้ อาจมีออเดอร์ที่ส่งแล้วหรือส่งไม่สำเร็จแล้ว');
    } finally {
      this.canceling.set(false);
    }
  }

  private async loadRoutes(): Promise<void> {
    this.loading.set(true);
    this.showAllRoutes();
    this.errorMessage.set('');
    this.dataNotice.set('');
    try {
      const context = await this.routeApi.getPlanningStore();
      const today = context.businessDate;
      this.businessDate.set(today);
      const records = await this.routeApi.getRoutePlans(today, '');
      const plans = records.filter((plan) => plan.status === 'SELECTED' || plan.status === 'COMPLETED');
      if (plans.length === 0) {
        this.dataNotice.set(`ยังไม่มีใบงานของวันที่ ${this.formatDateLabel(today)}`);
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
      } else {
        this.store.set(null);
      }
    } catch (error) {
      console.error('ไม่สามารถโหลดเส้นทางจัดส่งได้:', error);
      this.errorMessage.set('ไม่สามารถโหลดข้อมูลเส้นทางจาก Backend ได้');
      this.routes.set([]);
      this.store.set(null);
      this.businessDate.set('');
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
    const date = toBangkokDateKey(plan.route_date);
    const deadline = date ? new Date(`${date}T12:30:00+07:00`).getTime() : Infinity;
    return {
      id: plan.route_plan_id,
      worksheetCode: plan.worksheet_code,
      estimatedPenalty: stops.filter((stop) =>
        stop.estimated_arrival && new Date(stop.estimated_arrival).getTime() > deadline,
      ).length * 20,
      name: firstStop?.rider_name ?? `ไรเดอร์ #${firstStop?.rider_id ?? '-'}`,
      plate: firstStop?.vehicle_plate ?? '-',
      color,
      totalBoxes: stops.reduce((total, stop) => total + Number(stop.box_quantity || 0), 0),
      distanceKm: Number(plan.total_distance || 0).toFixed(2),
      durationMinutes: Number(plan.estimated_minutes || 0),
      lastArrival: this.formatTime(lastStop?.estimated_arrival),
      revenue: Number(plan.total_revenue || 0),
      cost: Number(plan.total_revenue || 0) - Number(plan.total_profit || 0),
      profit: Number(plan.total_profit || 0),
      riderIncome: Number((15 + Number(plan.total_distance || 0) * stops.reduce((total, stop) => total + Number(stop.box_quantity || 0), 0) * 2).toFixed(2)),
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

  private formatTime(value: string | null | undefined): string {
    if (!value) return '-';
    return new Date(value).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
  }

  private formatDateLabel(value: string): string {
    const date = new Date(`${value}T00:00:00`);
    return date.toLocaleDateString('th-TH', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  private routeColor(index: number): string {
    const colors = ['#d94c60', '#168568', '#4873cf', '#d28b25', '#8b5cf6', '#0891b2'];
    return colors[index % colors.length];
  }
}
