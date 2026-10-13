import { useRef, useState } from "react";
import { TextInput, View } from "react-native";
import { Link, router } from "expo-router";
import { AuthFrame } from "@/components/AuthFrame";
import { SocialButtons } from "@/components/SocialButtons";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Text } from "@/components/ui/Text";
import { AuthError } from "@/lib/authApi";
import { authClient, useSession } from "@/lib/SessionProvider";

export default function LoginScreen() {
  const { state, controller } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(state.status === "signedOut" ? (state.reason ?? null) : null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  async function submit() {
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await controller.signIn(await authClient.login(email, password));
    } catch (caught) {
      setError(caught instanceof AuthError ? caught.message : "Sign-in failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame
      title="Welcome back"
      subtitle="Sign in to your StudyScribe library."
      footer={
        <>
          <Text variant="muted">
            Have an invite?{" "}
            <Link href="/signup" className="font-medium text-primary">
              Create an account
            </Link>
          </Text>
          <Link href="/request-access" className="py-2 font-medium text-[14px] text-primary">
            Request access
          </Link>
        </>
      }
    >
      <View className="gap-4">
        <Input
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="username"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          placeholder="you@school.edu"
        />
        <Input
          ref={passwordRef}
          label="Password"
          value={password}
          onChangeText={setPassword}
          secure
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        {error ? (
          <Text variant="small" className="text-destructive" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <Button label="Sign in" onPress={submit} loading={busy} haptic />
        <Button label="Forgot password?" variant="ghost" size="sm" onPress={() => router.push("/forgot-password")} />
      </View>
      <SocialButtons mode={{ mode: "login" }} onSuccess={(result) => controller.signIn(result)} onError={setError} />
    </AuthFrame>
  );
}
