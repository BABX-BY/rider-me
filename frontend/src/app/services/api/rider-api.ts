import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { lastValueFrom } from 'rxjs';
import { Api } from '../../config/api';
import { Rider } from '../../model/rider.model';

@Injectable({ providedIn: 'root' })
export class RiderApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(Api);

  async getRiders(name = ''): Promise<Rider[]> {
    let params = new HttpParams();
    if (name.trim()) params = params.set('name', name.trim());
    return lastValueFrom(this.http.get<Rider[]>(this.api.API_ENDPOINT + '/rider', { params }));
  }
}
