import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { RiderAuthApi } from '../services/api/rider-auth-api';

export const riderLoginGuard: CanActivateFn = (route) => {
  const auth = inject(RiderAuthApi);
  const router = inject(Router);
  const queryCode = route.queryParamMap.get('worksheetCode')?.trim().toUpperCase();
  const currentCode = auth.getWorksheetCode();

  // If already logged in and NO new worksheetCode is provided, or the provided code is the same,
  // proceed to work page.
  // Otherwise, allow navigating to login page so the new worksheetCode can be applied.
  if (currentCode && (!queryCode || queryCode === currentCode)) {
    return router.createUrlTree(['/rider/work']);
  }
  return true;
};
