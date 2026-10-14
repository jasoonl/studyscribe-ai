import { Platform } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";

/**
 * Native Google and Apple sign-in. Each returns the provider's ID token for
 * the server to verify (/api/auth/google/native, /api/auth/apple/native), or
 * null when the person cancelled.
 *
 * Google client ids come from the build's environment (eas.json):
 * EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (Android tokens are issued for it) and
 * EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID. Without them the Google button is hidden.
 */

const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "";
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || "";

export function isGoogleSignInAvailable() {
  if (Platform.OS === "web") return false;
  return Platform.OS === "ios" ? Boolean(GOOGLE_IOS_CLIENT_ID) : Boolean(GOOGLE_WEB_CLIENT_ID);
}

let configured = false;

export async function googleIdToken(): Promise<string | null> {
  const { GoogleSignin, isSuccessResponse, isErrorWithCode, statusCodes } = await import("@react-native-google-signin/google-signin");
  if (!configured) {
    GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID || undefined, iosClientId: GOOGLE_IOS_CLIENT_ID || undefined });
    configured = true;
  }
  try {
    if (Platform.OS === "android") await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    // Always show the account chooser, as the web does (prompt=select_account).
    await GoogleSignin.signOut().catch(() => undefined);
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return null;
    return response.data.idToken ?? null;
  } catch (error) {
    if (isErrorWithCode(error) && (error.code === statusCodes.SIGN_IN_CANCELLED || error.code === statusCodes.IN_PROGRESS)) return null;
    throw new Error("Google sign-in did not finish. Please try again.");
  }
}

export async function isAppleSignInAvailable() {
  if (Platform.OS !== "ios") return false;
  return AppleAuthentication.isAvailableAsync().catch(() => false);
}

/** Apple puts the SHA-256 of the nonce in the token; the server gets the raw value and checks it. */
export async function appleCredential(): Promise<{ identityToken: string; rawNonce: string; fullName: string | null } | null> {
  const rawNonce = Crypto.randomUUID() + Crypto.randomUUID();
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: hashed,
    });
    if (!credential.identityToken) throw new Error("Apple did not return a sign-in token.");
    const name = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(" ");
    return { identityToken: credential.identityToken, rawNonce, fullName: name || null };
  } catch (error) {
    if ((error as { code?: string })?.code === "ERR_REQUEST_CANCELED") return null;
    throw error instanceof Error ? error : new Error("Apple sign-in did not finish.");
  }
}
