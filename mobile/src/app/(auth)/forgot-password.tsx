import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { AuthFrame } from "@/components/AuthFrame";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Text } from "@/components/ui/Text";
import { AuthError } from "@/lib/authApi";
import { authClient } from "@/lib/SessionProvider";

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email.trim()) {
      setError("Enter the email you signed up with.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await authClient.forgotPassword(email);
      setSent(result.message);
    } catch (caught) {
      setError(caught instanceof AuthError ? caught.message : "Could not send the link. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame title="Reset your password" subtitle="We'll email you a link to choose a new password.">
      {sent ? (
        <View className="gap-4">
          <View className="rounded-xl border border-border bg-card p-4">
            <Text variant="body">{sent}</Text>
            <Text variant="muted" className="mt-2">
              Open the link on this phone to set a new password in the app.
            </Text>
          </View>
          <Button label="Back to sign in" variant="outline" onPress={() => router.replace("/login")} />
        </View>
      ) : (
        <View className="gap-4">
          <Input label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" returnKeyType="send" onSubmitEditing={submit} />
          {error ? (
            <Text variant="small" className="text-destructive" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <Button label="Send reset link" onPress={submit} loading={busy} />
          <Button label="Back to sign in" variant="ghost" size="sm" onPress={() => router.back()} />
        </View>
      )}
    </AuthFrame>
  );
}
