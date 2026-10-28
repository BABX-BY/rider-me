export type MapPosition = [number, number];

export interface RoadRouteGeometry {
  positions: MapPosition[];
  /** Snapped OSRM positions in the same order as the requested waypoints. */
  waypoints: MapPosition[];
}

const cache = new Map<string, { expires: number; geometry: RoadRouteGeometry }>();
const CACHE_TTL_MS = 60 * 60 * 1000;

// OSRM keeps the requested stop order and returns the road geometry plus its
// snapped road positions, so map pins can stay on the actual customer coords.
export async function getRoadRoute(
  points: readonly (readonly [number, number, number?])[],
  signal: AbortSignal,
): Promise<RoadRouteGeometry> {
  signal.throwIfAborted();
  if (points.length < 2 || points.length > 31 || points.some(([lat, lng]) =>
    !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180,
  )) throw new Error('พิกัดเส้นทางไม่ถูกต้อง');

  const coordinates = points.map(([lat, lng]) => `${lng},${lat}`).join(';');
  const cached = cache.get(coordinates);
  if (cached && cached.expires > Date.now()) return cached.geometry;
  if (cached) cache.delete(coordinates);
  const response = await fetch(
    `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false&continue_straight=false&radiuses=${points.map(() => 100).join(';')}&generate_hints=false`,
    { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) },
  );
  if (!response.ok) throw new Error('บริการเส้นทางไม่พร้อมใช้งาน');
  const data = await response.json() as {
    code?: string;
    routes?: { geometry?: { coordinates?: number[][] } }[];
    waypoints?: { location?: number[] }[];
  };
  const geometry = data.routes?.[0]?.geometry?.coordinates;
  const waypoints = data.waypoints;
  if (data.code !== 'Ok' || !geometry || geometry.length < 2 || geometry.some((point) =>
    point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) ||
    Math.abs(point[0]!) > 180 || Math.abs(point[1]!) > 90,
  ) || !waypoints || waypoints.length !== points.length || waypoints.some((waypoint) => {
    const point = waypoint.location;
    return !point || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) ||
      Math.abs(point[0]!) > 180 || Math.abs(point[1]!) > 90;
  })) throw new Error('ไม่พบเส้นทางหรือพิกัดถนนไม่ครบทุกจุด');

  const result: RoadRouteGeometry = {
    positions: geometry.map(([lng, lat]): MapPosition => [lat!, lng!]),
    waypoints: waypoints.map((waypoint): MapPosition => {
      const point = waypoint.location!;
      return [point[1]!, point[0]!];
    }),
  };
  signal.throwIfAborted();
  if (cache.size >= 100) cache.delete(cache.keys().next().value!);
  cache.set(coordinates, { expires: Date.now() + CACHE_TTL_MS, geometry: result });
  return result;
}
