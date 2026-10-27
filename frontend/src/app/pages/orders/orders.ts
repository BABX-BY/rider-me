import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe, DecimalPipe } from '@angular/common';
import { AfterViewInit, Component, computed, ElementRef, inject, OnDestroy, OnInit, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';
import { MAPTILER_API_KEY } from '../../config/map';
import { Customer } from '../../model/customer.model';
import { Order, OrderStatus } from '../../model/order.model';
import { CustomerApi } from '../../services/api/customer-api';
import { OrderApi } from '../../services/api/order-api';

const MAX_ORDERS = 30; // ตรงกับ limit ใน backend

const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: 'รอดำเนินการ',
  ASSIGNED: 'มอบหมายแล้ว',
  DELIVERING: 'กำลังจัดส่ง',
  DELIVERED: 'ส่งแล้ว',
  CANCELLED: 'ยกเลิก',
};

@Component({
  selector: 'app-orders',
  imports: [FormsModule, DatePipe, DecimalPipe],
  templateUrl: './orders.html',
  styleUrl: './orders.css',
})
export class Orders implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('nearbyMapElement') private nearbyMapElement!: ElementRef<HTMLDivElement>;
  private readonly orderApi = inject(OrderApi);
  private readonly customerApi = inject(CustomerApi);
  private map?: L.Map;
  private nearbyLayer?: L.LayerGroup;
  private radiusCircle?: L.Circle;

  protected readonly maxOrders = MAX_ORDERS;
  protected readonly boxOptions = [1, 2, 3];

  protected readonly orders = signal<Order[]>([]);
  protected readonly customers = signal<Customer[]>([]);

  protected readonly isFull = computed(() => this.orders().length >= MAX_ORDERS);
  protected readonly totalBoxes = computed(() =>
    this.orders().reduce((sum, order) => sum + order.box_quantity, 0),
  );
  protected readonly pendingCount = computed(
    () => this.orders().filter((order) => order.status === 'PENDING').length,
  );

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

  protected readonly nearbyOrders = signal<Order[] | null>(null);
  protected readonly nearbyLoading = signal(false);
  protected readonly nearbyError = signal('');
  protected nearbyRadiusKm = 3;
  protected nearbyForm = { latitude: '16.244335', longitude: '103.249455' };

  protected form: { customer_id: number | null; box_quantity: number } = {
    customer_id: null,
    box_quantity: 1,
  };

  ngOnInit(): void {
    this.loadOrders();
    this.loadCustomers();
  }

  ngAfterViewInit(): void {
    this.map = L.map(this.nearbyMapElement.nativeElement).setView([16.244335, 103.249455], 14);
    L.tileLayer(`https://api.maptiler.com/maps/streets-v4/{z}/{x}/{y}.png?key=${MAPTILER_API_KEY}`, {
      tileSize: 512,
      zoomOffset: -1,
      minZoom: 1,
      attribution: '&copy; MapTiler &copy; OpenStreetMap contributors',
      crossOrigin: true,
    }).addTo(this.map);
    this.nearbyLayer = L.layerGroup().addTo(this.map);
    this.map.on('click', (event: L.LeafletMouseEvent) => {
      this.nearbyForm = {
        latitude: event.latlng.lat.toFixed(6),
        longitude: event.latlng.lng.toFixed(6),
      };
      this.nearbyOrders.set(null);
      this.nearbyError.set('');
      this.renderNearbyMap();
    });
    this.renderNearbyMap();
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

  /** ลูกค้าที่เลือกอยู่ในฟอร์ม (ไว้แสดงเบอร์โทร/ที่อยู่ให้ตรวจก่อนบันทึก) */
  protected get selectedCustomer(): Customer | undefined {
    return this.customers().find((c) => c.customer_id === this.form.customer_id);
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

  protected dismissNotification(): void {
    this.notification.set(null);
  }

  protected async searchNearbyOrders(): Promise<void> {
    const latitude = Number(this.nearbyForm.latitude);
    const longitude = Number(this.nearbyForm.longitude);

    if (
      this.nearbyForm.latitude.trim() === '' ||
      this.nearbyForm.longitude.trim() === '' ||
      !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
      !Number.isFinite(this.nearbyRadiusKm) || this.nearbyRadiusKm <= 0 || this.nearbyRadiusKm > 3
    ) {
      this.nearbyError.set('กรุณากรอกพิกัดให้ถูกต้อง และกำหนดรัศมีมากกว่า 0 ถึง 3 กม.');
      this.nearbyOrders.set(null);
      return;
    }

    this.nearbyLoading.set(true);
    this.nearbyError.set('');

    try {
      const results = await this.orderApi.getNearbyOrders(latitude, longitude);
      this.nearbyOrders.set(results.filter((order) => Number(order.distance_km) <= this.nearbyRadiusKm));
      this.renderNearbyMap();
    } catch (error) {
      this.nearbyOrders.set(null);
      this.nearbyError.set(this.toMessage(error, 'ค้นหาออเดอร์ใกล้เคียงไม่สำเร็จ'));
      this.renderNearbyMap();
    } finally {
      this.nearbyLoading.set(false);
    }
  }

  protected clearNearbySearch(): void {
    this.nearbyOrders.set(null);
    this.nearbyError.set('');
    this.nearbyForm = { latitude: '16.244335', longitude: '103.249455' };
    this.renderNearbyMap();
  }

  protected onNearbyRadiusChange(): void {
    this.renderNearbyMap();
  }

  protected async simulateOrders(): Promise<void> {
    const currentCount = this.orders().length;
    const availableSlots = MAX_ORDERS - currentCount;
    if (availableSlots < 20) {
      this.notification.set({ type: 'error', message: `เหลือพื้นที่สำหรับออร์เดอร์ ${availableSlots} รายการ ต้องเหลืออย่างน้อย 20 รายการเพื่อจำลองออร์เดอร์` });
      return;
    }
    if (this.customers().length === 0) {
      this.notification.set({ type: 'error', message: 'ยังไม่มีข้อมูลลูกค้าสำหรับสร้างออเดอร์ตัวอย่าง' });
      return;
    }

    const maxBatchSize = Math.min(30, availableSlots);
    const amount = 20 + Math.floor(Math.random() * (maxBatchSize - 19));
    this.savingOrder.set(true);
    this.notification.set(null);
    try {
      const items = Array.from({ length: amount }, () => {
        const customer = this.customers()[Math.floor(Math.random() * this.customers().length)];
        return {
          customer_id: customer.customer_id,
          box_quantity: 1 + Math.floor(Math.random() * 3),
        };
      });
      const createdOrders = await this.orderApi.simulateOrders(items);
      this.orders.update((list) => [...list, ...createdOrders]);
      this.notification.set({ type: 'success', message: `สร้างออเดอร์ตัวอย่างแบบสุ่มเพิ่ม ${amount} รายการ รวม ${this.orders().length} รายการแล้ว` });
    } catch (error) {
      this.notification.set({ type: 'error', message: this.toMessage(error, 'สร้างออเดอร์ตัวอย่างได้บางส่วน กรุณาตรวจสอบรายการปัจจุบัน') });
      await this.loadOrders();
    } finally {
      this.savingOrder.set(false);
    }
  }

  private renderNearbyMap(): void {
    if (!this.map || !this.nearbyLayer) return;
    const latitude = Number(this.nearbyForm.latitude);
    const longitude = Number(this.nearbyForm.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    this.nearbyLayer.clearLayers();
    this.radiusCircle?.remove();
    this.radiusCircle = L.circle([latitude, longitude], {
      radius: this.nearbyRadiusKm * 1000,
      color: '#2563eb',
      fillColor: '#3b82f6',
      fillOpacity: 0.08,
      weight: 2,
    }).addTo(this.map);
    L.circleMarker([latitude, longitude], {
      radius: 9,
      color: '#1d4ed8',
      fillColor: '#60a5fa',
      fillOpacity: 1,
      weight: 3,
    })
      .bindPopup('จุดศูนย์กลางการค้นหา')
      .addTo(this.nearbyLayer);
    for (const order of this.nearbyOrders() ?? []) {
      const orderLat = Number(order.customer_latitude);
      const orderLon = Number(order.customer_longitude);
      if (!Number.isFinite(orderLat) || !Number.isFinite(orderLon)) continue;
      L.circleMarker([orderLat, orderLon], { radius: 7, color: '#dc2626', fillColor: '#ef4444', fillOpacity: 0.9 })
        .bindPopup(`${order.customer_first_name} ${order.customer_last_name}<br>ออเดอร์ #${order.order_id}<br>${Number(order.distance_km).toFixed(2)} กม.`)
        .addTo(this.nearbyLayer);
    }
    this.map.setView([latitude, longitude], this.map.getZoom());
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
  }

  protected cancelEditing(): void {
    if (this.savingOrder()) {
      return;
    }

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

      this.orders.update((list) => [...list, newOrder]);
      this.savingOrder.set(false);
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

      this.orders.update((list) =>
        list.map((item) => (item.order_id === updated.order_id ? updated : item)),
      );
      this.savingOrder.set(false);
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

      this.orders.update((list) => list.filter((item) => item.order_id !== order.order_id));

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
    const confirmed = window.confirm('ล้างออร์เดอร์จำลองทั้งหมดใช่ไหม? ออร์เดอร์ปกติจะไม่ถูกลบ');

    if (!confirmed) {
      return;
    }

    this.notification.set(null);
    this.clearingOrders.set(true);

    try {
      const result = await this.orderApi.clearOrders();
      await this.loadOrders();

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
}
