import { Component, inject, OnInit, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Rider } from '../../model/rider.model';
import { RiderApi } from '../../services/api/rider-api';

const PROD_FRONTEND_URL = 'https://rider-frontend-git-dev-mexw.vercel.app';

@Component({
  selector: 'app-riders',
  imports: [FormsModule, DecimalPipe],
  templateUrl: './riders.html',
  styleUrl: './riders.css',
})
export class Riders implements OnInit {
  private readonly riderApi = inject(RiderApi);

  protected readonly riders = signal<Rider[]>([]);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal('');
  protected searchName = '';
  protected readonly viewMode = signal<'cards' | 'table'>('cards');
  protected readonly qrRider = signal<Rider | null>(null);

  ngOnInit(): void {
    this.loadRiders();
  }

  protected async search(): Promise<void> {
    await this.loadRiders();
  }

  protected statusLabel(status: Rider['status']): string {
    return {
      AVAILABLE: 'พร้อมรับงาน',
      BUSY: 'กำลังจัดส่ง',
      INACTIVE: 'ไม่ใช้งาน',
    }[status] ?? status;
  }

  protected statusClass(status: Rider['status']): string {
    return {
      AVAILABLE: 'badge-success',
      BUSY: 'badge-warning',
      INACTIVE: 'badge-ghost',
    }[status] ?? 'badge-outline';
  }

  protected showQr(rider: Rider): void {
    this.qrRider.set(rider);
  }

  protected closeQr(): void {
    this.qrRider.set(null);
  }

  protected qrLoginUrl(rider: Rider): string {
    const isLocal = typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    const origin = isLocal ? PROD_FRONTEND_URL : (typeof window !== 'undefined' ? window.location.origin : PROD_FRONTEND_URL);
    const baseUrl = origin + '/rider/login';
    return rider.worksheet_code
      ? baseUrl + '?worksheetCode=' + encodeURIComponent(rider.worksheet_code)
      : baseUrl;
  }

  protected qrImageUrl(rider: Rider): string {
    return 'https://api.qrserver.com/v1/create-qr-code/?size=240x240&data='
      + encodeURIComponent(this.qrLoginUrl(rider));
  }

  private async loadRiders(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set('');

    try {
      this.riders.set(await this.riderApi.getRiders(this.searchName));
    } catch (error) {
      console.error('ไม่สามารถโหลดข้อมูล Rider ได้:', error);
      this.errorMessage.set('ไม่สามารถโหลดข้อมูล Rider ได้ กรุณาตรวจสอบ Backend');
    } finally {
      this.loading.set(false);
    }
  }
}
