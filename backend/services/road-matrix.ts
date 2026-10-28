export interface RoadCoordinate {
  latitude: number;
  longitude: number;
}

export interface RoadDistanceMatrix {
  points: RoadCoordinate[];
  distancesKm: number[][];
  distanceBasis: "road";
}

export class RoadMatrixError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

const cache = new Map<string, { expires: number; matrix: RoadDistanceMatrix }>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const unavailable = () => new RoadMatrixError(503,
  "โหลดระยะทางตามถนนไม่สำเร็จ กรุณาลองคำนวณใหม่ ระบบยังไม่บันทึกใบงาน");

export function parseRoadPoints(value: unknown): RoadCoordinate[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 31) {
    throw new RoadMatrixError(400, "ระยะทางตามถนนรองรับร้านและจุดส่ง 1–30 จุด");
  }
  return value.map((point: unknown) => {
    if (!point || typeof point !== "object" || Array.isArray(point)) {
      throw new RoadMatrixError(400, "พิกัดสำหรับคำนวณถนนไม่ถูกต้อง");
    }
    const { latitude, longitude } = point as Record<string, unknown>;
    if (typeof latitude !== "number" || typeof longitude !== "number" ||
        !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      throw new RoadMatrixError(400, "พิกัดสำหรับคำนวณถนนไม่ถูกต้อง");
    }
    return { latitude, longitude };
  });
}

// Keep both directions: one-way streets can make A→B different from B→A.
// OSRM returns distances along its fastest driving paths, not straight-line distances.
export async function getRoadDistanceMatrix(input: readonly RoadCoordinate[]): Promise<RoadDistanceMatrix> {
  const points = parseRoadPoints(input);
  const key = JSON.stringify(points);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return structuredClone(cached.matrix);
  if (cached) cache.delete(key);
  try {
    const coordinates = points.map((point) => `${point.longitude},${point.latitude}`).join(";");
    const radiuses = points.map(() => "100").join(";");
    const response = await fetch(
      `https://router.project-osrm.org/table/v1/driving/${coordinates}?annotations=distance&radiuses=${radiuses}&generate_hints=false`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!response.ok) throw unavailable();
    const data: unknown = await response.json();
    const result = data as { code?: unknown; distances?: unknown } | null;
    if (!result || result.code !== "Ok" || !Array.isArray(result.distances) ||
        result.distances.length !== points.length) throw unavailable();
    const distancesKm = result.distances.map((row: unknown) => {
      if (!Array.isArray(row) || row.length !== points.length ||
          row.some((distance: unknown) => typeof distance !== "number" ||
            !Number.isFinite(distance) || distance < 0)) throw unavailable();
      return (row as number[]).map((distance) => distance / 1000);
    });
    const matrix: RoadDistanceMatrix = { points, distancesKm, distanceBasis: "road" };
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: Date.now() + CACHE_TTL_MS, matrix: structuredClone(matrix) });
    return matrix;
  } catch (error) {
    if (error instanceof RoadMatrixError) throw error;
    throw unavailable();
  }
}
