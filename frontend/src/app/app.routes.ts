import { Routes } from '@angular/router';
import { Customers } from './pages/customers/customers';
import { Orders } from './pages/orders/orders';
import { DeliveryRoutes } from './pages/delivery-routes/delivery-routes';
import { RiderLogin } from './pages/rider-login/rider-login';
import { RiderWork } from './pages/rider-work/rider-work';
import { riderSessionGuard } from './guards/rider-session.guard';
import { riderLoginGuard } from './guards/rider-login.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'customers', pathMatch: 'full' },
  { path: 'customers', component: Customers },
  { path: 'orders', component: Orders },
  { path: 'delivery-routes', component: DeliveryRoutes },
  { path: 'rider/login', component: RiderLogin, canActivate: [riderLoginGuard] },
  { path: 'login', component: RiderLogin, canActivate: [riderLoginGuard] },
  { path: 'rider/work', component: RiderWork, canActivate: [riderSessionGuard] },
];
