import { getRoadRoute } from '../map/road-route';
import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  ViewEncapsulation,
  signal,
} from '@angular/core';
import * as L from 'leaflet';
import { MAPTILER_API_KEY } from '../../../config/map';
import { PreviewRoute, PreviewStore } from './delivery-routes.preview';

@Component({
  selector: 'app-saved-route-map',
  templateUrl: './route-map.html',
  styleUrl: './route-map.css',
  encapsulation: ViewEncapsulation.None,
})
export class RouteMap implements AfterViewInit, OnChanges, OnDestroy {
  @Input() routes: readonly PreviewRoute[] = [];
  @Input() store: PreviewStore | null = null;
  @Input() activeRouteId: number | null = null;
  @Input() selectedStopId: number | null = null;
  @Output() readonly stopSelected = new EventEmitter<number>();
  @ViewChild('mapElement') private mapElement!: ElementRef<HTMLDivElement>;

  protected readonly tileError = signal(false);
  protected readonly usingFallback = signal(false);
  private map?: L.Map;
  private routeLayer?: L.LayerGroup;
  private resizeObserver?: ResizeObserver;
  private readonly basemapAbort = new AbortController();
  private readonly stopMarkers = new Map<number, L.Marker>();
  private readonly roadRoutes = new Map<number, L.LatLngTuple[]>();
  private roadRequestId = 0;
  private roadAbort?: AbortController;
  protected readonly roadLoading = signal(false);
  protected readonly roadFailed = signal(false);

  protected get visibleRoutes(): readonly PreviewRoute[] {
    return this.activeRouteId === null
      ? this.routes
      : this.routes.filter((route) => route.id === this.activeRouteId);
  }

  ngAfterViewInit(): void {
    this.map = L.map(this.mapElement.nativeElement, {
      scrollWheelZoom: true,
    }).setView(this.storePosition(), 14);

    const tiles = L.tileLayer(
      `https://api.maptiler.com/maps/streets-v4/{z}/{x}/{y}.png?key=${MAPTILER_API_KEY}`,
      {
        tileSize: 512,
        zoomOffset: -1,
        minZoom: 1,
        attribution:
          '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
        crossOrigin: true,
      },
    );
    const map = this.map;
    const useFallback = () => {
      if (this.map !== map || this.usingFallback()) return;
      tiles.remove();
      this.usingFallback.set(true);
      const fallback = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        minZoom: 1,
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
        crossOrigin: true,
      });
      fallback.on('loading', () => this.tileError.set(false));
      fallback.on('tileerror', () => this.tileError.set(true));
      fallback.addTo(map);
    };
    tiles.once('tileerror', useFallback);
    // A rejected key can still return a decodable error image, so check HTTP
    // status before loading tiles rather than relying only on image errors.
    void fetch(`https://api.maptiler.com/maps/streets-v4/style.json?key=${MAPTILER_API_KEY}`, {
      signal: this.basemapAbort.signal,
    })
      .then((response) => {
        if (this.map !== map) return;
        if (response.ok) tiles.addTo(map);
        else useFallback();
      })
      .catch(useFallback);
    this.routeLayer = L.layerGroup().addTo(this.map);
    this.renderRoutes();
    this.fitRoutes(this.visibleRoutes);
    void this.loadRoadRoutes(this.visibleRoutes);

    this.resizeObserver = new ResizeObserver(() => {
      this.map?.invalidateSize({ pan: false });
    });
    this.resizeObserver.observe(this.mapElement.nativeElement);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.map) return;
    if (changes['routes'] || changes['activeRouteId'] || changes['store']) {
      this.renderRoutes();
      this.fitRoutes(this.visibleRoutes);
      void this.loadRoadRoutes(this.visibleRoutes);
    } else if (changes['selectedStopId']) {
      this.renderRoutes();
    }
    if (this.selectedStopId !== null) {
      const marker = this.stopMarkers.get(this.selectedStopId);
      if (marker) {
        this.map.panTo(marker.getLatLng(), { animate: false });
        marker.openPopup();
      }
    }
  }

  ngOnDestroy(): void {
    this.basemapAbort.abort();
    this.roadAbort?.abort();
    this.resizeObserver?.disconnect();
    this.map?.remove();
    this.map = undefined;
    this.stopMarkers.clear();
    this.roadRoutes.clear();
    this.roadRequestId += 1;
  }

  protected showAllRoutes(): void {
    this.fitRoutes(this.routes);
  }

  private fitRoutes(routes: readonly PreviewRoute[]): void {
    const positions: L.LatLngTuple[] = [this.storePosition()];
    for (const route of routes) {
      for (const stop of route.stops) {
        if (this.validPosition(stop.latitude, stop.longitude)) {
          positions.push([stop.latitude, stop.longitude]);
        }
      }
    }
    this.map?.fitBounds(positions, { padding: [40, 50], maxZoom: 16, animate: false });
  }

  private renderRoutes(): void {
    if (!this.map || !this.routeLayer) return;
    this.routeLayer.clearLayers();
    this.stopMarkers.clear();
    const storePosition = this.storePosition();

    for (const route of this.visibleRoutes) {
      const stops = route.stops.filter((stop) => this.validPosition(stop.latitude, stop.longitude));
      const straightPositions: L.LatLngTuple[] = [
        storePosition,
        ...stops.map((stop): L.LatLngTuple => [stop.latitude, stop.longitude]),
        storePosition,
      ];
      const positions = this.roadRoutes.get(route.id) ?? straightPositions;
      if (stops.length) {
        L.polyline(positions, { color: route.color, weight: 4, opacity: 0.8, ...(this.roadRoutes.has(route.id) ? {} : { dashArray: '6 8' }) }).addTo(
          this.routeLayer,
        );
      }

      for (const stop of stops) {
        const selected = stop.id === this.selectedStopId;
        const pin = this.createStopPin(stop.sequence, route.color, selected);
        const marker = L.marker([stop.latitude, stop.longitude], {
          icon: L.divIcon({
            className: 'delivery-map__marker',
            html: pin.outerHTML,
            iconSize: [32, 42],
            iconAnchor: [16, 42],
            popupAnchor: [0, -40],
          }),
          keyboard: true,
          title: `จุดส่ง ${stop.sequence} ${stop.customer} · ${route.name}`,
          riseOnHover: true,
          zIndexOffset: selected ? 500 : 100,
        })
          .bindPopup(
            this.createPopup(stop.customer, [
              `จุดส่ง ${stop.sequence} · ${route.name}`,
              stop.address,
              `${stop.boxes} กล่อง · คาดว่าถึง ${stop.eta} น.`,
            ]),
          )
          .addTo(this.routeLayer);
        marker.on('click', () => this.stopSelected.emit(stop.id));
        const element = marker.getElement();
        element?.setAttribute('role', 'button');
        element?.setAttribute(
          'aria-label',
          `เลือกจุดส่ง ${stop.sequence} ${stop.customer} ${route.name}`,
        );
        element?.setAttribute('aria-pressed', String(selected));
        this.stopMarkers.set(stop.id, marker);
      }
    }

    const storeIcon = document.createElement('span');
    storeIcon.className = 'delivery-map__store-pin';
    storeIcon.textContent = 'ร้าน';
    const storeMarker = L.marker(storePosition, {
      icon: L.divIcon({
        className: 'delivery-map__marker',
        html: storeIcon,
        iconSize: [42, 42],
        iconAnchor: [21, 21],
        popupAnchor: [0, -25],
      }),
      keyboard: true,
      title: `${this.store?.name ?? 'ร้านค้า'} · จุดเริ่มต้น`,
      zIndexOffset: 700,
    })
      .bindPopup(this.createPopup(this.store?.name ?? 'ร้านค้า', ['จุดเริ่มต้นของทุกเส้นทาง']))
      .addTo(this.routeLayer);
    storeMarker
      .getElement()
      ?.setAttribute('aria-label', `${this.store?.name ?? 'ร้านค้า'} จุดเริ่มต้น`);
  }

  private async loadRoadRoutes(routes: readonly PreviewRoute[]): Promise<void> {
    const requestId = ++this.roadRequestId;
    this.roadAbort?.abort();
    const request = new AbortController();
    this.roadAbort = request;
    this.roadRoutes.clear();
    this.roadLoading.set(routes.length > 0);
    this.roadFailed.set(false);
    const storePosition = this.storePosition();
    for (let index = 0; index < routes.length; index += 3) {
      if (request.signal.aborted) return;
      await Promise.all(routes.slice(index, index + 3).map(async (route) => {
        const stops = route.stops.filter((stop) => this.validPosition(stop.latitude, stop.longitude));
        if (!stops.length) return;
        try {
          const points: L.LatLngTuple[] = [storePosition,
            ...stops.map((stop): L.LatLngTuple => [stop.latitude, stop.longitude]), storePosition];
          const road = await getRoadRoute(points, request.signal);
          if (!request.signal.aborted) this.roadRoutes.set(route.id, road);
        } catch {
          if (!request.signal.aborted) this.roadFailed.set(true);
        }
      }));
      if (!request.signal.aborted) this.renderRoutes();
    }
    if (this.map && requestId === this.roadRequestId) {
      this.roadLoading.set(false);
      this.renderRoutes();
      this.fitRoutes(this.visibleRoutes);
    }
  }

  private storePosition(): L.LatLngTuple {
    const latitude = Number(this.store?.latitude);
    const longitude = Number(this.store?.longitude);
    if (this.validPosition(latitude, longitude)) return [latitude, longitude];
    const firstStop = this.routes.flatMap((route) => route.stops).find((stop) =>
      this.validPosition(Number(stop.latitude), Number(stop.longitude)),
    );
    if (firstStop) return [Number(firstStop.latitude), Number(firstStop.longitude)];
    return [0, 0];
  }

  private addDirection(start: L.LatLngTuple, end: L.LatLngTuple, color: string): void {
    if (!this.map || !this.routeLayer || (start[0] === end[0] && start[1] === end[1])) return;
    const from = this.map.project(start, 0);
    const to = this.map.project(end, 0);
    const angle = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
    const arrow = document.createElement('span');
    arrow.className = 'delivery-map__arrow';
    arrow.textContent = '➤';
    arrow.style.color = color;
    arrow.style.transform = `rotate(${angle}deg)`;
    L.marker([(start[0] + end[0]) / 2, (start[1] + end[1]) / 2], {
      icon: L.divIcon({
        className: 'delivery-map__direction',
        html: arrow,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      }),
      interactive: false,
      keyboard: false,
    }).addTo(this.routeLayer);
  }

  private createPopup(title: string, lines: readonly string[]): HTMLElement {
    const popup = document.createElement('div');
    popup.className = 'delivery-map__popup';
    const heading = document.createElement('strong');
    heading.textContent = title;
    popup.append(heading);
    for (const line of lines) {
      const paragraph = document.createElement('p');
      paragraph.textContent = line;
      popup.append(paragraph);
    }
    return popup;
  }

  private createStopPin(sequence: number, color: string, selected: boolean): SVGSVGElement {
    const ns = 'http://www.w3.org/2000/svg';
    const pin = document.createElementNS(ns, 'svg');
    pin.setAttribute('viewBox', '0 0 32 42');
    pin.setAttribute('width', '32');
    pin.setAttribute('height', '42');
    pin.classList.add('delivery-map__stop-pin');
    if (selected) pin.classList.add('delivery-map__stop-pin--selected');

    const shape = document.createElementNS(ns, 'path');
    shape.setAttribute('d', 'M16 41S2 24.6 2 16a14 14 0 1 1 28 0c0 8.6-14 25-14 25Z');
    shape.setAttribute('fill', color);
    shape.setAttribute('stroke', 'white');
    shape.setAttribute('stroke-width', '2');
    const number = document.createElementNS(ns, 'text');
    number.setAttribute('x', '16');
    number.setAttribute('y', '21');
    number.setAttribute('text-anchor', 'middle');
    number.setAttribute('fill', 'white');
    number.textContent = String(sequence);
    pin.append(shape, number);
    return pin;
  }

  private validPosition(latitude: number, longitude: number): boolean {
    return (
      Number.isFinite(latitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      Number.isFinite(longitude) &&
      longitude >= -180 &&
      longitude <= 180
    );
  }
}
