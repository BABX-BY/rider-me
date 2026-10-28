import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Rider } from '../../model/rider.model';
import { RiderApi } from '../../services/api/rider-api';

const DEFAULT_PROD_FRONTEND_URL = 'https://rider-frontend-sigma.vercel.app';

@Component({
  selector: 'app-riders',
  imports: [FormsModule],
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

  // QR domain selection & custom URL support
  protected readonly selectedBaseUrlOption = signal<'auto' | 'prod' | 'current' | 'custom'>('auto');
  protected readonly customBaseUrlInput = signal('');
  protected readonly copySuccess = signal(false);

  protected readonly isRunningOnLocalhost = computed(() => {
    if (typeof window === 'undefined') return false;
    return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  });

  protected readonly currentOrigin = computed(() => {
    return typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4200';
  });

  protected readonly productionUrl = computed(() => {
    return DEFAULT_PROD_FRONTEND_URL;
  });

  protected readonly activeBaseUrl = computed(() => {
    const option = this.selectedBaseUrlOption();
    if (option === 'prod') {
      return this.productionUrl();
    }
    if (option === 'current') {
      return this.currentOrigin();
    }
    if (option === 'custom' && this.customBaseUrlInput().trim()) {
      return this.customBaseUrlInput().trim().replace(/\/+$/, '');
    }
    // 'auto' option:
    // If running on localhost, default to Production URL so phone cameras scanning can open it!
    // Otherwise, use current window.location.origin.
    if (this.isRunningOnLocalhost() && this.productionUrl()) {
      return this.productionUrl();
    }
    return this.currentOrigin();
  });

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
    const baseUrl = this.activeBaseUrl().replace(/\/+$/, '') + '/rider/login';
    return rider.worksheet_code
      ? baseUrl + '?worksheetCode=' + encodeURIComponent(rider.worksheet_code)
      : baseUrl;
  }

  protected qrImageUrl(rider: Rider): string {
    return 'https://api.qrserver.com/v1/create-qr-code/?size=240x240&data='
      + encodeURIComponent(this.qrLoginUrl(rider));
  }

  protected async copyQrUrl(rider: Rider): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.qrLoginUrl(rider));
      this.copySuccess.set(true);
      setTimeout(() => this.copySuccess.set(false), 2000);
    } catch (err) {
      console.error('Failed to copy QR URL:', err);
    }
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
