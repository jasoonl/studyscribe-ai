import { useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { AuthFrame } from "@/components/AuthFrame";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Text } from "@/components/ui/Text";
import { apiUrl } from "@/lib/config";

/** Opened from the reset email's link (a universal / app link to /reset-password?token=…). */
export default function ResetPasswordScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(token ? null : "This reset link is incomplete. Ask for a new one.");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirm) return setError("The passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(apiUrl("/api/auth/reset-password"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not reset the password.");
      setDone(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not reset the password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame title="Choose a new password">
      {done ? (
        <View className="gap-4">
          <Text variant="body" className="text-center">
            Your password has been changed.
          </Text>
          <Button label="Sign in" onPress={() => router.replace("/login")} />
        </View>
      ) : (
        <View className="gap-4">
          <Input label="New password" value={password} onChangeText={setPassword} secure autoComplete="new-password" textContentType="newPassword" />
          <Input label="Confirm password" value={confirm} onChangeText={setConfirm} secure autoComplete="new-password" textContentType="newPassword" onSubmitEditing={submit} />
          {error ? (
            <Text variant="small" className="text-destructive" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <Button label="Save password" onPress={submit} loading={busy} disabled={!token} />
        </View>
      )}
    </AuthFrame>
  );
}
