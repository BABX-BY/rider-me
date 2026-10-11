import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Rider } from '../../model/rider.model';
import { RiderWorkStop, RiderWorkSummary } from '../../model/rider-work.model';
import { RiderAuthApi } from '../../services/api/rider-auth-api';

@Component({
  selector: 'app-rider-work',
  imports: [],
  templateUrl: './rider-work.html',
  styleUrl: './rider-work.css',
})
export class RiderWork implements OnInit {
  private readonly auth = inject(RiderAuthApi);

  protected readonly rider = signal<Rider | null>(null);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal('');
  protected readonly work = signal<RiderWorkSummary>({
    workDate: '',
    totalBoxes: 0,
    totalStops: 0,
    deliveredStops: 0,
    pendingStops: 0,
    storeName: '',
    storeAddress: '',
    storeLatitude: null,
    storeLongitude: null,
    stops: [],
  });

  protected readonly hasStops = computed(() => this.work().stops.length > 0);

  ngOnInit(): void {
    this.loadRider();
  }

  protected openNavigation(stop: RiderWorkStop): void {
    if (stop.latitude === null || stop.longitude === null) {
      return;
    }
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${stop.latitude},${stop.longitude}`, '_blank', 'noopener,noreferrer');
  }

  protected openStoreNavigation(): void {
    const currentWork = this.work();
    if (currentWork.storeLatitude === null || currentWork.storeLongitude === null) {
      return;
    }
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${currentWork.storeLatitude},${currentWork.storeLongitude}`, '_blank', 'noopener,noreferrer');
  }

  protected logout(): void {
    this.auth.logout();
    window.location.href = '/rider/login';
  }

  private async loadRider(): Promise<void> {
    try {
      this.rider.set(await this.auth.getMe());
    } catch (error) {
      console.error('ไม่สามารถโหลดข้อมูล Rider ได้:', error);
      this.errorMessage.set('Session หมดอายุ กรุณาเข้าสู่ระบบใหม่');
    } finally {
      this.loading.set(false);
    }
  }
}
