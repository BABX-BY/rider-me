import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { getRoadDistanceMatrix, parseRoadPoints, RoadMatrixError } from "./road-matrix.js";

const points = (offset = 0) => [
  { latitude: 16.244335 + offset, longitude: 103.2494546 },
  { latitude: 16.245335 + offset, longitude: 103.2504546 },
];

test("validates coordinate types, count and ranges", () => {
  for (const input of [undefined, [], points().slice(0, 1), Array.from({ length: 32 }, () => points()[0]),
    [{ latitude: "16", longitude: 103 }, points()[1]],
    [{ latitude: Number.NaN, longitude: 103 }, points()[1]],
    [{ latitude: 91, longitude: 103 }, points()[1]],
    [{ latitude: 16, longitude: -181 }, points()[1]]]) {
    assert.throws(() => parseRoadPoints(input), (error: unknown) =>
      error instanceof RoadMatrixError && error.status === 400);
  }
  assert.deepEqual(parseRoadPoints(points()), points());
});

test("converts directed metres to kilometres, restricts snapping, caches without leaking mutations", async () => {
  let url = "";
  const fetchMock = mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    url = String(input);
    return Response.json({ code: "Ok", distances: [[0, 1500], [2500, 0]] });
  });
  try {
    const matrix = await getRoadDistanceMatrix(points());
    assert.deepEqual(matrix.distancesKm, [[0, 1.5], [2.5, 0]]);
    assert.equal(matrix.distanceBasis, "road");
    assert.ok(url.startsWith("https://router.project-osrm.org/table/v1/driving/103.2494546,16.244335;"));
    assert.ok(url.includes("annotations=distance&radiuses=100;100"));
    assert.ok(!url.includes("fallback_speed"));
    matrix.distancesKm[0]![1] = 999;
    matrix.points[0]!.latitude = 0;
    const cached = await getRoadDistanceMatrix(points());
    assert.equal(cached.distancesKm[0]![1], 1.5);
    assert.deepEqual(cached.points, points());
    assert.equal(fetchMock.mock.callCount(), 1);
  } finally { fetchMock.mock.restore(); }
});

test("rejects failed, incomplete, unreachable and invalid provider data without caching a fallback", async () => {
  const responses: unknown[] = [
    { code: "NoRoute" },
    { code: "Ok", distances: [[0, null], [2000, 0]] },
    { code: "Ok", distances: [[0, -1], [2000, 0]] },
    { code: "Ok", distances: [[0, 1000]] },
    { code: "Ok", distances: [[0], [2000, 0]] },
  ];
  const fetchMock = mock.method(globalThis, "fetch", async () => Response.json(responses.shift()));
  try {
    for (let index = 0; index < 5; index += 1) {
      await assert.rejects(getRoadDistanceMatrix(points(0.01)), (error: unknown) =>
        error instanceof RoadMatrixError && error.status === 503);
    }
    assert.equal(fetchMock.mock.callCount(), 5);
  } finally { fetchMock.mock.restore(); }
});

test("surfaces HTTP failures and timeouts as retryable 503 errors", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => new Response("failed", { status: 429 }));
  try {
    await assert.rejects(getRoadDistanceMatrix(points(0.02)), RoadMatrixError);
    fetchMock.mock.mockImplementation(async () => { throw new DOMException("timeout", "TimeoutError"); });
    await assert.rejects(getRoadDistanceMatrix(points(0.02)), (error: unknown) =>
      error instanceof RoadMatrixError && error.status === 503);
  } finally { fetchMock.mock.restore(); }
});
