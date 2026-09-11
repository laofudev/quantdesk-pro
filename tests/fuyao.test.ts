/**
 * 扶摇 provider 信封解析 / 错误处理单测（mock fetch，无真实网络）
 * 覆盖：code=0 信封解析、业务码非 0 返回 null、429/4001 退避重试、网络异常降级、缺 key 降级。
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { fyGet, normalizeThscode, msToDate, getFuyaoKline } from "../lib/providers/fuyao";

type FetchImpl = typeof fetch;

let originalFetch: FetchImpl;
let calls: { url: string; headers: Record<string, string> }[];

function mockFetch(impl: (url: string) => Promise<{ status: number; body: unknown }>) {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const { status, body } = await impl(url);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as FetchImpl;
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  process.env.FUYAO_API_KEY = "test-key";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("fyGet 解析 code=0 信封并携带 X-api-key 头", async () => {
  mockFetch(async () => ({ status: 200, body: { code: 0, message: "success", request_id: "r1", data: { total: 1, item: [{ thscode: "000001.SZ" }] } } }));
  const data = await fyGet<{ total: number; item: { thscode: string }[] }>("/api/a-share/prices/snapshot", { limit: 1 });
  assert.equal(data?.total, 1);
  assert.equal(data?.item[0].thscode, "000001.SZ");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers["X-api-key"], "test-key");
  assert.match(calls[0].url, /^https:\/\/fuyao\.aicubes\.cn\/api\/a-share\/prices\/snapshot\?limit=1/);
});

test("fyGet 业务码非 0（如 2001 未认证）返回 null 且不重试", async () => {
  mockFetch(async () => ({ status: 200, body: { code: 2001, message: "unauthorized", data: null } }));
  const data = await fyGet("/api/a-share/prices/snapshot");
  assert.equal(data, null);
  assert.equal(calls.length, 1);
});

test("fyGet 信封 code=429 退避重试后成功", async () => {
  let n = 0;
  mockFetch(async () => {
    n += 1;
    if (n === 1) return { status: 200, body: { code: 429, message: "request limit exceeded", data: null } };
    return { status: 200, body: { code: 0, data: { total: 5, item: [] } } };
  });
  const data = await fyGet<{ total: number }>("/api/a-share/special-data/limit-down-pool", { page: 1, size: 1 });
  assert.equal(data?.total, 5);
  assert.equal(calls.length, 2);
});

test("fyGet HTTP 429 持续限流：最多重试 2 次后返回 null", async () => {
  mockFetch(async () => ({ status: 429, body: { code: 429, message: "request limit exceeded", data: null } }));
  const data = await fyGet("/api/a-share/prices/snapshot");
  assert.equal(data, null);
  assert.equal(calls.length, 3); // 首次 + 2 次退避重试
});

test("fyGet 信封 code=4001 按限流退避重试", async () => {
  let n = 0;
  mockFetch(async () => {
    n += 1;
    if (n <= 2) return { status: 200, body: { code: 4001, message: "rate limited", data: null } };
    return { status: 200, body: { code: 0, data: { item: [1, 2, 3] } } };
  });
  const data = await fyGet<{ item: number[] }>("/api/a-share/special-data/hot-stock-list");
  assert.deepEqual(data?.item, [1, 2, 3]);
  assert.equal(calls.length, 3);
});

test("fyGet 网络异常返回 null（不抛出）", async () => {
  globalThis.fetch = (async () => {
    throw new Error("ECONNREFUSED");
  }) as FetchImpl;
  const data = await fyGet("/api/a-share/prices/snapshot");
  assert.equal(data, null);
});

test("fyGet 缺少 FUYAO_API_KEY 时直接返回 null 且不发请求", async () => {
  delete process.env.FUYAO_API_KEY;
  mockFetch(async () => ({ status: 200, body: { code: 0, data: {} } }));
  const data = await fyGet("/api/a-share/prices/snapshot");
  assert.equal(data, null);
  assert.equal(calls.length, 0);
});

test("normalizeThscode 补全交易所后缀", () => {
  assert.equal(normalizeThscode("600519"), "600519.SH");
  assert.equal(normalizeThscode("000001"), "000001.SZ");
  assert.equal(normalizeThscode("300750"), "300750.SZ");
  assert.equal(normalizeThscode("830799"), "830799.BJ");
  assert.equal(normalizeThscode("600519.sh"), "600519.SH");
});

test("msToDate 按 Asia/Shanghai 转换毫秒时间戳", () => {
  // 1786032000000 = 2026-08-06T16:00:00Z = 北京时间 2026-08-07 00:00
  assert.equal(msToDate(1786032000000), "2026-08-07");
});

test("getFuyaoKline 解析 date_ms/OHLC 并按日期升序", async () => {
  mockFetch(async () => ({
    status: 200,
    body: {
      code: 0,
      data: {
        timestamp: 1788969600000,
        item: [
          { date_ms: 1786377600000, open_price: 11.31, high_price: 11.4, low_price: 11.26, close_price: 11.26, volume: 100, turnover: 2000 },
          { date_ms: 1786032000000, open_price: 11.23, high_price: 11.26, low_price: 11.1, close_price: 11.19, volume: 90, turnover: 1000 },
        ],
      },
    },
  }));
  const bars = await getFuyaoKline("000001.SZ", 10);
  assert.ok(bars);
  assert.equal(bars.length, 2);
  assert.equal(bars[0].date, "2026-08-07"); // 升序：较早日期在前
  assert.equal(bars[1].date, "2026-08-11");
  assert.equal(bars[0].close, 11.19);
  assert.equal(bars[1].amount, 2000);
  // 请求参数包含前复权与日线 interval
  assert.match(calls[0].url, /adjust=forward/);
  assert.match(calls[0].url, /interval=1d/);
});

test("getFuyaoKline 信封 code 非 0 时返回 null", async () => {
  mockFetch(async () => ({ status: 200, body: { code: 2003, message: "forbidden", data: null } }));
  const bars = await getFuyaoKline("000001.SZ");
  assert.equal(bars, null);
});
