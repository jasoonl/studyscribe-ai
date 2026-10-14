import { useEffect, useState } from "react";
import { View } from "react-native";
import { Link, useLocalSearchParams } from "expo-router";
import { MIN_AGE } from "@shared/legal";
import { AuthFrame } from "@/components/AuthFrame";
import { SocialButtons } from "@/components/SocialButtons";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Checkbox } from "@/components/ui/misc";
import { Text } from "@/components/ui/Text";
import { AuthError } from "@/lib/authApi";
import { openWebPage } from "@/lib/browser";
import { authClient, useSession } from "@/lib/SessionProvider";

/**
 * Sign-up with an invite code, as on the web: separate age and Terms
 * confirmations (both checked again by the server), then email and password,
 * Apple or Google. The invite code fills in from an invite link.
 */
export default function SignupScreen() {
  const params = useLocalSearchParams<{ invite?: string; code?: string; email?: string }>();
  const { controller } = useSession();
  const [inviteCode, setInviteCode] = useState(params.invite ?? params.code ?? "");
  const [name, setName] = useState("");
  const [email, setEmail] = useState(params.email ?? "");
  const [password, setPassword] = useState("");
  const [confirmedAge, setConfirmedAge] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteNote, setInviteNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A valid invite names its email address; fill it in.
  useEffect(() => {
    const code = inviteCode.trim();
    if (code.length < 8) {
      setInviteNote(null);
      return;
    }
    const timer = setTimeout(() => {
      authClient
        .validateInvite(code)
        .then((result) => {
          if (result.valid) {
            setInviteNote(result.email ? `This invite is for ${result.email}.` : "Invite code accepted.");
            if (result.email) setEmail((current) => current || result.email!);
          } else {
            setInviteNote(result.error ?? "That invite code is not valid.");
          }
        })
        .catch(() => setInviteNote(null));
    }, 400);
    return () => clearTimeout(timer);
  }, [inviteCode]);

  const consentMissing = !confirmedAge || !acceptedTerms ? `Confirm you are at least ${MIN_AGE} and accept the Terms first.` : null;

  async function submit() {
    if (consentMissing) {
      setError(consentMissing);
      return;
    }
    if (!name.trim() || !email.trim() || password.length < 8) {
      setError("Enter your name, email and a password of at least 8 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await controller.signIn(await authClient.signup({ email, password, name: name.trim(), inviteCode, acceptedTerms, confirmedAge }));
    } catch (caught) {
      setError(caught instanceof AuthError ? caught.message : "Sign-up failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame
      title="Create your account"
      subtitle="StudyScribe is invite only for now. Enter the code from your invite."
      footer={
        <Text variant="muted">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-primary">
            Sign in
          </Link>
        </Text>
      }
    >
      <View className="gap-4">
        <Input label="Invite code" value={inviteCode} onChangeText={setInviteCode} autoCapitalize="none" autoCorrect={false} hint={inviteNote ?? undefined} />
        <Input label="Name" value={name} onChangeText={setName} autoComplete="name" textContentType="name" />
        <Input label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="username" />
        <Input label="Password" value={password} onChangeText={setPassword} secure autoComplete="new-password" textContentType="newPassword" hint="At least 8 characters." />
        <View className="gap-1 rounded-xl border border-border bg-card px-3 py-2">
          <Checkbox checked={confirmedAge} onChange={setConfirmedAge} label={`I am at least ${MIN_AGE} years old`} />
          <Checkbox checked={acceptedTerms} onChange={setAcceptedTerms} label="I accept the Terms of Service and Privacy Policy">
            <Text variant="small">
              I accept the{" "}
              <Text variant="small" className="font-medium text-primary" accessibilityRole="link" onPress={() => openWebPage("/terms")}>
                Terms of Service
              </Text>{" "}
              and{" "}
              <Text variant="small" className="font-medium text-primary" accessibilityRole="link" onPress={() => openWebPage("/privacy")}>
                Privacy Policy
              </Text>
            </Text>
          </Checkbox>
        </View>
        {error ? (
          <Text variant="small" className="text-destructive" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <Button label="Create account" onPress={submit} loading={busy} haptic />
      </View>
      <SocialButtons
        mode={{ mode: "signup", inviteCode, acceptedTerms, confirmedAge }}
        disabledReason={consentMissing}
        onSuccess={(result) => controller.signIn(result)}
        onError={setError}
      />
    </AuthFrame>
  );
}
