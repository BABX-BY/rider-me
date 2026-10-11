import { HttpErrorResponse } from '@angular/common/http';
import {
  AfterViewInit,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  signal,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';
import { MAPTILER_API_KEY } from '../../config/map';
import { Customer } from '../../model/customer.model';
import { Order, OrderStatus } from '../../model/order.model';
import { CustomerApi } from '../../services/api/customer-api';
import { OrderApi } from '../../services/api/order-api';

const MAX_ORDERS = 30; // ตรงกับ limit ใน backend
const NEARBY_RADIUS_KM = 2; // ตรงกับ radius ใน backend

const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: 'รอดำเนินการ',
  ASSIGNED: 'มอบหมายแล้ว',
  DELIVERING: 'กำลังจัดส่ง',
  DELIVERED: 'ส่งแล้ว',
  CANCELLED: 'ยกเลิก',
};

const STATUS_COLOR: Record<OrderStatus, string> = {
  PENDING: '#f59e0b',
  ASSIGNED: '#2563eb',
  DELIVERING: '#7c3aed',
  DELIVERED: '#16a34a',
  CANCELLED: '#9ca3af',
};

@Component({
  selector: 'app-orders',
  imports: [FormsModule],
  templateUrl: './orders.html',
  styleUrl: './orders.css',
})
export class Orders implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('mapElement') private mapElement!: ElementRef<HTMLDivElement>;

  private readonly orderApi = inject(OrderApi);
  private readonly customerApi = inject(CustomerApi);
  private map?: L.Map;
  private orderMarkerLayer?: L.LayerGroup;
  private nearbyCircle?: L.Circle;
  private readonly orderMarkers = new Map<number, L.Marker>();

  protected readonly maxOrders = MAX_ORDERS;
  protected readonly nearbyRadiusKm = NEARBY_RADIUS_KM;
  protected readonly boxOptions = [1, 2, 3];

  protected readonly orders = signal<Order[]>([]);
  protected readonly customers = signal<Customer[]>([]);
  protected readonly nearbyOrders = signal<Order[] | null>(null);
  protected readonly visibleOrders = computed(() => this.nearbyOrders() ?? this.orders());
  protected readonly isFull = computed(() => this.orders().length >= MAX_ORDERS);

  protected readonly loading = signal(true);
  protected readonly errorMessage = signal('');

  protected readonly notification = signal<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  protected readonly deletingOrderId = signal<number | null>(null);
  protected readonly savingOrder = signal(false);
  protected readonly clearingOrders = signal(false);
  protected readonly editingOrder = signal<Order | null>(null);
  protected readonly addingOrder = signal(false);
  protected readonly pickingNearby = signal(false);

  protected form: { customer_id: number | null; box_quantity: number } = {
    customer_id: null,
    box_quantity: 1,
  };

  constructor() {
    // วาด marker ใหม่ทุกครั้งที่รายการที่แสดงเปลี่ยน
    effect(() => {
      this.visibleOrders();
      this.renderOrderMarkers();
    });
  }

  ngOnInit(): void {
    this.loadOrders();
    this.loadCustomers();
  }

  ngAfterViewInit(): void {
    this.map = L.map(this.mapElement.nativeElement).setView([16.244335, 103.249455], 14);

    L.tileLayer(
      `https://api.maptiler.com/maps/streets-v4/{z}/{x}/{y}.png?key=${MAPTILER_API_KEY}`,
      {
        tileSize: 512,
        zoomOffset: -1,
        minZoom: 1,
        attribution:
          '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
        crossOrigin: true,
      },
    ).addTo(this.map);

    this.orderMarkerLayer = L.layerGroup().addTo(this.map);

    this.map.on('click', (event: L.LeafletMouseEvent) => {
      if (this.pickingNearby()) {
        this.searchNearby(event.latlng);
      }
    });

    this.renderOrderMarkers();
  }

  ngOnDestroy(): void {
    this.map?.remove();
  }

  // ---------- helpers ----------

  protected statusLabel(status: OrderStatus): string {
    return STATUS_LABEL[status] ?? status;
  }

  protected statusBadge(status: OrderStatus): string {
    switch (status) {
      case 'PENDING':
        return 'badge-warning';
      case 'ASSIGNED':
      case 'DELIVERING':
        return 'badge-info';
      case 'DELIVERED':
        return 'badge-success';
      default:
        return 'badge-ghost';
    }
  }

  protected isPending(order: Order): boolean {
    return order.status === 'PENDING'; // backend แก้/ลบได้เฉพาะ PENDING
  }

  protected get busy(): boolean {
    return this.savingOrder() || this.clearingOrders() || this.deletingOrderId() !== null;
  }

  private toMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) {
        return 'ติดต่อ Backend ไม่ได้ กรุณาตรวจสอบว่าเซิร์ฟเวอร์กำลังทำงาน';
      }

      // backend ส่ง { message } มาทุกครั้ง (400/404/409 อ่านได้เลย)
      if (typeof error.error?.message === 'string') {
        return error.error.message;
      }

      return `Backend เกิดข้อผิดพลาด (HTTP ${error.status})`;
    }

    return fallback;
  }

  /** อัปเดตทั้งรายการหลักและผลค้นหาใกล้เคียง (ถ้ากำลังแสดงอยู่) */
  private patchLists(change: (list: Order[]) => Order[]): void {
    this.orders.update(change);
    this.nearbyOrders.update((list) => (list ? change(list) : list));
  }

  // ---------- map ----------

  private pinIcon(color: string): L.DivIcon {
    return L.divIcon({
      className: 'order-pin',
      html: `
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42">
          <path
            d="M16 41S2 24.6 2 16a14 14 0 1 1 28 0c0 8.6-14 25-14 25Z"
            fill="${color}"
            stroke="white"
            stroke-width="2"
          />
          <circle cx="16" cy="16" r="5" fill="white" />
        </svg>
      `,
      iconSize: [32, 42],
      iconAnchor: [16, 42],
      popupAnchor: [0, -40],
    });
  }

  private renderOrderMarkers(): void {
    if (!this.map || !this.orderMarkerLayer) {
      return;
    }

    this.orderMarkerLayer.clearLayers();
    this.orderMarkers.clear();

    const positions: L.LatLngTuple[] = [];

    for (const order of this.visibleOrders()) {
      const latitude = Number(order.customer_latitude);
      const longitude = Number(order.customer_longitude);

      if (
        !Number.isFinite(latitude) ||
        latitude < -90 ||
        latitude > 90 ||
        !Number.isFinite(longitude) ||
        longitude < -180 ||
        longitude > 180
      ) {
        continue;
      }

      const popup = document.createElement('div');

      const title = document.createElement('strong');
      title.textContent = `ออเดอร์ #${order.order_id} (${order.box_quantity} กล่อง)`;

      const name = document.createElement('p');
      name.textContent = `ลูกค้า: ${order.customer_first_name} ${order.customer_last_name}`;

      const status = document.createElement('p');
      status.textContent = `สถานะ: ${this.statusLabel(order.status)}`;

      popup.append(title, name, status);

      const marker = L.marker([latitude, longitude], {
        icon: this.pinIcon(STATUS_COLOR[order.status] ?? '#2563eb'),
      })
        .bindPopup(popup)
        .addTo(this.orderMarkerLayer);

      this.orderMarkers.set(order.order_id, marker);
      positions.push([latitude, longitude]);
    }

    // ถ้ากำลังแสดงวงค้นหาใกล้เคียง ให้คงมุมมองไว้ที่วงนั้น
    if (this.nearbyCircle) {
      return;
    }

    if (positions.length === 1) {
      this.map.setView(positions[0], 14);
    } else if (positions.length > 1) {
      this.map.fitBounds(positions, { padding: [24, 24], maxZoom: 14 });
    }
  }

  protected focusOrder(order: Order): void {
    const marker = this.orderMarkers.get(order.order_id);

    if (!this.map || !marker) {
      return;
    }

    this.map.flyTo(marker.getLatLng(), Math.max(this.map.getZoom(), 16), {
      duration: 0.6,
    });

    marker.openPopup();
  }

  // ---------- load ----------

  private async loadOrders(): Promise<void> {
    try {
      this.orders.set(await this.orderApi.getOrders());
    } catch (error) {
      console.error('ไม่สามารถโหลดรายการสั่งซื้อได้:', error);
      this.errorMessage.set('ไม่สามารถโหลดรายการสั่งซื้อได้');
    } finally {
      this.loading.set(false);
    }
  }

  // ใช้เฉพาะเติม dropdown เลือกลูกค้าตอนเพิ่มออเดอร์
  private async loadCustomers(): Promise<void> {
    try {
      this.customers.set(await this.customerApi.getCustomers());
    } catch (error) {
      console.error('ไม่สามารถโหลดข้อมูลลูกค้าได้:', error);
      this.notification.set({ type: 'error', message: 'ไม่สามารถโหลดรายชื่อลูกค้าได้' });
    }
  }

  // ---------- add / edit ----------

  protected startAddingOrder(): void {
    this.editingOrder.set(null);
    this.addingOrder.set(true);
    this.notification.set(null);
    this.form = { customer_id: null, box_quantity: 1 };
  }

  protected startEditing(order: Order): void {
    this.addingOrder.set(false);
    this.editingOrder.set(order);
    this.notification.set(null);
    this.form = { customer_id: order.customer_id, box_quantity: order.box_quantity };
    this.focusOrder(order);
  }

  protected cancelEditing(): void {
    this.editingOrder.set(null);
    this.addingOrder.set(false);
  }

  protected async createOrder(): Promise<void> {
    const customerId = this.form.customer_id;

    if (!customerId) {
      this.notification.set({ type: 'error', message: 'กรุณาเลือกลูกค้า' });
      return;
    }

    this.notification.set(null);
    this.savingOrder.set(true);

    try {
      const newOrder = await this.orderApi.createOrder(customerId, this.form.box_quantity);

      this.patchLists((list) => [...list, newOrder]);
      this.cancelEditing();

      this.notification.set({
        type: 'success',
        message: `เพิ่มออเดอร์ #${newOrder.order_id} ของ ${newOrder.customer_first_name} ${newOrder.customer_last_name} แล้ว`,
      });
    } catch (error) {
      console.error('ไม่สามารถเพิ่มรายการสั่งซื้อได้:', error);
      this.notification.set({
        type: 'error',
        message: this.toMessage(error, 'เพิ่มออเดอร์ไม่สำเร็จ กรุณาลองใหม่'),
      });
    } finally {
      this.savingOrder.set(false);
    }
  }

  protected async saveOrder(): Promise<void> {
    const order = this.editingOrder();

    if (!order) {
      return;
    }

    this.notification.set(null);
    this.savingOrder.set(true);

    try {
      const updated = await this.orderApi.updateOrder(order.order_id, this.form.box_quantity);

      // คงค่า distance_km เดิมไว้ถ้ากำลังดูผลค้นหาใกล้เคียง
      this.patchLists((list) =>
        list.map((item) =>
          item.order_id === updated.order_id
            ? { ...updated, distance_km: item.distance_km }
            : item,
        ),
      );
      this.cancelEditing();

      this.notification.set({
        type: 'success',
        message: `แก้ไขจำนวนกล่องของออเดอร์ #${updated.order_id} แล้ว`,
      });
    } catch (error) {
      console.error('ไม่สามารถแก้ไขจำนวนกล่องได้:', error);
      this.notification.set({
        type: 'error',
        message: this.toMessage(error, 'แก้ไขออเดอร์ไม่สำเร็จ กรุณาลองใหม่'),
      });
    } finally {
      this.savingOrder.set(false);
    }
  }

  // ---------- delete ----------

  protected async deleteOrder(order: Order): Promise<void> {
    const confirmed = window.confirm(
      `ยืนยันลบออเดอร์ #${order.order_id} ของ ${order.customer_first_name} ${order.customer_last_name} ใช่ไหม?\nการลบนี้ไม่สามารถย้อนกลับได้`,
    );

    if (!confirmed) {
      return;
    }

    this.notification.set(null);
    this.deletingOrderId.set(order.order_id);

    try {
      const result = await this.orderApi.deleteOrder(order.order_id);

      this.patchLists((list) => list.filter((item) => item.order_id !== order.order_id));

      if (this.editingOrder()?.order_id === order.order_id) {
        this.cancelEditing();
      }

      this.notification.set({
        type: 'success',
        message: `${result.message}: #${result.order_id}`,
      });
    } catch (error) {
      console.error('ไม่สามารถลบรายการสั่งซื้อได้:', error);
      this.notification.set({
        type: 'error',
        message: this.toMessage(error, 'ลบออเดอร์ไม่สำเร็จ กรุณาลองใหม่'),
      });
    } finally {
      this.deletingOrderId.set(null);
    }
  }

  protected async clearOrders(): Promise<void> {
    const confirmed = window.confirm(
      `ยืนยันล้างออเดอร์ทั้งหมด ${this.orders().length} รายการใช่ไหม?\nการลบนี้ไม่สามารถย้อนกลับได้`,
    );

    if (!confirmed) {
      return;
    }

    this.notification.set(null);
    this.clearingOrders.set(true);

    try {
      const result = await this.orderApi.clearOrders();

      this.orders.set([]);
      this.showAllOrders();
      this.cancelEditing();

      this.notification.set({
        type: 'success',
        message: `${result.message} (${result.deleted_count} รายการ)`,
      });
    } catch (error) {
      console.error('ไม่สามารถล้างรายการสั่งซื้อได้:', error);
      this.notification.set({
        type: 'error',
        message: this.toMessage(error, 'ล้างออเดอร์ไม่สำเร็จ กรุณาลองใหม่'),
      });
    } finally {
      this.clearingOrders.set(false);
    }
  }

  // ---------- nearby ----------

  protected startPickingNearby(): void {
    this.notification.set(null);
    this.pickingNearby.set(true);
  }

  private async searchNearby(latlng: L.LatLng): Promise<void> {
    this.pickingNearby.set(false);

    try {
      const result = await this.orderApi.getNearbyOrders(latlng.lat, latlng.lng);

      this.nearbyCircle?.remove();

      if (this.map) {
        this.nearbyCircle = L.circle(latlng, {
          radius: NEARBY_RADIUS_KM * 1000,
          color: '#f97316',
          weight: 2,
          fillOpacity: 0.08,
        }).addTo(this.map);

        this.map.fitBounds(this.nearbyCircle.getBounds(), { padding: [24, 24] });
      }

      this.nearbyOrders.set(result);
      this.notification.set({
        type: 'success',
        message: `พบ ${result.length} ออเดอร์ในรัศมี ${NEARBY_RADIUS_KM} กม.`,
      });
    } catch (error) {
      console.error('ไม่สามารถค้นหาออเดอร์ใกล้เคียงได้:', error);
      this.notification.set({
        type: 'error',
        message: this.toMessage(error, 'ค้นหาออเดอร์ใกล้เคียงไม่สำเร็จ'),
      });
    }
  }

  protected showAllOrders(): void {
    this.nearbyCircle?.remove();
    this.nearbyCircle = undefined;
    this.pickingNearby.set(false);
    this.nearbyOrders.set(null);
  }
}