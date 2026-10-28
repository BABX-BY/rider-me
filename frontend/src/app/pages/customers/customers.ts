import { HttpErrorResponse } from '@angular/common/http';
import { DecimalPipe } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  signal,
  ViewChild,
} from '@angular/core';
import * as L from 'leaflet';
import { MAPTILER_API_KEY } from '../../config/map';
import { Customer } from '../../model/customer.model';
import { CustomerApi } from '../../services/api/customer-api';
import { RouteApi } from '../../services/api/route-api';
import { FormsModule } from '@angular/forms';

const SERVICE_RADIUS_KM = 3;

@Component({
  selector: 'app-customers',
  imports: [FormsModule, DecimalPipe],
  templateUrl: './customers.html',
  styleUrl: './customers.css',
})
export class Customers implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('mapElement') private mapElement!: ElementRef<HTMLDivElement>;

  private readonly customerApi = inject(CustomerApi);
  private readonly routeApi = inject(RouteApi);
  private map?: L.Map;
  private customerMarkerLayer?: L.LayerGroup;
  private draftLocationMarker?: L.CircleMarker;
  private readonly customerMarkers = new Map<number, L.Marker>();

  protected readonly customers = signal<Customer[]>([]);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal('');

  protected readonly notification = signal<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  protected readonly deletingCustomerId = signal<number | null>(null);
  protected readonly savingCustomer = signal(false);
  protected searchName = '';
  protected readonly editingCustomer = signal<Customer | null>(null);
  protected readonly addingCustomer = signal(false);
  protected readonly pickingLocation = signal(false);
  protected readonly storeLocation = signal<{ lat: number; lng: number } | null>(null);

  protected editForm = {
    first_name: '',
    last_name: '',
    phone: '',
    address: '',
    latitude: '',
    longitude: '',
  };

  protected getDistanceFromStore(lat: number, lng: number): number {
    const store = this.storeLocation();
    if (!store) return Infinity;
    const R = 6371;
    const dLat = ((lat - store.lat) * Math.PI) / 180;
    const dLon = ((lng - store.lng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((store.lat * Math.PI) / 180) *
        Math.cos((lat * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  protected get locationServiceStatus(): { inService: boolean; distanceKm: number } | null {
    const lat = Number(this.editForm.latitude);
    const lng = Number(this.editForm.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const dist = this.getDistanceFromStore(lat, lng);
    return { inService: dist <= SERVICE_RADIUS_KM, distanceKm: dist };
  }

  ngOnInit(): void {
    this.loadCustomers();
  }

  ngAfterViewInit(): void {
    void this.initializeMap();
  }

  private async initializeMap(): Promise<void> {
    try {
      const context = await this.routeApi.getPlanningStore();
      const latitude = Number(context.store.latitude);
      const longitude = Number(context.store.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new Error('พิกัดร้านไม่ถูกต้อง');
      }
      this.storeLocation.set({ lat: latitude, lng: longitude });
    } catch (error) {
      console.error('ไม่สามารถโหลดพิกัดร้านได้:', error);
      this.errorMessage.set('ไม่สามารถโหลดพิกัดร้านจาก Backend ได้');
      return;
    }

    const store = this.storeLocation();
    if (!store) return;
    this.map = L.map(this.mapElement.nativeElement).setView([store.lat, store.lng], 14);

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

    // แสดงพื้นที่บริการจัดส่ง (รัศมี 3 กม.)
    L.circle([store.lat, store.lng], {
      radius: SERVICE_RADIUS_KM * 1000,
      color: '#2563eb',
      fillColor: '#3b82f6',
      fillOpacity: 0.08,
      weight: 2,
      dashArray: '6 6',
    }).bindTooltip('พื้นที่บริการจัดส่ง (รัศมี 3 กม.)').addTo(this.map);

    // ปักหมุดร้านค้า
    const storeIcon = L.divIcon({
      className: 'store-pin',
      html: `
        <div style="background-color: #0f766e; color: white; border-radius: 50%; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3); font-size: 18px;">
          🏪
        </div>
      `,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });
    L.marker([store.lat, store.lng], { icon: storeIcon })
      .bindPopup('<strong>ร้านข้าวกล่องเดลิเวอรี ขามเรียง (จุดศูนย์กลาง)</strong><p style="margin:0; font-size:12px; color:#64748b;">รัศมีบริการ 3 กม.</p>')
      .addTo(this.map);

    this.customerMarkerLayer = L.layerGroup().addTo(this.map);

    this.map.on('click', (event: L.LeafletMouseEvent) => {
      if (!this.pickingLocation()) {
        return;
      }

      const map = this.map;

      if (!map) {
        return;
      }

      this.editForm = {
        ...this.editForm,
        latitude: String(event.latlng.lat),
        longitude: String(event.latlng.lng),
      };

      this.draftLocationMarker?.remove();
      this.draftLocationMarker = L.circleMarker(event.latlng, {
        radius: 8,
        color: '#ffffff',
        weight: 2,
        fillColor: '#f97316',
        fillOpacity: 1,
      }).addTo(map);

      this.pickingLocation.set(false);

      const dist = this.getDistanceFromStore(event.latlng.lat, event.latlng.lng);
      const inService = dist <= SERVICE_RADIUS_KM;
      this.notification.set({
        type: inService ? 'success' : 'error',
        message: inService
          ? `เลือกตำแหน่งแล้ว: อยู่ในพื้นที่บริการ (ห่างจากร้าน ${dist.toFixed(2)} กม.)`
          : `เลือกตำแหน่งแล้ว: อยู่นอกพื้นที่บริการจัดส่ง (ห่างจากร้าน ${dist.toFixed(2)} กม. เกินรัศมี 3 กม.)`,
      });
    });

    this.renderCustomerMarkers();
  }

  ngOnDestroy(): void {
    this.map?.remove();
  }

  private renderCustomerMarkers(): void {
    if (!this.map || !this.customerMarkerLayer) {
      return;
    }

    this.customerMarkerLayer.clearLayers();
    this.customerMarkers.clear();

    const positions: L.LatLngTuple[] = [];

    const customerIcon = L.divIcon({
      className: 'customer-pin',
      html: `
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42">
          <path
            d="M16 41S2 24.6 2 16a14 14 0 1 1 28 0c0 8.6-14 25-14 25Z"
            fill="#2563eb"
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

    for (const customer of this.customers()) {
      const latitude = Number(customer.latitude);
      const longitude = Number(customer.longitude);

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

      const dist = this.getDistanceFromStore(latitude, longitude);
      const inService = dist <= SERVICE_RADIUS_KM;

      const popup = document.createElement('div');

      const name = document.createElement('strong');
      name.textContent = `${customer.first_name} ${customer.last_name}`;

      const phone = document.createElement('p');
      phone.textContent = `เบอร์โทร: ${customer.phone}`;

      const address = document.createElement('p');
      address.textContent = `ที่อยู่: ${customer.address}`;

      const distanceP = document.createElement('p');
      distanceP.style.fontSize = '12px';
      distanceP.style.marginTop = '4px';
      distanceP.style.color = inService ? '#16a34a' : '#d97706';
      distanceP.textContent = `ห่างจากร้าน ${dist.toFixed(2)} กม. (${inService ? 'ในพื้นที่บริการ' : 'นอกพื้นที่บริการ'})`;

      popup.append(name, phone, address, distanceP);

      const marker = L.marker([latitude, longitude], { icon: customerIcon })
        .bindPopup(popup)
        .addTo(this.customerMarkerLayer);

      this.customerMarkers.set(customer.customer_id, marker);
      positions.push([latitude, longitude]);
    }

    if (positions.length === 1) {
      this.map.setView(positions[0], 14);
    } else if (positions.length > 1) {
      this.map.fitBounds(positions, { padding: [24, 24], maxZoom: 14 });
    }
  }

  protected focusCustomer(customer: Customer): void {
    const marker = this.customerMarkers.get(customer.customer_id);

    if (!this.map || !marker) {
      return;
    }

    this.map.flyTo(marker.getLatLng(), Math.max(this.map.getZoom(), 16), {
      duration: 0.6,
    });

    marker.openPopup();
  }

  protected async searchCustomers(): Promise<void> {
    await this.loadCustomers(this.searchName.trim());
  }

  protected async clearCustomerSearch(): Promise<void> {
    this.searchName = '';
    await this.loadCustomers();
  }

  private async loadCustomers(name = ''): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set('');

    try {
      const customers = await this.customerApi.getCustomers(name);
      this.customers.set(customers);
      this.renderCustomerMarkers();
    } catch (error) {
      console.error('ไม่สามารถโหลดข้อมูลลูกค้าได้:', error);
      this.errorMessage.set('ไม่สามารถโหลดข้อมูลลูกค้าได้');
    } finally {
      this.loading.set(false);
    }
  }

  protected async deleteCustomer(customer: Customer): Promise<void> {
    const fullName = `${customer.first_name} ${customer.last_name}`;

    const confirmed = window.confirm(
      `ยืนยันลบข้อมูลลูกค้า ${fullName} ใช่ไหม?\nการลบนี้ไม่สามารถย้อนกลับได้`,
    );

    if (!confirmed) {
      return;
    }

    this.notification.set(null);
    this.deletingCustomerId.set(customer.customer_id);

    try {
      const result = await this.customerApi.deleteCustomer(customer.customer_id);

      this.customers.update((customers) =>
        customers.filter((item) => item.customer_id !== customer.customer_id),
      );

      this.renderCustomerMarkers();
      this.notification.set({
        type: 'success',
        message: `${result.message}: ${fullName}`,
      });
    } catch (error) {
      console.error('ไม่สามารถลบข้อมูลลูกค้าได้:', error);

      let message = 'ลบข้อมูลลูกค้าไม่สำเร็จ กรุณาลองใหม่';

      if (error instanceof HttpErrorResponse) {
        if (error.status === 409) {
          message = `ลบ "${fullName}" ไม่ได้ เพราะลูกค้าคนนี้มีรายการสั่งซื้ออยู่`;
        } else if (error.status === 404) {
          message = `ไม่พบข้อมูลลูกค้า "${fullName}" อาจถูกลบไปแล้ว`;
        } else if (error.status === 0) {
          message = 'ติดต่อ Backend ไม่ได้ กรุณาตรวจสอบว่าเซิร์ฟเวอร์กำลังทำงาน';
        } else if (
          typeof error.error?.message === 'string' &&
          error.error.message !== 'ไม่สามารถลบข้อมูลลูกค้าได้'
        ) {
          message = error.error.message;
        } else {
          message = `Backend เกิดข้อผิดพลาด (HTTP ${error.status}) กรุณาตรวจสอบ log ของ Backend`;
        }
      }

      this.notification.set({ type: 'error', message });
    } finally {
      this.deletingCustomerId.set(null);
    }
  }

  protected startAddingCustomer(): void {
    this.editingCustomer.set(null);
    this.addingCustomer.set(true);
    this.pickingLocation.set(false);
    this.notification.set(null);

    this.draftLocationMarker?.remove();
    this.draftLocationMarker = undefined;

    this.editForm = {
      first_name: '',
      last_name: '',
      phone: '',
      address: '',
      latitude: '',
      longitude: '',
    };
  }

  protected startEditing(customer: Customer): void {
    this.editingCustomer.set(customer);

    this.editForm = {
      first_name: customer.first_name,
      last_name: customer.last_name,
      phone: customer.phone,
      address: customer.address,
      latitude: customer.latitude,
      longitude: customer.longitude,
    };

    this.pickingLocation.set(false);
    this.notification.set(null);
    this.focusCustomer(customer);
  }

  protected async saveCustomer(): Promise<void> {
    const customer = this.editingCustomer();

    if (!customer) {
      return;
    }

    const latitude = Number(this.editForm.latitude);
    const longitude = Number(this.editForm.longitude);

    if (
      !this.editForm.first_name.trim() ||
      !this.editForm.last_name.trim() ||
      !this.editForm.phone.trim() ||
      !this.editForm.address.trim() ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      this.notification.set({
        type: 'error',
        message: 'กรุณากรอกข้อมูลให้ครบ และตรวจสอบพิกัดให้ถูกต้อง',
      });
      return;
    }

    if (this.getDistanceFromStore(latitude, longitude) > SERVICE_RADIUS_KM) {
      this.notification.set({ type: 'error', message: 'พิกัดลูกค้าอยู่นอกพื้นที่บริการรัศมี 3 กม.' });
      return;
    }

    this.notification.set(null);
    this.savingCustomer.set(true);

    try {
      const updatedCustomer = await this.customerApi.updateCustomer(customer.customer_id, {
        first_name: this.editForm.first_name.trim(),
        last_name: this.editForm.last_name.trim(),
        phone: this.editForm.phone.trim(),
        address: this.editForm.address.trim(),
        latitude: String(latitude),
        longitude: String(longitude),
      });

      if (this.searchName.trim()) {
        await this.loadCustomers(this.searchName.trim());
      } else {
        this.customers.update((customers) =>
          customers.map((item) =>
            item.customer_id === updatedCustomer.customer_id ? updatedCustomer : item,
          ),
        );

        this.renderCustomerMarkers();
      }

      this.cancelEditing();

      this.notification.set({
        type: 'success',
        message: 'บันทึกการแก้ไขข้อมูลลูกค้าแล้ว',
      });

      this.focusCustomer(updatedCustomer);
    } catch (error) {
      console.error('ไม่สามารถแก้ไขข้อมูลลูกค้าได้:', error);

      let message = 'แก้ไขข้อมูลลูกค้าไม่สำเร็จ กรุณาลองใหม่';

      if (error instanceof HttpErrorResponse) {
        if (error.status === 0) {
          message = 'ติดต่อ Backend ไม่ได้ กรุณาตรวจสอบว่าเซิร์ฟเวอร์กำลังทำงาน';
        } else if (error.status === 404) {
          message = 'ไม่พบข้อมูลลูกค้าที่ต้องการแก้ไข อาจถูกลบไปแล้ว';
        } else if (typeof error.error?.message === 'string') {
          message = error.error.message;
        } else {
          message = `Backend เกิดข้อผิดพลาด (HTTP ${error.status})`;
        }
      }

      this.notification.set({ type: 'error', message });
    } finally {
      this.savingCustomer.set(false);
    }
  }

  protected async createCustomer(): Promise<void> {
    const latitude = Number(this.editForm.latitude);
    const longitude = Number(this.editForm.longitude);

    if (
      !this.editForm.first_name.trim() ||
      !this.editForm.last_name.trim() ||
      !this.editForm.phone.trim() ||
      !this.editForm.address.trim() ||
      !this.editForm.latitude ||
      !this.editForm.longitude ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      this.notification.set({
        type: 'error',
        message: 'กรุณากรอกข้อมูลให้ครบ และเลือกตำแหน่งลูกค้าบนแผนที่',
      });
      return;
    }

    if (this.getDistanceFromStore(latitude, longitude) > SERVICE_RADIUS_KM) {
      this.notification.set({ type: 'error', message: 'พิกัดลูกค้าอยู่นอกพื้นที่บริการรัศมี 3 กม.' });
      return;
    }

    this.notification.set(null);
    this.savingCustomer.set(true);

    try {
      const newCustomer = await this.customerApi.createCustomer({
        first_name: this.editForm.first_name.trim(),
        last_name: this.editForm.last_name.trim(),
        phone: this.editForm.phone.trim(),
        address: this.editForm.address.trim(),
        latitude: String(latitude),
        longitude: String(longitude),
      });

      if (this.searchName.trim()) {
        await this.loadCustomers(this.searchName.trim());
      } else {
        this.customers.update((customers) => [...customers, newCustomer]);
        this.renderCustomerMarkers();
      }

      this.cancelEditing();

      this.notification.set({
        type: 'success',
        message: `เพิ่มข้อมูลลูกค้า ${newCustomer.first_name} ${newCustomer.last_name} แล้ว`,
      });

      this.focusCustomer(newCustomer);
    } catch (error) {
      console.error('ไม่สามารถเพิ่มข้อมูลลูกค้าได้:', error);

      let message = 'เพิ่มข้อมูลลูกค้าไม่สำเร็จ กรุณาลองใหม่';

      if (error instanceof HttpErrorResponse) {
        if (error.status === 0) {
          message = 'ติดต่อ Backend ไม่ได้ กรุณาตรวจสอบว่าเซิร์ฟเวอร์กำลังทำงาน';
        } else if (typeof error.error?.message === 'string') {
          message = error.error.message;
        } else {
          message = `Backend เกิดข้อผิดพลาด (HTTP ${error.status})`;
        }
      }

      this.notification.set({ type: 'error', message });
    } finally {
      this.savingCustomer.set(false);
    }
  }

  protected cancelEditing(): void {
    this.editingCustomer.set(null);
    this.addingCustomer.set(false);
    this.pickingLocation.set(false);
    this.draftLocationMarker?.remove();
    this.draftLocationMarker = undefined;
  }

  protected startPickingLocation(): void {
    if (!this.editingCustomer() && !this.addingCustomer()) {
      return;
    }

    this.notification.set(null);
    this.pickingLocation.set(true);
  }
}
