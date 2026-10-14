import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import Svg, { Path } from "react-native-svg";
import { OrDivider } from "@/components/AuthFrame";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/theme/tokens";
import { AuthError, type AuthSuccess } from "@/lib/authApi";
import { authClient } from "@/lib/SessionProvider";
import { appleCredential, googleIdToken, isAppleSignInAvailable, isGoogleSignInAvailable } from "@/lib/socialAuth";

type Mode = { mode: "login" } | { mode: "signup"; inviteCode: string; acceptedTerms: boolean; confirmedAge: boolean };

function GoogleMark() {
  return (
    <Svg width={18} height={18} viewBox="0 0 48 48" accessibilityElementsHidden>
      <Path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <Path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <Path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <Path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </Svg>
  );
}

/**
 * Continue with Apple (iOS, required by App Store guideline 4.8 because Google
 * is offered) and Continue with Google. On sign-up both carry the invite and
 * the age and Terms confirmations, which the server checks again.
 */
export function SocialButtons({ mode, onSuccess, onError, disabledReason }: { mode: Mode; onSuccess: (result: AuthSuccess) => void; onError: (message: string) => void; disabledReason?: string | null }) {
  const theme = useTheme();
  const [apple, setApple] = useState(false);
  const [busy, setBusy] = useState<"apple" | "google" | null>(null);
  const google = isGoogleSignInAvailable();

  useEffect(() => {
    isAppleSignInAvailable().then(setApple);
  }, []);

  if (!apple && !google) return null;

  const extra = mode.mode === "signup" ? { inviteCode: mode.inviteCode || undefined, acceptedTerms: mode.acceptedTerms, confirmedAge: mode.confirmedAge } : {};

  async function run(provider: "apple" | "google") {
    if (disabledReason) {
      onError(disabledReason);
      return;
    }
    setBusy(provider);
    try {
      if (provider === "apple") {
        const credential = await appleCredential();
        if (!credential) return;
        onSuccess(await authClient.apple({ ...credential, mode: mode.mode, ...extra }));
      } else {
        const idToken = await googleIdToken();
        if (!idToken) return;
        onSuccess(await authClient.google({ idToken, mode: mode.mode, ...extra }));
      }
    } catch (error) {
      onError(error instanceof AuthError || error instanceof Error ? error.message : "Sign-in failed. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <View className="gap-3">
      <View className="pb-3">
        <OrDivider />
      </View>
      {apple && Platform.OS === "ios" ? (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={mode.mode === "signup" ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP : AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={theme.scheme === "dark" ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={16}
          style={{ height: 50, opacity: busy === "apple" ? 0.6 : 1 }}
          onPress={() => run("apple")}
        />
      ) : null}
      {google ? (
        <Button
          label={mode.mode === "signup" ? "Sign up with Google" : "Continue with Google"}
          variant="outline"
          loading={busy === "google"}
          icon={<GoogleMark />}
          onPress={() => run("google")}
        />
      ) : null}
    </View>
  );
}
