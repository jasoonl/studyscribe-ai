import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
import { getPushToken } from "@/lib/push";
import { useSession, useUser } from "@/lib/SessionProvider";
import { errorMessage, trpc } from "@/lib/trpc";

/**
 * Account deletion inside the app (App Store guideline 5.1.1(v), Google Play's
 * account deletion requirement). Same procedure and confirmations as the web.
 */
export default function DeleteAccountScreen() {
  const user = useUser();
  const { controller } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const remove = trpc.account.deleteAccount.useMutation({
    onSuccess: () => controller.signOut(getPushToken()),
  });
  const matches = email.trim().toLowerCase() === user.email.toLowerCase();

  return (
    <Screen edges={["bottom"]}>
      <Card className="gap-2 border-destructive/30 bg-destructive/5">
        <Text variant="subheading">This can't be undone</Text>
        <Text variant="small">
          Deleting your account permanently removes your recordings and their audio, transcripts, notes, flashcards, quizzes, guides, courses and tasks, and cancels any subscription. Shared links stop working.
        </Text>
      </Card>
      <Input label={`Type your email (${user.email}) to confirm`} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
      <Input label="Password" hint="Leave empty if you sign in with Google or Apple." value={password} onChangeText={setPassword} secure autoComplete="current-password" />
      {remove.error ? (
        <Text variant="small" className="text-destructive" accessibilityLiveRegion="polite">
          {errorMessage(remove.error)}
        </Text>
      ) : null}
      <Button label="Delete my account" variant="destructive" disabled={!matches} loading={remove.isPending} onPress={() => remove.mutate({ confirmEmail: email.trim(), password: password || undefined })} />
    </Screen>
  );
}
