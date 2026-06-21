import { OAuth2Client } from "google-auth-library";
import { getDb } from "./db";
import { users } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/auth/google/callback";

const client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI);

export interface GoogleUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeGoogleCode(code: string): Promise<{ tokens: any; user: GoogleUser }> {
  try {
    const { tokens } = await client.getToken(code);
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token!,
      audience: GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload) {
      throw new Error("Failed to get Google user payload");
    }

    const user: GoogleUser = {
      id: payload.sub,
      email: payload.email || "",
      name: payload.name || "",
      picture: payload.picture,
    };

    return { tokens, user };
  } catch (error) {
    throw new Error(`Failed to exchange Google code: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get or create user from Google OAuth
 */
export async function getOrCreateGoogleUser(googleUser: GoogleUser) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  // Check if user exists by googleId
  const existingUser = await db.select().from(users).where(eq(users.googleId, googleUser.id)).limit(1);

  if (existingUser.length > 0) {
    return existingUser[0];
  }

  // Check if user exists by email
  const userByEmail = await db.select().from(users).where(eq(users.email, googleUser.email)).limit(1);

  if (userByEmail.length > 0) {
    // Update existing user with Google ID
    await db
      .update(users)
      .set({
        googleId: googleUser.id,
        loginMethod: "google",
        emailVerified: 1,
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      })
      .where(eq(users.id, userByEmail[0].id));

    return userByEmail[0];
  }

  // Create new user
  await db.insert(users).values({
    email: googleUser.email,
    name: googleUser.name,
    googleId: googleUser.id,
    loginMethod: "google",
    emailVerified: 1,
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  });

  // Fetch the created user
  const newUser = await db.select().from(users).where(eq(users.email, googleUser.email)).limit(1);
  return newUser[0];
}

/**
 * Generate Google OAuth URL
 */
export function getGoogleAuthUrl(state: string): string {
  const scopes = ["openid", "email", "profile"];

  const url = client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    state,
  });

  return url;
}
