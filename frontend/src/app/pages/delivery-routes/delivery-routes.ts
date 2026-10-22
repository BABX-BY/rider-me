import { Component, computed, signal } from '@angular/core';
import { RouteMap } from './route-map';
import { PREVIEW_ROUTES, PREVIEW_STORE } from './delivery-routes.preview';

@Component({
  selector: 'app-delivery-routes',
  imports: [RouteMap],
  templateUrl: './delivery-routes.html',
  styleUrls: ['./delivery-routes.css', './route-legend.css'],
})
export class DeliveryRoutes {
  protected readonly store = PREVIEW_STORE;
  protected readonly previewMode = signal(true);
  protected readonly activeRouteId = signal<number | null>(null);
  protected readonly selectedStopId = signal<number | null>(null);
  protected readonly routes = computed(() => (this.previewMode() ? PREVIEW_ROUTES : []));

  protected togglePreview(): void {
    this.previewMode.update((visible) => !visible);
    this.showAllRoutes();
  }

  protected showAllRoutes(): void {
    this.activeRouteId.set(null);
    this.selectedStopId.set(null);
  }

  protected selectRoute(id: number): void {
    this.activeRouteId.set(this.activeRouteId() === id ? null : id);
    this.selectedStopId.set(null);
  }

  protected selectStop(id: number): void {
    const route = PREVIEW_ROUTES.find((item) => item.stops.some((stop) => stop.id === id));
    if (route && this.previewMode()) {
      this.activeRouteId.set(route.id);
      this.selectedStopId.set(id);
    }
  }
}
