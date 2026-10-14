import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSessionUser, forgetSessionUser, peekSessionUser } from "./sessionUser";

const user = { id: 1, email: "a@b.c", name: "A", role: "user" as const };
const ok = () => new Response(JSON.stringify(user), { status: 200, headers: { "content-type": "application/json" } });

describe("shared session check", () => {
  beforeEach(() => forgetSessionUser());

  it("sends one request for callers that ask at the same time", async () => {
    const fetcher = vi.fn(async () => ok()) as unknown as typeof fetch;
    const [a, b, c] = await Promise.all([fetchSessionUser(fetcher), fetchSessionUser(fetcher), fetchSessionUser(fetcher)]);
    expect(a).toEqual(user);
    expect(b).toEqual(user);
    expect(c).toEqual(user);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reuses a fresh answer and asks again after sign-out", async () => {
    const fetcher = vi.fn(async () => ok()) as unknown as typeof fetch;
    await fetchSessionUser(fetcher);
    expect(peekSessionUser()?.user).toEqual(user);
    await fetchSessionUser(fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    forgetSessionUser();
    expect(peekSessionUser()).toBeNull();
    await fetchSessionUser(fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("treats a refused check as signed out", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
    expect(await fetchSessionUser(fetcher)).toBeNull();
  });
});
