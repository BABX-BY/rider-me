export type MapPosition = [number, number];
const cache = new Map<string, MapPosition[]>();

// OSRM รักษาลำดับจุดส่งที่เลือกไว้ ขอเส้นทางร้าน -> ลูกค้า -> ร้านเท่านั้น
export async function getRoadRoute(points: readonly (readonly [number, number, number?])[], signal: AbortSignal): Promise<MapPosition[]> {
  signal.throwIfAborted();
  const coordinates = points.map(([lat, lng]) => `${lng},${lat}`).join(';');
  const cached = cache.get(coordinates);
  if (cached) return cached;
  const response = await fetch(
    `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`,
    { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) },
  );
  if (!response.ok) throw new Error('บริการเส้นทางไม่พร้อมใช้งาน');
  const data = await response.json() as {
    code?: string; routes?: { geometry?: { coordinates?: number[][] } }[];
  };
  const geometry = data.routes?.[0]?.geometry?.coordinates;
  if (data.code !== 'Ok' || !geometry || geometry.length < 2 || geometry.some((point) =>
    point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) ||
    Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90,
  )) throw new Error('ไม่พบเส้นทางตามถนน');
  const positions = geometry.map(([lng, lat]): MapPosition => [lat, lng]);
  if (!signal.aborted) {
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(coordinates, positions);
  }
  return positions;
}
