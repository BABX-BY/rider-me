import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  signal,
  ViewChild,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import * as L from 'leaflet';
import { MAPTILER_API_KEY } from '../../config/map';

@Component({
  selector: 'app-delivery-routes',
  imports: [DecimalPipe],
  templateUrl: './delivery-routes.html',
  styleUrl: './delivery-routes.css',
})
export class DeliveryRoutes implements AfterViewInit, OnDestroy {
  @ViewChild('mapElement') private mapElement!: ElementRef<HTMLDivElement>;

  private map?: L.Map;

  // ---------- สถานะของหน้าจอ ----------
  protected readonly loading = signal(false);
  protected readonly calculated = signal(false);
  protected readonly confirmed = signal(false);

  // ---------- ข้อมูลสรุป (ตอนนี้ยังเป็นค่าจำลอง) ----------
  protected readonly pendingOrders = signal(0);
  protected readonly totalBoxes = signal(0);
  protected readonly availableRiders = signal(0);

  // ---------- ข้อมูลทางการเงิน ----------
  protected readonly totalRevenue = signal(0);
  protected readonly totalFoodCost = signal(0);
  protected readonly totalDeliveryCost = signal(0);
  protected readonly totalProfit = signal(0);

  // ---------- Leaflet Map ----------
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
  }

  ngOnDestroy(): void {
    this.map?.remove();
  }

  
  protected calculate(): void {
    // TODO: เรียก API ดึงข้อมูลและรัน Algorithm จัดเส้นทาง
  }

  protected recalculate(): void {
    // TODO: คำนวณเส้นทางทางเลือกใหม่
  }

  protected confirmRoutes(): void {
    // TODO: ยืนยันและบันทึกแผนจัดส่งลงฐานข้อมูล
  }
}
