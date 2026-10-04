import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { verifyDeletionConfirmation } from "./accountRouter";

const hash = bcrypt.hashSync("correct horse battery", 4);

describe("verifyDeletionConfirmation", () => {
  it("requires the typed email to match, ignoring case and spacing", async () => {
    const user = { email: "Sam@Example.com", passwordHash: hash };
    expect((await verifyDeletionConfirmation(user, "other@example.com", "correct horse battery")).ok).toBe(false);
    expect((await verifyDeletionConfirmation(user, "  sam@example.com ", "correct horse battery")).ok).toBe(true);
  });

  it("requires the right password when the account has one", async () => {
    const user = { email: "sam@example.com", passwordHash: hash };
    expect((await verifyDeletionConfirmation(user, "sam@example.com")).ok).toBe(false);
    expect((await verifyDeletionConfirmation(user, "sam@example.com", "wrong password")).ok).toBe(false);
    expect((await verifyDeletionConfirmation(user, "sam@example.com", "correct horse battery")).ok).toBe(true);
  });

  it("lets a Google-only account confirm with the typed email alone", async () => {
    expect((await verifyDeletionConfirmation({ email: "g@example.com", passwordHash: null }, "g@example.com")).ok).toBe(true);
  });
});
