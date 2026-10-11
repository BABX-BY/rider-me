import { Rider } from './rider.model';

export interface RiderLoginResponse {
  rider: Rider;
  token: string;
  expiresInHours: number;
}
