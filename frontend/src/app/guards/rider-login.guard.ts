import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { RiderAuthApi } from '../services/api/rider-auth-api';

export const riderLoginGuard: CanActivateFn = () => {
  const auth = inject(RiderAuthApi);
  const router = inject(Router);
  return auth.getWorksheetCode() ? router.createUrlTree(['/rider/work']) : true;
};
