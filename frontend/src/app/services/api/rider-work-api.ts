import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { lastValueFrom } from 'rxjs';
import { Api } from '../../config/api';
import { RiderWorkSummary } from '../../model/rider-work.model';

@Injectable({ providedIn: 'root' })
export class RiderWorkApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(Api);

  async getWork(worksheetCode: string): Promise<RiderWorkSummary> {
    const response = await lastValueFrom(
      this.http.get<{ work: RiderWorkSummary }>(`${this.api.API_ENDPOINT}/rider/work`, {
        headers: new HttpHeaders({ 'x-worksheet-code': worksheetCode }),
      }),
    );
    return response.work;
  }
}
