import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { lastValueFrom } from 'rxjs';
import { Api } from '../../config/api';
import { Rider } from '../../model/rider.model';
import { RiderLoginResponse } from '../../model/rider-auth.model';

@Injectable({ providedIn: 'root' })
export class RiderAuthApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(Api);
  private readonly storageKey = 'rider_worksheet_code';

  async loginByWorksheet(worksheetCode: string): Promise<RiderLoginResponse> {
    const response = await lastValueFrom(
      this.http.post<RiderLoginResponse>(`${this.api.API_ENDPOINT}/rider/auth/worksheet`, { worksheetCode }),
    );
    const code = response.worksheetCode || worksheetCode.trim().toUpperCase();
    localStorage.setItem(this.storageKey, code);
    return response;
  }

  async getMe(): Promise<Rider> {
    const response = await lastValueFrom(
      this.http.get<{ rider: Rider }>(`${this.api.API_ENDPOINT}/rider/auth/me`, {
        headers: this.authHeaders(),
      }),
    );
    return response.rider;
  }

  logout(): void {
    localStorage.removeItem(this.storageKey);
  }

  getWorksheetCode(): string {
    return localStorage.getItem(this.storageKey) ?? '';
  }

  private authHeaders(): HttpHeaders {
    return new HttpHeaders({ 'x-worksheet-code': this.getWorksheetCode() });
  }
}

