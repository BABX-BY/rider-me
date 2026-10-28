// @vitest-environment jsdom
import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Order } from '../../model/order.model';
import type { Rider } from '../../model/rider.model';
import { OrderApi } from '../../services/api/order-api';
import { RiderApi } from '../../services/api/rider-api';
import { RouteApi } from '../../services/api/route-api';
import { DeliveryRoutes } from './delivery-routes';
import type { RoutePlanAlternative } from './planning/route-alternatives';
import { optimizeDeliveryRoutes } from './planning/route-optimizer';
import { preparePlanningOrders } from './planning/planning-orders';
import { planDeliveryRoutes } from './planning/route-planner';
import { PREVIEW_STORE } from './preview/delivery-routes.preview';

vi.mock('./planning/route-optimizer', () => ({
  optimizeDeliveryRoutes: vi.fn(),
}));

const date = '2026-10-25';
const store = { id: 1, ...PREVIEW_STORE };
const orders: Order[] = [101, 102].map((id, index) => ({
  order_id: id,
  customer_id: id,
  box_quantity: index + 1,
  order_date: date,
  status: 'PENDING',
  created_at: date + 'T03:00:00Z',
  is_simulated: true,
  customer_first_name: `ลูกค้า ${id}`,
  customer_last_name: 'ทดสอบ',
  customer_phone: '0000000000',
  customer_address: `ที่อยู่ ${id}`,
  customer_latitude: String(PREVIEW_STORE.latitude + (index + 1) * 0.001),
  customer_longitude: String(PREVIEW_STORE.longitude),
}));
const riders: Rider[] = [41, 42].map((id) => ({
  rider_id: id,
  name: `ไรเดอร์ ${id}`,
  phone: '0000000000',
  vehicle_plate: `ทดสอบ ${id}`,
  status: 'AVAILABLE',
  max_orders_per_route: 3,
}));

class Controller extends DeliveryRoutes {
  readonly state = {
    date: this.businessDate,
    dateLabel: this.businessDateLabel,
    loading: this.dataLoading,
    calculating: this.calculating,
    dataError: this.dataError,
    prepared: this.preparedOrders,
    alternatives: this.planAlternatives,
    selectedId: this.selectedAlternativeId,
    selectedNumber: this.selectedAlternativeNumber,
    result: this.planResult,
    message: this.alternativeMessage,
    planError: this.planError,
    activeRouteId: this.activeRouteId,
    selectedStopId: this.selectedStopId,
    routes: this.routes,
    usedRiders: this.usedRiderCount,
    saving: this.saving,
    canConfirm: this.canConfirm,
    confirmation: this.confirmation,
    saveError: this.saveError,
    view: this.view,
    businessDate: this.businessDate,
    pendingStops: this.pendingStops,
    pendingBoxes: this.pendingBoxCount,
    totalOrders: this.todayOrderCount,
    savedPlans: this.savedPlanCount,
  };

  confirm(): Promise<void> { return this.confirmPlan(); }

  calculate(): Promise<void> {
    return this.calculatePlan();
  }

  reload(): Promise<void> {
    return this.loadPlanningData();
  }

  choose(id: string): void {
    this.selectAlternative(id);
  }

  chooseStop(id: number): void {
    this.selectStop(id);
  }


}

describe('delivery route plan selection', () => {
  const getOrders = vi.fn<() => Promise<Order[]>>();
  const getRiders = vi.fn<() => Promise<Rider[]>>();
  const getPlanningStore = vi.fn();
  const getRoutePlans = vi.fn();
  const getRoadMatrix = vi.fn();
  const confirmSelectedPlan = vi.fn();
  let controller: Controller;
  let alternatives: RoutePlanAlternative[];
  let destroyInjector: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    getOrders.mockReset().mockResolvedValue(orders);
    getRoadMatrix.mockReset().mockImplementation(async (points) => ({ points, distancesKm: points.map(() => points.map(() => 1)), distanceBasis: 'road' }));
    getRoutePlans.mockReset().mockResolvedValue([]);
    getRiders.mockReset().mockResolvedValue(riders);
    getPlanningStore.mockReset().mockResolvedValue({
      businessDate: date,
      store: { store_id: store.id, store_name: store.name, latitude: store.latitude, longitude: store.longitude },
    });
    confirmSelectedPlan.mockReset().mockResolvedValue({
      message: 'บันทึกแล้ว', plans: [{ routePlanId: 77, riderId: 41, worksheetCode: 'W20261025V1R41' }],
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const routing = preparePlanningOrders(PREVIEW_STORE, date, orders).items.map(
      (item) => item.routing,
    );
    alternatives = [
      {
        id: 'one-rider',
        result: planDeliveryRoutes(PREVIEW_STORE, routing, [riders[0]], {
          includeReturnDistance: true,
        }),
      },
      {
        id: 'two-riders',
        result: planDeliveryRoutes(
          PREVIEW_STORE,
          routing,
          riders.map((rider) => ({ ...rider, max_orders_per_route: 1 })),
          { includeReturnDistance: true },
        ),
      },
    ];
    vi.mocked(optimizeDeliveryRoutes).mockReset().mockReturnValue(alternatives);

    const injector = Injector.create({
      providers: [
        { provide: OrderApi, useValue: { getOrders } },
        { provide: RiderApi, useValue: { getRiders } },
        { provide: RouteApi, useValue: { getPlanningStore, confirmSelectedPlan, getRoutePlans, getRoadMatrix } },
      ],
    });
    destroyInjector = () => injector.destroy();
    controller = runInInjectionContext(injector, () => new Controller());
  });

  afterEach(() => {
    destroyInjector();
    vi.restoreAllMocks();
  });

  it('fetches current inputs once and builds the initial plan pool once', async () => {
    await controller.calculate();

    expect(getOrders).toHaveBeenCalledTimes(1);
    expect(getOrders).toHaveBeenCalledWith(date);
    expect(controller.state.date()).toBe(date);
    expect(getRiders).toHaveBeenCalledTimes(1);
    expect(optimizeDeliveryRoutes).toHaveBeenCalledTimes(1);
    expect(optimizeDeliveryRoutes).toHaveBeenCalledWith(
      store,
      controller.state.prepared()!.items.map((item) => item.routing),
      riders,
      expect.objectContaining({ distanceBasis: 'road', points: expect.any(Array), distancesKm: expect.any(Array) }),
    );
    expect(controller.state.selectedId()).toBe('one-rider');
    expect(controller.state.selectedNumber()).toBe(1);
    expect(controller.state.result()).toBe(alternatives[0].result);
    expect(controller.state.routes()[0].stops[0].customer).toContain('ลูกค้า 101');
  });

  it('recalculates with refreshed inputs instead of cycling old alternatives', async () => {
    await controller.calculate();
    controller.choose('two-riders');
    getOrders.mockResolvedValue([orders[0]]);
    vi.mocked(optimizeDeliveryRoutes).mockReturnValue([alternatives[0]]);
    await controller.calculate();
    expect(controller.state.result()).toBe(alternatives[0].result);
    expect(controller.state.prepared()!.items).toHaveLength(1);
    expect(getOrders).toHaveBeenCalledTimes(2);
    expect(getRoadMatrix).toHaveBeenCalledTimes(2);
    expect(optimizeDeliveryRoutes).toHaveBeenCalledTimes(2);
    expect(controller.state.message()).toContain('ข้อมูลล่าสุด');
  });

  it('selects a valid alternative atomically for summary and routes and clears map selection', async () => {
    await controller.calculate();
    controller.chooseStop(101);
    expect(controller.state.activeRouteId()).not.toBeNull();

    controller.choose('two-riders');

    expect(controller.state.result()!.summary).toBe(alternatives[1].result.summary);
    expect(controller.state.usedRiders()).toBe(2);
    expect(controller.state.routes()).toHaveLength(2);
    expect(controller.state.activeRouteId()).toBeNull();
    expect(controller.state.selectedStopId()).toBeNull();
    expect(controller.state.message()).toBe('');

    controller.chooseStop(102);
    const selectedRoute = controller.state.activeRouteId();
    controller.choose('unknown-plan');
    expect(controller.state.selectedId()).toBe('two-riders');
    expect(controller.state.activeRouteId()).toBe(selectedRoute);
    expect(controller.state.selectedStopId()).toBe(102);
  });

  it('clears the complete plan pool and selections as soon as an explicit reload starts', async () => {
    await controller.calculate();
    controller.chooseStop(101);
    controller.state.message.set('previous selection');

    const pendingReload = controller.reload();
    expect(controller.state.loading()).toBe(true);
    expect(controller.state.alternatives()).toEqual([]);
    expect(controller.state.selectedId()).toBeNull();
    expect(controller.state.result()).toBeNull();
    expect(controller.state.routes()).toEqual([]);
    expect(controller.state.activeRouteId()).toBeNull();
    expect(controller.state.selectedStopId()).toBeNull();
    expect(controller.state.message()).toBe('');
    await pendingReload;

    expect(controller.state.loading()).toBe(false);
    expect(getOrders).toHaveBeenCalledTimes(2);
    expect(optimizeDeliveryRoutes).toHaveBeenCalledTimes(1);
  });

  it('uses the new backend business day on reload and discards the previous plan', async () => {
    await controller.calculate();
    controller.chooseStop(101);
    getPlanningStore.mockResolvedValue({
      businessDate: '2026-10-26',
      store: { store_id: store.id, store_name: store.name, latitude: store.latitude, longitude: store.longitude },
    });
    const pending = controller.reload();
    expect(controller.state.result()).toBeNull();
    expect(controller.state.alternatives()).toEqual([]);
    expect(controller.state.activeRouteId()).toBeNull();
    expect(controller.state.selectedStopId()).toBeNull();
    await pending;
    expect(controller.state.date()).toBe('2026-10-26');
    expect(getOrders).toHaveBeenLastCalledWith('2026-10-26');
    expect(controller.state.prepared()!.items).toEqual([]);
    expect(getOrders).toHaveBeenCalledTimes(2);
    expect(optimizeDeliveryRoutes).toHaveBeenCalledTimes(1);
  });

  it('waits for the backend date before requesting orders', async () => {
    let finish!: (value: unknown) => void;
    getPlanningStore.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = controller.reload();
    expect(getOrders).not.toHaveBeenCalled();
    expect(controller.state.canConfirm()).toBe(false);
    finish({ businessDate: date, store: {
      store_id: store.id, store_name: store.name, latitude: store.latitude, longitude: store.longitude,
    } });
    await pending;
    expect(getOrders).toHaveBeenCalledWith(date);
    expect(controller.state.date()).toBe(date);
    expect(controller.state.prepared()!.items).toHaveLength(2);
  });

  it('does not use the browser day if the backend date cannot be loaded', async () => {
    getPlanningStore.mockRejectedValue(new Error('offline'));
    await controller.calculate();
    expect(getOrders).not.toHaveBeenCalled();
    expect(controller.state.dataError()).toContain('โหลดข้อมูลวางแผนไม่สำเร็จ');
    expect(controller.state.date()).toBe('');
    expect(controller.state.canConfirm()).toBe(false);
  });

  it('recalculates a singleton and clears the previous map selection', async () => {
    vi.mocked(optimizeDeliveryRoutes).mockReturnValue([alternatives[0]]);
    await controller.calculate();
    controller.chooseStop(101);

    await controller.calculate();

    expect(controller.state.result()).toBe(alternatives[0].result);
    expect(controller.state.selectedNumber()).toBe(1);
    expect(controller.state.selectedStopId()).toBeNull();
    expect(controller.state.message()).toContain('ข้อมูลล่าสุด');
    expect(getOrders).toHaveBeenCalledTimes(2);
    expect(optimizeDeliveryRoutes).toHaveBeenCalledTimes(2);
  });

  it('keeps the plan empty when the API fails', async () => {
    getOrders.mockRejectedValue(new Error('offline'));

    await controller.calculate();

    expect(controller.state.dataError()).toContain('โหลดข้อมูลวางแผนไม่สำเร็จ');
    expect(controller.state.loading()).toBe(false);
    expect(controller.state.result()).toBeNull();
    expect(controller.state.alternatives()).toEqual([]);
    expect(controller.state.routes()).toEqual([]);
    expect(optimizeDeliveryRoutes).not.toHaveBeenCalled();
  });

  it('does not build plans when today has no pending orders', async () => {
    getOrders.mockResolvedValue(orders.map((order) => ({ ...order, status: 'DELIVERED' })));

    await controller.calculate();

    expect(controller.state.dataError()).toBe('');
    expect(controller.state.planError()).toContain('ยังไม่มีออเดอร์รอดำเนินการของวันนี้');
    expect(controller.state.result()).toBeNull();
    expect(controller.state.alternatives()).toEqual([]);
    expect(controller.state.routes()).toEqual([]);
    expect(optimizeDeliveryRoutes).not.toHaveBeenCalled();
  });
  it('confirms the currently selected alternative and opens the saved worksheets', async () => {
    await controller.calculate();
    controller.choose('two-riders');
    await controller.confirm();
    const payload = confirmSelectedPlan.mock.calls[0][0];
    expect(payload.trips).toEqual(alternatives[1].result.trips.map((trip) => ({
      riderId: trip.riderId, orderIds: trip.route.stops.map((stop) => stop.orderId),
      roadLegDistancesKm: [...trip.route.stops.map((stop) => stop.distanceFromPreviousKm), trip.route.returnDistanceKm],
    })));
    expect(payload.distanceBasis).toBe('road');
    expect(payload.storeId).toBe(store.id);
    expect(payload.routeDate).toBe(date);
    expect(payload.orders.map((order: { orderId: number }) => order.orderId).sort()).toEqual([101, 102]);
    expect(controller.state.confirmation()?.plans[0].worksheetCode).toBe('W20261025V1R41');
    expect(controller.state.canConfirm()).toBe(false);
    expect(controller.state.view()).toBe('saved');
    controller.choose('one-rider');
    expect(controller.state.selectedId()).toBe('two-riders');
    await controller.confirm();
    expect(confirmSelectedPlan).toHaveBeenCalledTimes(1);
  });

  it('locks reload, plan selection and duplicate submits while confirming', async () => {
    await controller.calculate();
    let finish!: (value: unknown) => void;
    confirmSelectedPlan.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = controller.confirm();
    expect(controller.state.saving()).toBe(true);
    controller.choose('two-riders');
    await controller.reload();
    await controller.confirm();
    expect(controller.state.date()).toBe(date);
    expect(controller.state.selectedId()).toBe('one-rider');
    expect(getOrders).toHaveBeenCalledTimes(1);
    expect(confirmSelectedPlan).toHaveBeenCalledTimes(1);
    finish({ message: 'บันทึกแล้ว', plans: [] });
    await pending;
    expect(controller.state.saving()).toBe(false);
  });

  it('does not submit an empty plan or a plan without a loaded business day', async () => {
    await controller.confirm();
    await controller.calculate();
    controller.state.businessDate.set('');
    expect(controller.state.canConfirm()).toBe(false);
    await controller.confirm();
    expect(confirmSelectedPlan).not.toHaveBeenCalled();
  });

  it('shows a stale snapshot response and keeps the selected plan for inspection', async () => {
    await controller.calculate();
    confirmSelectedPlan.mockRejectedValue({ status: 409, error: { message: 'ออเดอร์เปลี่ยนแล้ว กรุณาคำนวณใหม่' } });
    await controller.confirm();
    expect(controller.state.saveError()).toContain('ออเดอร์เปลี่ยนแล้ว');
    expect(controller.state.confirmation()).toBeNull();
    expect(controller.state.result()).toBe(alternatives[0].result);
    expect(controller.state.view()).toBe('planning');
    expect(controller.state.saving()).toBe(false);
  });

  it('shows pending customer pins and box totals before calculating', async () => {
    await controller.reload();
    expect(controller.state.result()).toBeNull();
    expect(controller.state.totalOrders()).toBe(2);
    expect(controller.state.pendingBoxes()).toBe(3);
    expect(controller.state.pendingStops().map((stop) => stop.id)).toEqual([101, 102]);
    controller.chooseStop(101);
    expect(controller.state.selectedStopId()).toBe(101);
  });

  it('opens saved worksheets when all orders have already been assigned', async () => {
    getOrders.mockResolvedValue(orders.map((order) => ({ ...order, status: 'ASSIGNED' })));
    getRoutePlans.mockResolvedValue([{ status: 'SELECTED' }, { status: 'COMPLETED' }, { status: 'REJECTED' }]);
    await controller.reload();
    expect(controller.state.view()).toBe('saved');
    expect(controller.state.savedPlans()).toBe(2);
    expect(controller.state.totalOrders()).toBe(2);
    expect(controller.state.pendingStops()).toEqual([]);
    expect(controller.state.canConfirm()).toBe(false);
    expect(getRoutePlans).toHaveBeenCalledWith(date, '');
  });

  it('prevents creating another plan over existing worksheets', async () => {
    getRoutePlans.mockResolvedValue([{ status: 'SELECTED' }]);
    await controller.calculate();
    expect(optimizeDeliveryRoutes).not.toHaveBeenCalled();
    expect(controller.state.planError()).toContain('มีใบงานยืนยันแล้ว');
    expect(controller.state.canConfirm()).toBe(false);
  });

  it('does not fall back to straight-line totals when the road service is unavailable', async () => {
    getRoadMatrix.mockRejectedValue({ status: 503, error: { message: 'บริการถนนไม่พร้อม กรุณาลองใหม่' } });
    await controller.calculate();
    expect(controller.state.planError()).toContain('บริการถนนไม่พร้อม');
    expect(controller.state.result()).toBeNull();
    expect(controller.state.canConfirm()).toBe(false);
    expect(controller.state.calculating()).toBe(false);
    expect(optimizeDeliveryRoutes).not.toHaveBeenCalled();
  });

  it('explains a backend that has not deployed the new road API', async () => {
    getRoadMatrix.mockRejectedValue({ status: 404 });
    await controller.calculate();
    expect(controller.state.planError()).toContain('deploy Backend');
    expect(controller.state.canConfirm()).toBe(false);
  });

  it('prevents duplicate calculation, reload and confirmation during the road request', async () => {
    let finish!: (value: unknown) => void;
    let requestPoints: unknown;
    getRoadMatrix.mockImplementation((points) => {
      requestPoints = points;
      return new Promise((resolve) => { finish = resolve; });
    });
    const pending = controller.calculate();
    await vi.waitFor(() => expect(controller.state.calculating()).toBe(true));
    await controller.calculate();
    await controller.reload();
    await controller.confirm();
    expect(getOrders).toHaveBeenCalledTimes(1);
    expect(getRoadMatrix).toHaveBeenCalledTimes(1);
    expect(confirmSelectedPlan).not.toHaveBeenCalled();
    finish({ points: requestPoints, distancesKm: [], distanceBasis: 'road' });
    await pending;
    expect(controller.state.calculating()).toBe(false);
    expect(controller.state.canConfirm()).toBe(true);
  });

});
