import { SavedDeliveryRoutes } from './saved/delivery-routes';
import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, type OnInit, signal } from '@angular/core';
import type { Rider } from '../../model/rider.model';
import { OrderApi } from '../../services/api/order-api';
import { RiderApi } from '../../services/api/rider-api';
import { RouteApi, type ConfirmedPlanResponse } from '../../services/api/route-api';
import { RouteMap } from './map/route-map';
import { toRouteViews } from './map/route-view-adapter';
import { toSelectedPlanRequest, type PlanningStore } from './planning/plan-persistence';
import {
  buildRoutePlanAlternatives,
  type RoutePlanAlternative,
} from './planning/route-alternatives';
import {
  preparePlanningOrders,
  toBangkokDateKey,
  type PreparedPlanningOrders,
} from './planning/planning-orders';

@Component({
  selector: 'app-delivery-routes',
  imports: [RouteMap, DecimalPipe, SavedDeliveryRoutes],
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
  protected readonly selectedDate = signal(toBangkokDateKey(new Date()) ?? '');
  protected readonly dataLoading = signal(false);
  protected readonly saving = signal(false);
  protected readonly busy = computed(() => this.dataLoading() || this.saving());
  protected readonly confirmation = signal<ConfirmedPlanResponse | null>(null);
  protected readonly saveError = signal('');
  protected readonly dataError = signal('');
  protected readonly preparedOrders = signal<PreparedPlanningOrders | null>(null);
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
  protected readonly planError = signal('');
  protected readonly usedRiderCount = computed(
    () => this.planResult()?.summary.usedRiderCount ?? 0,
  );
  protected readonly canConfirm = computed(() =>
    !this.busy() && !this.confirmation() && !!this.store() &&
    this.selectedDate() === this.businessDate() && (this.planResult()?.trips.length ?? 0) > 0,
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

  protected onPlanningDateChange(event: Event): void {
    if (this.busy()) return;

    const input = event.target as HTMLInputElement;

    if (!input.value) {
      input.value = this.selectedDate();
      return;
    }

    this.selectedDate.set(input.value);
    void this.loadPlanningData();
  }

  protected async loadPlanningData(): Promise<void> {
    if (this.busy()) return;

    const date = this.selectedDate();

    this.planAlternatives.set([]);
    this.selectedAlternativeId.set(null);
    this.alternativeMessage.set('');
    this.planError.set('');
    this.showAllRoutes();
    this.dataLoading.set(true);
    this.dataError.set('');
    this.preparedOrders.set(null);
    this.availableRiders.set([]);
    this.store.set(null);
    this.businessDate.set('');
    this.confirmation.set(null);
    this.saveError.set('');

    try {
      // ใช้ร้านเดียวกับ Backend และอ่านออเดอร์เฉพาะวันที่เลือก
      const [orders, riders, context] = await Promise.all([
        this.orderApi.getOrders(date),
        this.riderApi.getRiders(),
        this.routeApi.getPlanningStore(),
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
    } catch (error) {
      console.error('โหลดข้อมูลจัดส่งไม่สำเร็จ', error);
      this.dataError.set('โหลดข้อมูลวางแผนไม่สำเร็จ กรุณาตรวจว่า Backend รองรับ API planning-store แล้วลองอีกครั้ง');
    } finally {
      this.dataLoading.set(false);
    }
  }

  protected async calculatePlan(): Promise<void> {
    if (this.busy() || this.confirmation()) return;

    const alternatives = this.planAlternatives();

    // เปรียบเทียบจากข้อมูลชุดเดียวกัน ปุ่มโหลดข้อมูลใหม่จะเริ่มคำนวณชุดใหม่
    if (alternatives.length > 0) {
      if (alternatives.length === 1) {
        this.alternativeMessage.set('ยังไม่พบแผนอื่นที่แตกต่างจากข้อมูลชุดนี้');
        return;
      }

      const currentIndex = alternatives.findIndex(
        (plan) => plan.id === this.selectedAlternativeId(),
      );
      const nextIndex = (currentIndex + 1) % alternatives.length;
      this.selectAlternative(alternatives[nextIndex].id);
      this.alternativeMessage.set(`เลือกแผนที่ ${nextIndex + 1} จาก ${alternatives.length} แผน`);
      return;
    }

    // ครั้งแรกอ่านออเดอร์และไรเดอร์ล่าสุด ก่อนสร้างแผนสำหรับเปรียบเทียบ
    await this.loadPlanningData();

    const prepared = this.preparedOrders();
    const store = this.store();
    if (!prepared || !store) return;

    if (prepared.items.length === 0) {
      this.planError.set('ไม่มีออเดอร์พร้อมจัดส่งในวันที่เลือก');
      return;
    }

    try {
      const results = buildRoutePlanAlternatives(
        store,
        prepared.items.map((item) => item.routing),
        this.availableRiders(),
        { includeReturnDistance: true, singleTripPerRider: true },
      );

      if (results.length === 0) {
        this.planError.set('ยังไม่พบแผนที่สามารถแสดงได้');
        return;
      }

      this.planAlternatives.set(results);
      this.selectAlternative(results[0].id);

      if (results.length === 1) {
        this.alternativeMessage.set('ยังไม่พบแผนอื่นที่แตกต่างจากข้อมูลชุดนี้');
      }
    } catch (error) {
      this.planError.set(error instanceof Error ? error.message : 'คำนวณเส้นทางไม่สำเร็จ');
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
        toSelectedPlanRequest(store, this.selectedDate(), plan),
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
    }
  }
}
