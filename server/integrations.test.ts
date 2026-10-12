import { describe, expect, it } from "vitest";
import { GOOGLE_DRIVE_SCOPE, buildAuthorizeUrl, buildMultipartUpload, createOAuthState, endpoint, googleDriveCredentials, notionCredentials, readOAuthState } from "./integrations";
import { markdownToHtml, markdownToNotionBlocks, parseInline } from "./markdownExport";

describe("integration config", () => {
  it("is off until both client id and secret are set", () => {
    expect(notionCredentials({ NOTION_CLIENT_ID: "id" } as any)).toBeNull();
    expect(notionCredentials({ NOTION_CLIENT_ID: "id", NOTION_CLIENT_SECRET: "s" } as any)).toEqual({ clientId: "id", clientSecret: "s" });
  });

  it("reuses the Google sign-in client unless a Drive-specific one is set", () => {
    expect(googleDriveCredentials({ GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "gs" } as any)).toEqual({ clientId: "g", clientSecret: "gs" });
    expect(googleDriveCredentials({ GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "gs", GOOGLE_DRIVE_CLIENT_ID: "d", GOOGLE_DRIVE_CLIENT_SECRET: "ds" } as any)).toEqual({ clientId: "d", clientSecret: "ds" });
  });

  it("never lets the test override redirect production traffic", () => {
    expect(endpoint("google-token", { INTEGRATIONS_TEST_BASE_URL: "http://localhost:9" } as any)).toBe("http://localhost:9/google-token");
    expect(endpoint("google-token", { NODE_ENV: "production", INTEGRATIONS_TEST_BASE_URL: "http://localhost:9" } as any)).toBe("https://oauth2.googleapis.com/token");
  });
});

describe("OAuth state", () => {
  it("round-trips signed state and rejects tampering", () => {
    const state = createOAuthState({ userId: 4, provider: "notion", origin: "http://localhost:3000", nonce: "n1" });
    expect(readOAuthState(state)).toMatchObject({ userId: 4, provider: "notion", nonce: "n1" });
    expect(readOAuthState(`${state.slice(0, -2)}xx`)).toBeNull();
    expect(readOAuthState("nonsense")).toBeNull();
  });

  it("asks Google for drive.file only, offline, with consent", () => {
    const url = new URL(buildAuthorizeUrl("google_drive", "client", "https://app.example", "st"));
    expect(url.searchParams.get("scope")).toBe(GOOGLE_DRIVE_SCOPE);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example/api/integrations/google/callback");
    expect(url.searchParams.get("state")).toBe("st");
  });

  it("sends Notion users through the public-integration flow", () => {
    const url = new URL(buildAuthorizeUrl("notion", "nid", "https://app.example", "st"));
    expect(url.searchParams.get("owner")).toBe("user");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example/api/integrations/notion/callback");
  });
});

describe("Markdown export", () => {
  const markdown = ["# Cell biology", "", "Intro with **bold**, *italic* and `code`.", "", "## Key ideas", "- First", "- Second [link](https://example.com)", "1. Step one", "> A quote", "---", "```", "x = 1", "```"].join("\n");

  it("parses inline styles", () => {
    expect(parseInline("a **b** *c* `d` [e](https://x.y)")).toEqual([
      { text: "a " },
      { text: "b", bold: true },
      { text: " " },
      { text: "c", italic: true },
      { text: " " },
      { text: "d", code: true },
      { text: " " },
      { text: "e", link: "https://x.y" },
    ]);
  });

  it("builds Notion blocks for each structure", () => {
    const blocks = markdownToNotionBlocks(markdown);
    expect(blocks.map(block => block.type)).toEqual(["heading_1", "paragraph", "heading_2", "bulleted_list_item", "bulleted_list_item", "numbered_list_item", "quote", "divider", "code"]);
    expect(blocks[1].paragraph.rich_text[1]).toMatchObject({ text: { content: "bold" }, annotations: { bold: true } });
    expect(blocks[4].bulleted_list_item.rich_text[1].text.link).toEqual({ url: "https://example.com" });
  });

  it("splits text over Notion's 2,000-character limit", () => {
    const [block] = markdownToNotionBlocks("x".repeat(4500));
    expect(block.paragraph.rich_text.map((run: any) => run.text.content.length)).toEqual([2000, 2000, 500]);
  });

  it("builds escaped HTML for Google Docs", () => {
    const html = markdownToHtml(`${markdown}\n\n<script>alert(1)</script>`, "Notes & more");
    expect(html).toContain("<h1>Cell biology</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<ul>\n<li>First</li>");
    expect(html).toContain("<title>Notes &amp; more</title>");
    expect(html).not.toContain("<script>");
  });

  it("builds a multipart upload body", () => {
    const body = buildMultipartUpload({ name: "Doc" }, "<p>x</p>", "b");
    expect(body).toBe('--b\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"name":"Doc"}\r\n--b\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n<p>x</p>\r\n--b--\r\n');
  });
});
