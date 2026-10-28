import { SavedDeliveryRoutes } from './saved/delivery-routes';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Component, computed, inject, type OnInit, signal } from '@angular/core';
import type { Rider } from '../../model/rider.model';
import { OrderApi } from '../../services/api/order-api';
import { RiderApi } from '../../services/api/rider-api';
import { RouteApi, type ConfirmedPlanResponse } from '../../services/api/route-api';
import { RouteMap } from './map/route-map';
import { toPendingStopViews, toRouteViews } from './map/route-view-adapter';
import { toSelectedPlanRequest, type PlanningStore } from './planning/plan-persistence';
import type { RoutePlanAlternative } from './planning/route-alternatives';
import { optimizeDeliveryRoutes } from './planning/route-optimizer';
import {
  preparePlanningOrders,
  type PreparedPlanningOrders,
} from './planning/planning-orders';

@Component({
  selector: 'app-delivery-routes',
  imports: [RouteMap, DecimalPipe, SavedDeliveryRoutes, RouterLink],
  templateUrl: './delivery-routes.html',
  styleUrls: ['./delivery-routes.css', './route-legend.css'],
})
export class DeliveryRoutes implements OnInit {
  protected readonly view = signal<'planning' | 'saved'>('planning');
  private readonly orderApi = inject(OrderApi);
  private readonly riderApi = inject(RiderApi);
  private readonly routeApi = inject(RouteApi);

  protected readonly store = signal<PlanningStore | null>(null);
  protected readonly businessDate = signal('');
  protected readonly businessDateLabel = computed(() => {
    const date = this.businessDate();
    return date
      ? new Date(`${date}T00:00:00+07:00`).toLocaleDateString('th-TH', {
          day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok',
        })
      : 'กำลังโหลดวันที่ของร้าน...';
  });
  protected readonly dataLoading = signal(false);
  protected readonly saving = signal(false);
  protected readonly calculating = signal(false);
  protected readonly busy = computed(() => this.dataLoading() || this.saving() || this.calculating());
  protected readonly confirmation = signal<ConfirmedPlanResponse | null>(null);
  protected readonly saveError = signal('');
  protected readonly dataError = signal('');
  protected readonly preparedOrders = signal<PreparedPlanningOrders | null>(null);
  protected readonly todayOrderCount = signal(0);
  protected readonly savedPlanCount = signal(0);
  protected readonly pendingStops = computed(() => this.planResult() ? [] : toPendingStopViews(this.preparedOrders()));
  protected readonly pendingBoxCount = computed(() =>
    this.preparedOrders()?.items.reduce((sum, item) => sum + item.routing.boxQuantity, 0) ?? 0,
  );
  protected readonly availableRiders = signal<Rider[]>([]);
  protected readonly planAlternatives = signal<RoutePlanAlternative[]>([]);
  protected readonly selectedAlternativeId = signal<string | null>(null);
  protected readonly selectedAlternativeNumber = computed(
    () => this.planAlternatives().findIndex((plan) => plan.id === this.selectedAlternativeId()) + 1,
  );
  protected readonly alternativeMessage = signal('');
  protected readonly planResult = computed(
    () =>
      this.planAlternatives().find((plan) => plan.id === this.selectedAlternativeId())?.result ??
      null,
  );
  protected readonly costBreakdown = computed(() => {
    const trips = this.planResult()?.trips ?? [];
    const sum = (key: 'foodCost' | 'dispatchCost') =>
      Number(trips.reduce((total, trip) => total + trip.cost[key], 0).toFixed(2));
    // ยอดต่อใบงานปัดเป็นสตางค์แล้ว จัดส่วนขนส่งให้บวกกลับได้ตรงกับยอดที่บันทึก
    const transport = Number(trips.reduce((total, { cost }) => total + cost.totalCost -
      cost.foodCost - cost.dispatchCost - cost.estimatedPenalty, 0).toFixed(2));
    return { food: sum('foodCost'), dispatch: sum('dispatchCost'), transport };
  });
  protected readonly planError = signal('');
  protected readonly calculationTime = signal('');
  protected readonly usedRiderCount = computed(
    () => this.planResult()?.summary.usedRiderCount ?? 0,
  );
  protected readonly canConfirm = computed(() =>
    !this.busy() && !this.confirmation() && !!this.store() &&
    !!this.businessDate() && this.savedPlanCount() === 0 && (this.planResult()?.trips.length ?? 0) > 0,
  );

  protected readonly activeRouteId = signal<number | null>(null);
  protected readonly selectedStopId = signal<number | null>(null);
  protected readonly routes = computed(() => {
    const plan = this.planResult();
    const prepared = this.preparedOrders();

    return plan && prepared ? toRouteViews(plan, prepared, this.availableRiders()) : [];
  });

  ngOnInit(): void {
    void this.loadPlanningData();
  }

  protected async loadPlanningData(): Promise<void> {
    if (this.busy()) return;

    this.planAlternatives.set([]);
    this.selectedAlternativeId.set(null);
    this.alternativeMessage.set('');
    this.planError.set('');
    this.calculationTime.set('');
    this.showAllRoutes();
    this.dataLoading.set(true);
    this.dataError.set('');
    this.preparedOrders.set(null);
    this.availableRiders.set([]);
    this.store.set(null);
    this.businessDate.set('');
    this.confirmation.set(null);
    this.saveError.set('');
    this.todayOrderCount.set(0);
    this.savedPlanCount.set(0);

    try {
      // Backend เป็นผู้กำหนดวันของร้าน เหมือนหน้าออเดอร์ ไม่อิงนาฬิกาหรือวันที่จากผู้ใช้
      const context = await this.routeApi.getPlanningStore();
      const date = context.businessDate;
      const [orders, riders, savedPlans] = await Promise.all([
        this.orderApi.getOrders(date),
        this.riderApi.getRiders(),
        this.routeApi.getRoutePlans(date, ''),
      ]);

      const store = {
        id: context.store.store_id,
        name: context.store.store_name,
        latitude: Number(context.store.latitude),
        longitude: Number(context.store.longitude),
      };
      const prepared = preparePlanningOrders(store, date, orders);

      const available = riders.filter((rider) => rider.status === 'AVAILABLE');

      this.preparedOrders.set(prepared);
      this.availableRiders.set(available);
      this.store.set(store);
      this.businessDate.set(context.businessDate);
      this.todayOrderCount.set(orders.length);
      const confirmedPlans = savedPlans.filter((plan) => plan.status === 'SELECTED' || plan.status === 'COMPLETED');
      this.savedPlanCount.set(confirmedPlans.length);
      if (confirmedPlans.length > 0 && prepared.items.length === 0) this.view.set('saved');
    } catch (error) {
      console.error('โหลดข้อมูลจัดส่งไม่สำเร็จ', error);
      this.dataError.set('โหลดข้อมูลวางแผนไม่สำเร็จ กรุณาตรวจว่า Backend รองรับ API planning-store แล้วลองอีกครั้ง');
    } finally {
      this.dataLoading.set(false);
    }
  }

  protected async calculatePlan(): Promise<void> {
    if (this.busy() || this.confirmation()) return;
    // ทุกครั้งอ่านออเดอร์/ไรเดอร์ล่าสุด แล้วหากลุ่มและลำดับใหม่ ไม่ใช่สลับตัวเลือกเดิม
    await this.loadPlanningData();

    const prepared = this.preparedOrders();
    const store = this.store();
    if (!prepared || !store) return;
    if (this.savedPlanCount() > 0) {
      this.planError.set('มีใบงานยืนยันแล้ว กรุณาดูใบงานเดิม หากต้องจัดใหม่ให้ยกเลิกใบงานที่ยังไม่เริ่มส่งก่อน');
      return;
    }

    if (prepared.items.length === 0) {
      this.planError.set('ยังไม่มีออเดอร์รอดำเนินการของวันนี้ กรุณาเพิ่มออเดอร์ที่หน้าออเดอร์แล้วโหลดข้อมูลใหม่');
      return;
    }
    if (this.availableRiders().length === 0) {
      this.planError.set('ยังไม่มีไรเดอร์ว่างสำหรับจัดเส้นทาง');
      return;
    }

    this.calculating.set(true);
    try {
      const orders = prepared.items.map((item) => item.routing).sort((a, b) => a.orderId - b.orderId);
      const points = [store, ...orders].map(({ latitude, longitude }) => ({ latitude, longitude }));
      const matrix = await this.routeApi.getRoadMatrix(points);
      if (matrix.distanceBasis !== 'road') throw new Error('Backend ยังไม่รองรับการคำนวณระยะตามถนน กรุณาอัปเดต Backend');
      // เปิดโอกาสให้หน้าจอแสดงสถานะก่อนเริ่มค้นหาแผน
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const results = optimizeDeliveryRoutes(store, orders, this.availableRiders(), matrix);

      if (results.length === 0) {
        this.planError.set('ยังไม่พบแผนที่สามารถแสดงได้');
        return;
      }

      this.planAlternatives.set(results);
      this.showAllRoutes();
      this.selectedAlternativeId.set(results[0].id);
      this.calculationTime.set(new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' }));

      if (results.length === 1) {
        this.alternativeMessage.set('คำนวณจากข้อมูลล่าสุดแล้ว พบแผนที่เหมาะสม 1 แผน');
      }
    } catch (error) {
      const response = error as { status?: number; error?: { message?: string } };
      this.planError.set(response.status === 404
        ? 'Backend ยังไม่มี API คำนวณถนน กรุณา deploy Backend รุ่นใหม่ก่อน'
        : response.error?.message ?? (error instanceof Error ? error.message : 'คำนวณถนนไม่สำเร็จ กรุณาลองใหม่'));
    } finally {
      this.calculating.set(false);
    }
  }

  protected selectAlternative(id: string): void {
    if (this.busy() || this.confirmation() || !this.planAlternatives().some((plan) => plan.id === id)) return;

    this.showAllRoutes();
    this.alternativeMessage.set('');
    this.selectedAlternativeId.set(id);
    this.saveError.set('');
  }

  protected async confirmPlan(): Promise<void> {
    const plan = this.planResult();
    const store = this.store();
    if (!this.canConfirm() || !plan || !store) return;
    this.saving.set(true);
    this.saveError.set('');
    try {
      const result = await this.routeApi.confirmSelectedPlan(
        toSelectedPlanRequest(store, this.businessDate(), plan, 'road'),
      );
      this.confirmation.set(result);
      this.view.set('saved');
    } catch (error: unknown) {
      const response = error as { status?: number; error?: { message?: string } };
      this.saveError.set(response.error?.message ??
        'ยังยืนยันการบันทึกไม่ได้ กรุณาตรวจแท็บใบงานก่อนลองอีกครั้ง และตรวจว่า Backend รองรับ API confirm แล้ว');
    } finally {
      this.saving.set(false);
    }
  }

  protected onPlanCanceled(): void {
    this.view.set('planning');
    void this.loadPlanningData();
  }

  protected showAllRoutes(): void {
    this.activeRouteId.set(null);
    this.selectedStopId.set(null);
  }

  protected selectRoute(id: number): void {
    if (!this.routes().some((route) => route.id === id)) return;

    this.activeRouteId.set(this.activeRouteId() === id ? null : id);
    this.selectedStopId.set(null);
  }

  protected selectStop(id: number): void {
    const route = this.routes().find((item) => item.stops.some((stop) => stop.id === id));

    if (route) {
      this.activeRouteId.set(route.id);
      this.selectedStopId.set(id);
    } else if (this.pendingStops().some((stop) => stop.id === id)) {
      this.selectedStopId.set(id);
    }
  }
}
