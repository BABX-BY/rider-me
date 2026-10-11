import { Component, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Rider } from '../../model/rider.model';
import { RiderAuthApi } from '../../services/api/rider-auth-api';

@Component({
  selector: 'app-rider-login',
  imports: [],
  templateUrl: './rider-login.html',
  styleUrl: './rider-login.css',
})
export class RiderLogin implements OnInit {
  private readonly auth = inject(RiderAuthApi);
  private readonly router = inject(Router);

  protected readonly phone = signal('');
  protected readonly vehiclePlate = signal('');
  protected readonly rider = signal<Rider | null>(null);
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal('');

  ngOnInit(): void {
    if (this.auth.getToken()) {
      void this.router.navigate(['/rider/work']);
    }
  }

  protected setPhone(event: Event): void {
    this.phone.set((event.target as HTMLInputElement).value);
  }

  protected setVehiclePlate(event: Event): void {
    this.vehiclePlate.set((event.target as HTMLInputElement).value);
  }

  protected async login(): Promise<void> {
    this.errorMessage.set('');
    if (!this.phone().trim() || !this.vehiclePlate().trim()) {
      this.errorMessage.set('กรุณากรอกเบอร์โทรและทะเบียนรถ');
      return;
    }

    this.loading.set(true);
    try {
      const response = await this.auth.login(this.phone(), this.vehiclePlate());
      this.rider.set(response.rider);
      await this.router.navigate(['/rider/work']);
    } catch (error) {
      console.error('Rider login failed:', error);
      this.errorMessage.set('เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจสอบข้อมูลอีกครั้ง');
    } finally {
      this.loading.set(false);
    }
  }

  protected logout(): void {
    this.auth.logout();
    this.rider.set(null);
  }

  protected goToWork(): void {
    void this.router.navigate(['/rider/work']);
  }
}
