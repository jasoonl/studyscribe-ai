import { describe, expect, it } from "vitest";
import { BodyCache, RangeSupportMemory, audioEtag, etagMatches } from "./audioProxyCache";

describe("etag", () => {
  it("is stable per key and differs between keys", () => {
    expect(audioEtag("a")).toBe(audioEtag("a"));
    expect(audioEtag("a")).not.toBe(audioEtag("b"));
  });
  it("matches lists, weak tags and *", () => {
    const tag = audioEtag("a");
    expect(etagMatches(`"x", ${tag}`, tag)).toBe(true);
    expect(etagMatches(`W/${tag}`, tag)).toBe(true);
    expect(etagMatches("*", tag)).toBe(true);
    expect(etagMatches('"other"', tag)).toBe(false);
    expect(etagMatches(undefined, tag)).toBe(false);
  });
});

describe("RangeSupportMemory", () => {
  it("remembers answers and evicts the oldest", () => {
    const m = new RangeSupportMemory(2);
    m.set("a", false);
    m.set("b", true);
    m.get("a");
    m.set("c", true);
    expect(m.get("b")).toBeUndefined();
    expect(m.get("a")).toBe(false);
  });
});

describe("BodyCache", () => {
  it("stays within its budget by evicting the least recently used", () => {
    const c = new BodyCache(10, 1000, () => 0);
    c.set("a", Buffer.alloc(6));
    c.set("b", Buffer.alloc(6));
    expect(c.get("a")).toBeNull();
    expect(c.get("b")).not.toBeNull();
    expect(c.bytes).toBe(6);
  });
  it("refuses an object larger than the budget", () => {
    expect(new BodyCache(10).set("a", Buffer.alloc(11))).toBe(false);
  });
  it("expires entries after the ttl", () => {
    let now = 0;
    const c = new BodyCache(100, 50, () => now);
    c.set("a", Buffer.alloc(5));
    now = 51;
    expect(c.get("a")).toBeNull();
    expect(c.bytes).toBe(0);
  });
});
