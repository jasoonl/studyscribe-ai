import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
let failWrites = false;
vi.mock("./db", () => ({
  getAppSetting: async (key: string) => (store.has(key) ? { value: store.get(key)!, updatedAt: new Date() } : null),
  incrementTransferCounter: async (key: string, served: number, fetched: number) => {
    if (failWrites) throw new Error("db down");
    const cur = JSON.parse(store.get(key) ?? '{"served":0,"fetched":0}');
    store.set(key, JSON.stringify({ served: cur.served + served, fetched: cur.fetched + fetched }));
  },
}));

const t = await import("./blobTransfer");
const GB = 1024 ** 3;

beforeEach(() => {
  store.clear();
  failWrites = false;
  t.resetTransferStateForTests();
});

describe("limits", () => {
  it("defaults to 10 GB with a soft cap at 95%", () => {
    expect(t.transferLimitBytes({})).toBe(10 * GB);
    expect(t.transferSoftCapBytes({})).toBe(Math.floor(9.5 * GB));
  });
  it("reads overrides as bytes or as a fraction", () => {
    expect(t.transferLimitBytes({ BLOB_TRANSFER_LIMIT_BYTES: "1000" } as any)).toBe(1000);
    expect(t.transferSoftCapBytes({ BLOB_TRANSFER_LIMIT_BYTES: "1000", BLOB_TRANSFER_SOFT_CAP: "0.5" } as any)).toBe(500);
    expect(t.transferSoftCapBytes({ BLOB_TRANSFER_LIMIT_BYTES: "1000", BLOB_TRANSFER_SOFT_CAP: "900" } as any)).toBe(900);
  });
  it("warns at 80% and errors at 95% of the larger direction", () => {
    expect(t.transferLevel({ served: 7 * GB, fetched: 0 })).toBe("ok");
    expect(t.transferLevel({ served: 0, fetched: 8 * GB })).toBe("warn");
    expect(t.transferLevel({ served: 9.6 * GB, fetched: 1 })).toBe("error");
  });
  it("names the month in UTC", () => {
    expect(t.transferPeriod(new Date("2026-10-31T23:59:59Z"))).toBe("2026-10");
  });
});

describe("counter", () => {
  it("batches small amounts and flushes them into the monthly setting", async () => {
    t.recordTransfer({ served: 100, fetched: 50 });
    expect(store.size).toBe(0);
    expect(await t.getTransferTotals()).toEqual({ served: 100, fetched: 50 });
    await t.flushTransfer();
    const key = t.TRANSFER_KEY_PREFIX + t.transferPeriod();
    expect(JSON.parse(store.get(key)!)).toEqual({ served: 100, fetched: 50 });
    t.recordTransfer({ served: 1 });
    await t.flushTransfer();
    expect(JSON.parse(store.get(key)!)).toEqual({ served: 101, fetched: 50 });
  });
  it("starts a background write when a response ends", async () => {
    t.recordTransfer({ served: 5 }, { flush: true });
    await vi.waitFor(() => expect(JSON.parse(store.get(t.TRANSFER_KEY_PREFIX + t.transferPeriod())!)).toEqual({ served: 5, fetched: 0 }));
  });
  it("ignores database failures and keeps the bytes for later", async () => {
    failWrites = true;
    t.recordTransfer({ served: 10 });
    await expect(t.flushTransfer()).resolves.toBeUndefined();
    expect((await t.getTransferTotals()).served).toBe(10);
  });
  it("reads garbage as zero", () => {
    expect(t.parseTotals("nope")).toEqual({ served: 0, fetched: 0 });
  });
});

describe("soft cap", () => {
  it("is reached once the month's transfer passes the cap, and only the hard limit stops owners", async () => {
    const key = t.TRANSFER_KEY_PREFIX + t.transferPeriod();
    store.set(key, JSON.stringify({ served: 1, fetched: 9.7 * GB }));
    expect(await t.isTransferSoftCapReached()).toBe(true);
    expect(await t.isTransferLimitReached()).toBe(false);
    await expect(t.assertTransferHeadroomForImport()).rejects.toThrow(/paused/);
  });
  it("is clear below the cap", async () => {
    expect(await t.isTransferSoftCapReached()).toBe(false);
    await expect(t.assertTransferHeadroomForImport()).resolves.toBeUndefined();
  });
});
