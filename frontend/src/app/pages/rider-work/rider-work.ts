import { Component, computed, ElementRef, inject, OnDestroy, OnInit, signal, ViewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import * as L from 'leaflet';
import { MAPTILER_API_KEY } from '../../config/map';
import { Rider } from '../../model/rider.model';
import { RiderWorkStop, RiderWorkSummary } from '../../model/rider-work.model';
import { RiderAuthApi } from '../../services/api/rider-auth-api';
import { RiderWorkApi } from '../../services/api/rider-work-api';

@Component({
  selector: 'app-rider-work',
  imports: [DecimalPipe],
  templateUrl: './rider-work.html',
  styleUrl: './rider-work.css',
})
export class RiderWork implements OnDestroy, OnInit {
  private readonly auth = inject(RiderAuthApi);
  private readonly workApi = inject(RiderWorkApi);
  @ViewChild('orderMap') private orderMapElement?: ElementRef<HTMLDivElement>;
  @ViewChild('overviewMap') private overviewMapElement?: ElementRef<HTMLDivElement>;
  private map?: L.Map;
  private routeLine?: L.Polyline;
  private overviewMap?: L.Map;
  private overviewRouteLine?: L.Polyline;
  private routeRequestId = 0;

  protected readonly rider = signal<Rider | null>(null);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal('');
  protected readonly statusUpdating = signal<number | null>(null);
  protected readonly selectedStopSequence = signal<number | null>(null);
  protected readonly showOverviewMap = signal(false);
  protected readonly work = signal<RiderWorkSummary>({
    workDate: '',
    totalBoxes: 0,
    totalStops: 0,
    deliveredStops: 0,
    pendingStops: 0,
    storeName: '',
    storePhone: '',
    storeAddress: '',
    storeLatitude: null,
    storeLongitude: null,
    stops: [],
  });

  protected readonly hasStops = computed(() => this.work().stops.length > 0);

  protected get worksheetCode(): string {
    return this.auth.getWorksheetCode();
  }

  ngOnInit(): void {
    this.loadRiderAndWork();
  }

  ngOnDestroy(): void {
    this.map?.remove();
    this.overviewMap?.remove();
  }

  protected statusLabel(status: RiderWorkStop['status']): string {
    return {
      PENDING: 'รอจัดส่ง',
      DELIVERED: 'จัดส่งแล้ว',
      FAILED: 'จัดส่งไม่สำเร็จ',
    }[status];
  }

  protected async updateStopStatus(stop: RiderWorkStop, status: RiderWorkStop['status']): Promise<void> {
    if (this.statusUpdating() !== null || stop.status === status) return;
    this.statusUpdating.set(stop.routeStopId);
    this.errorMessage.set('');
    try {
      await this.workApi.updateStopStatus(this.auth.getWorksheetCode(), stop.routeStopId, status);
      this.work.update((current) => {
        const stops = current.stops.map((item) =>
          item.routeStopId === stop.routeStopId ? { ...item, status } : item,
        );
        return {
          ...current,
          stops,
          deliveredStops: stops.filter((item) => item.status === 'DELIVERED').length,
          pendingStops: stops.filter((item) => item.status !== 'DELIVERED').length,
        };
      });
    } catch (error) {
      console.error('ไม่สามารถอัปเดตสถานะจุดส่งได้:', error);
      this.errorMessage.set('ไม่สามารถบันทึกสถานะจุดส่งได้ กรุณาลองใหม่');
    } finally {
      this.statusUpdating.set(null);
    }
  }

  protected routeColor(sequence: number): string {
    const colors = ['#4f46e5', '#db2777', '#059669', '#ea580c', '#0891b2', '#7c3aed'];
    return colors[(sequence - 1) % colors.length];
  }

  protected estimatedMinutesToStop(stopIndex: number): number {
    const points = this.routePointsThrough(stopIndex);
    if (points.length < 2) return 0;

    let distance = 0;
    for (let index = 1; index < points.length; index += 1) {
      distance += this.distanceKm(points[index - 1], points[index]);
    }
    return Math.max(1, Math.ceil((distance / 30) * 60));
  }

  protected showStopOnMap(stop: RiderWorkStop): void {
    if (this.selectedStopSequence() === stop.sequence) {
      this.map?.remove();
      this.map = undefined;
      this.selectedStopSequence.set(null);
      return;
    }

    this.map?.remove();
    this.map = undefined;
    this.selectedStopSequence.set(stop.sequence);
    setTimeout(() => this.renderSelectedStopMap(stop));
  }

  protected toggleOverviewMap(): void {
    if (this.showOverviewMap()) {
      this.overviewMap?.remove();
      this.overviewMap = undefined;
      this.showOverviewMap.set(false);
      return;
    }

    this.showOverviewMap.set(true);
    setTimeout(() => this.renderOverviewMap());
  }

  protected openNavigation(stop: RiderWorkStop): void {
    if (stop.latitude === null || stop.longitude === null) return;

    const currentWork = this.work();
    const url = new URL('https://www.google.com/maps/dir/');
    url.searchParams.set('api', '1');
    url.searchParams.set('destination', stop.latitude + ',' + stop.longitude);
    if (currentWork.storeLatitude !== null && currentWork.storeLongitude !== null) {
      url.searchParams.set('origin', currentWork.storeLatitude + ',' + currentWork.storeLongitude);
    }
    url.searchParams.set('travelmode', 'driving');
    window.open(url.toString(), '_blank', 'noopener,noreferrer');
  }

  protected openStoreNavigation(): void {
    const currentWork = this.work();
    if (currentWork.storeLatitude === null || currentWork.storeLongitude === null) return;

    const lastStop = currentWork.stops.at(-1);
    const url = new URL('https://www.google.com/maps/dir/');
    url.searchParams.set('api', '1');
    url.searchParams.set('destination', currentWork.storeLatitude + ',' + currentWork.storeLongitude);
    if (lastStop && lastStop.latitude !== null && lastStop.longitude !== null) {
      url.searchParams.set('origin', lastStop.latitude + ',' + lastStop.longitude);
    }
    url.searchParams.set('travelmode', 'driving');
    window.open(url.toString(), '_blank', 'noopener,noreferrer');
  }

  protected logout(): void {
    this.auth.logout();
    window.location.href = '/rider/login';
  }

  private async loadRiderAndWork(): Promise<void> {
    try {
      const [rider, work] = await Promise.all([
        this.auth.getMe(),
        this.workApi.getWork(this.auth.getWorksheetCode()),
      ]);
      this.rider.set(rider);
      this.work.set(work);
    } catch (error) {
      console.error('ไม่สามารถโหลดข้อมูล Rider หรือใบงานได้:', error);
      this.errorMessage.set('ไม่สามารถโหลดข้อมูลใบงานได้ กรุณาลองเข้าสู่ระบบใหม่');
    } finally {
      this.loading.set(false);
    }
  }

  private renderSelectedStopMap(stop: RiderWorkStop): void {
    const element = this.orderMapElement?.nativeElement;
    const currentWork = this.work();
    if (!element || currentWork.storeLatitude === null || currentWork.storeLongitude === null
      || stop.latitude === null || stop.longitude === null) return;

    const points: L.LatLngExpression[] = [
      [currentWork.storeLatitude, currentWork.storeLongitude],
      [stop.latitude, stop.longitude],
    ];
    const color = this.routeColor(stop.sequence);
    this.map = L.map(element, { zoomControl: true }).setView(points[0], 15);
    L.tileLayer(
      'https://api.maptiler.com/maps/streets-v4/{z}/{x}/{y}.png?key=' + MAPTILER_API_KEY,
      {
        attribution: '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; OpenStreetMap contributors',
      },
    ).addTo(this.map);

    L.circleMarker(points[0], {
      radius: 9, color: '#0f766e', fillColor: '#14b8a6', fillOpacity: 1, weight: 3,
    }).bindTooltip('ร้านต้นทาง').addTo(this.map);
    L.circleMarker(points[1], {
      radius: 9, color, fillColor: color, fillOpacity: 1, weight: 3,
    }).bindTooltip('จุดส่งที่ ' + stop.sequence).addTo(this.map);

    this.drawRoadRoute(points, color);
  }

  private renderOverviewMap(): void {
    const element = this.overviewMapElement?.nativeElement;
    const points = this.routePointsThrough(this.work().stops.length - 1);
    if (!element || points.length < 2 || this.overviewMap) return;

    this.overviewMap = L.map(element, { zoomControl: true }).setView(points[0], 14);
    L.tileLayer(
      'https://api.maptiler.com/maps/streets-v4/{z}/{x}/{y}.png?key=' + MAPTILER_API_KEY,
      {
        attribution: '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; OpenStreetMap contributors',
      },
    ).addTo(this.overviewMap);

    L.circleMarker(points[0], {
      radius: 9, color: '#0f766e', fillColor: '#14b8a6', fillOpacity: 1, weight: 3,
    }).bindTooltip('ร้านต้นทาง').addTo(this.overviewMap);

    this.work().stops.forEach((stop) => {
      if (stop.latitude === null || stop.longitude === null) return;
      const color = this.routeColor(stop.sequence);
      L.circleMarker([stop.latitude, stop.longitude], {
        radius: 8, color, fillColor: color, fillOpacity: 1, weight: 3,
      }).bindTooltip('จุดส่งที่ ' + stop.sequence).addTo(this.overviewMap!);
    });

    this.drawOverviewRoadRoute(points);
  }

  private drawOverviewRoadRoute(points: L.LatLngExpression[]): void {
    if (!this.overviewMap) return;

    const coordinates = points.map((point) => {
      const [lat, lon] = point as [number, number];
      return lon + ',' + lat;
    }).join(';');
    const fallback = () => {
      if (!this.overviewMap) return;
      this.overviewRouteLine?.remove();
      this.overviewRouteLine = L.polyline(points, {
        color: '#4f46e5', weight: 5, opacity: 0.85, dashArray: '10 8',
      }).addTo(this.overviewMap);
      this.overviewMap.fitBounds(L.latLngBounds(points), { padding: [24, 24] });
    };

    fetch('https://router.project-osrm.org/route/v1/driving/' + coordinates + '?overview=full&geometries=geojson')
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Routing request failed')))
      .then((data: { code?: string; routes?: Array<{ geometry?: { coordinates?: Array<[number, number]> } }> }) => {
        const routeCoordinates = data.routes?.[0]?.geometry?.coordinates;
        if (data.code !== 'Ok' || !routeCoordinates?.length || !this.overviewMap) {
          fallback();
          return;
        }
        const roadPoints = routeCoordinates.map(([lon, lat]) => [lat, lon] as L.LatLngExpression);
        this.overviewRouteLine?.remove();
        this.overviewRouteLine = L.polyline(roadPoints, { color: '#4f46e5', weight: 5, opacity: 0.9 }).addTo(this.overviewMap);
        this.overviewMap.fitBounds(L.latLngBounds(roadPoints), { padding: [24, 24] });
      })
      .catch(fallback);
  }

  private drawRoadRoute(points: L.LatLngExpression[], color: string): void {
    if (!this.map) return;

    const requestId = ++this.routeRequestId;
    const fallback = () => {
      if (requestId !== this.routeRequestId || !this.map) return;
      this.routeLine?.remove();
      this.routeLine = L.polyline(points, { color, weight: 5, opacity: 0.9, dashArray: '10 8' }).addTo(this.map);
      this.map.fitBounds(L.latLngBounds(points), { padding: [24, 24] });
    };
    const coordinates = points.map((point) => {
      const [lat, lon] = point as [number, number];
      return lon + ',' + lat;
    }).join(';');

    fetch('https://router.project-osrm.org/route/v1/driving/' + coordinates + '?overview=full&geometries=geojson')
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Routing request failed')))
      .then((data: { code?: string; routes?: Array<{ geometry?: { coordinates?: Array<[number, number]> } }> }) => {
        const routeCoordinates = data.routes?.[0]?.geometry?.coordinates;
        if (data.code !== 'Ok' || !routeCoordinates?.length || !this.map || requestId !== this.routeRequestId) {
          fallback();
          return;
        }
        const roadPoints = routeCoordinates.map(([lon, lat]) => [lat, lon] as L.LatLngExpression);
        this.routeLine?.remove();
        this.routeLine = L.polyline(roadPoints, { color, weight: 5, opacity: 0.9 }).addTo(this.map);
        this.map.fitBounds(L.latLngBounds(roadPoints), { padding: [24, 24] });
      })
      .catch(fallback);
  }

  private routePointsThrough(stopIndex: number): L.LatLngExpression[] {
    const currentWork = this.work();
    if (currentWork.storeLatitude === null || currentWork.storeLongitude === null) return [];

    const points: L.LatLngExpression[] = [[currentWork.storeLatitude, currentWork.storeLongitude]];
    for (const stop of currentWork.stops.slice(0, stopIndex + 1)) {
      if (stop.latitude !== null && stop.longitude !== null) points.push([stop.latitude, stop.longitude]);
    }
    return points;
  }

  private distanceKm(from: L.LatLngExpression, to: L.LatLngExpression): number {
    const [fromLat, fromLon] = from as [number, number];
    const [toLat, toLon] = to as [number, number];
    const earthRadius = 6371;
    const latDelta = ((toLat - fromLat) * Math.PI) / 180;
    const lonDelta = ((toLon - fromLon) * Math.PI) / 180;
    const a = Math.sin(latDelta / 2) ** 2
      + Math.cos((fromLat * Math.PI) / 180)
      * Math.cos((toLat * Math.PI) / 180)
      * Math.sin(lonDelta / 2) ** 2;
    return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
