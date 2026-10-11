import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
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
  imports: [FormsModule, DatePipe],
  templateUrl: './orders.html',
  styleUrl: './orders.css',
})
export class Orders implements OnInit {
  private readonly orderApi = inject(OrderApi);
  private readonly customerApi = inject(CustomerApi);

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

  protected form: { customer_id: number | null; box_quantity: number } = {
    customer_id: null,
    box_quantity: 1,
  };

  ngOnInit(): void {
    this.loadOrders();
    this.loadCustomers();
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