import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRoadRoute } from './road-route';

afterEach(() => vi.unstubAllGlobals());

describe('road geometry lookup', () => {
  it('keeps outbound waypoint order, converts road geometry and snapped points, and caches the result', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 'Ok', routes: [
      { geometry: { coordinates: [[103, 16], [103.005, 16.002], [103.01, 16.01]] } },
    ], waypoints: [
      { location: [103.0001, 16.0001] },
      { location: [103.0101, 16.0101] },
      { location: [103.0201, 16.0201] },
    ] }) });
    vi.stubGlobal('fetch', fetcher);
    const points: [number, number][] = [[16, 103], [16.01, 103.01], [16.02, 103.02]];
    const signal = new AbortController().signal;
    const route = await getRoadRoute(points, signal);
    expect(fetcher.mock.calls[0][0]).toContain('/103,16;103.01,16.01;103.02,16.02?');
    expect(fetcher.mock.calls[0][0]).not.toContain(';103,16?');
    expect(route.positions).toEqual([[16, 103], [16.002, 103.005], [16.01, 103.01]]);
    expect(route.waypoints).toEqual([[16.0001, 103.0001], [16.0101, 103.0101], [16.0201, 103.0201]]);
    expect(await getRoadRoute(points, signal)).toBe(route);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    { code: 'NoRoute', routes: [] },
    { code: 'Ok', routes: [{ geometry: { coordinates: [[103, 16]] } }], waypoints: [{ location: [103, 16] }, { location: [104, 17] }] },
    { code: 'Ok', routes: [{ geometry: { coordinates: [[103, 16], [200, 100]] } }], waypoints: [{ location: [103, 16] }, { location: [104, 17] }] },
    { code: 'Ok', routes: [{ geometry: { coordinates: [[103, 16], [104, 17]] } }], waypoints: [{ location: [103, 16] }] },
  ])('rejects missing or invalid geometry so the map can show a labeled fallback', async (payload) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => payload }));
    await expect(getRoadRoute([[17, 104], [17.01, 104.01], [17, 104]], new AbortController().signal)).rejects.toThrow();
  });

  it('rejects service failures without caching a straight line as a road route', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', fetcher);
    await expect(getRoadRoute([[18, 105], [18.01, 105.01], [18, 105]], new AbortController().signal)).rejects.toThrow();
  });

  it('stops an obsolete request before sending it', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const request = new AbortController();
    request.abort();
    await expect(getRoadRoute([[16, 103], [16.01, 103.01]], request.signal)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
