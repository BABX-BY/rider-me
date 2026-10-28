import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
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
  private readonly route = inject(ActivatedRoute);

  protected readonly worksheetCode = signal('');
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal('');

  async ngOnInit(): Promise<void> {
    const queryCode = this.route.snapshot.queryParamMap.get('worksheetCode')?.trim().toUpperCase();
    const currentCode = this.auth.getWorksheetCode();

    if (queryCode) {
      this.worksheetCode.set(queryCode);
      await this.executeLogin(queryCode);
    } else if (currentCode) {
      void this.router.navigate(['/rider/work']);
    }
  }

  protected setWorksheetCode(event: Event): void {
    this.worksheetCode.set((event.target as HTMLInputElement).value);
  }

  protected async login(): Promise<void> {
    const code = this.worksheetCode().trim().toUpperCase();
    if (!code) {
      this.errorMessage.set('กรุณากรอกเลขใบงาน');
      return;
    }
    await this.executeLogin(code);
  }

  private async executeLogin(code: string): Promise<void> {
    this.errorMessage.set('');
    this.loading.set(true);

    try {
      await this.auth.loginByWorksheet(code);
      await this.router.navigate(['/rider/work']);
    } catch (error) {
      console.error('Rider login failed:', error);
      this.errorMessage.set('เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจสอบเลขใบงานอีกครั้ง');
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
