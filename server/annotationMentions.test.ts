import { beforeEach, describe, expect, it, vi } from "vitest";

const audience = vi.fn<(recordingId: number, ownerId: number) => Promise<number[]>>();
const notifyUser = vi.fn();
const users = [
  { id: 1, name: "Owner Olga", email: "olga@example.com" },
  { id: 2, name: "Commenter Carl", email: "carl@example.com" },
  { id: 3, name: "Editor Eve", email: "eve@example.com" },
];

vi.mock("./recordingAccess", () => ({
  commentAudience: (recordingId: number, ownerId: number) => audience(recordingId, ownerId),
  getRecordingAccess: vi.fn(),
  requireRecordingAccess: vi.fn(),
}));
vi.mock("./collabNotifications", () => ({ notifyUser: (...args: unknown[]) => notifyUser(...args) }));
vi.mock("./db", () => ({
  getTranscriptByRecordingId: vi.fn(),
  getDb: async () => ({
    select: () => ({
      from: () => ({
        where: async () => users.filter(user => audienceIds.includes(user.id)),
      }),
    }),
  }),
}));

let audienceIds: number[] = [];

const { notifyMentions, mentionCandidates } = await import("./annotations");

const recording = { id: 10, userId: 1, title: "Cell biology" };

describe("comment mentions", () => {
  beforeEach(() => {
    notifyUser.mockReset();
    audience.mockReset();
    audienceIds = [1, 2, 3];
    audience.mockImplementation(async () => audienceIds);
  });

  it("lists everyone who can read the comments, by display name", async () => {
    expect(await mentionCandidates(recording)).toEqual([
      { id: 1, name: "Owner Olga" },
      { id: 2, name: "Commenter Carl" },
      { id: 3, name: "Editor Eve" },
    ]);
  });

  it("notifies mentioned people with a link they can open, never the author", async () => {
    const notified = await notifyMentions({ recording, body: "@Editor Eve and @Commenter Carl, see this", author: { id: 2, name: "Commenter Carl", email: "carl@example.com" } });
    expect(notified).toEqual([3]);
    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(notifyUser.mock.calls[0][0]).toBe(3);
    expect(notifyUser.mock.calls[0][1].url).toBe("/shared-with-me/10");
  });

  it("does not notify someone who cannot see comments, even if named", async () => {
    audienceIds = [1, 2];
    const notified = await notifyMentions({ recording, body: "@Editor Eve look", author: { id: 2, name: "Commenter Carl", email: "carl@example.com" } });
    expect(notified).toEqual([]);
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it("skips people who already got the general notice and links the owner to their own page", async () => {
    const skipped = await notifyMentions({ recording, body: "@Owner Olga hi", author: { id: 3, name: "Editor Eve", email: "eve@example.com" }, alreadyNotified: [1] });
    expect(skipped).toEqual([]);
    const notified = await notifyMentions({ recording, body: "@Owner Olga hi", author: { id: 3, name: "Editor Eve", email: "eve@example.com" } });
    expect(notified).toEqual([1]);
    expect(notifyUser.mock.calls[0][1].url).toBe("/recording/10");
  });
});
