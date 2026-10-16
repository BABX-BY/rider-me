import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { RiderAuthApi } from '../services/api/rider-auth-api';

export const riderSessionGuard: CanActivateFn = () => {
  const auth = inject(RiderAuthApi);
  const router = inject(Router);
  return auth.getWorksheetCode() ? true : router.createUrlTree(['/rider/login']);
};
