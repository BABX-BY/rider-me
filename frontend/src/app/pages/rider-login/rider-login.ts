import { Component, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
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

  protected readonly worksheetCode = signal('');
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal('');

  ngOnInit(): void {
    if (this.auth.getWorksheetCode()) {
      void this.router.navigate(['/rider/work']);
    }
  }

  protected setWorksheetCode(event: Event): void {
    this.worksheetCode.set((event.target as HTMLInputElement).value);
  }

  protected async login(): Promise<void> {
    this.errorMessage.set('');
    if (!this.worksheetCode().trim()) {
      this.errorMessage.set('กรุณากรอกเลขใบงาน');
      return;
    }

    this.loading.set(true);
    try {
      await this.auth.loginByWorksheet(this.worksheetCode());
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
  }

  protected goToWork(): void {
    void this.router.navigate(['/rider/work']);
  }
}
