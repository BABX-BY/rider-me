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
  private readonly tokenKey = 'rider_token';

  async loginByWorksheet(worksheetCode: string): Promise<RiderLoginResponse> {
    const response = await lastValueFrom(
      this.http.post<RiderLoginResponse>(`${this.api.API_ENDPOINT}/rider/auth/worksheet`, { worksheetCode }),
    );
    localStorage.setItem(this.tokenKey, response.token);
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
    localStorage.removeItem(this.tokenKey);
  }

  getToken(): string {
    return localStorage.getItem(this.tokenKey) ?? '';
  }

  private authHeaders(): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${this.getToken()}` });
  }
}
