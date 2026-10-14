import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { AuthFrame } from "@/components/AuthFrame";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Text } from "@/components/ui/Text";
import { errorMessage, trpc } from "@/lib/trpc";

export default function RequestAccessScreen() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const request = trpc.customAuth.requestInvite.useMutation();

  if (request.isSuccess) {
    return (
      <AuthFrame title="Request sent" subtitle="We'll email you an invite once it's approved.">
        <Button label="Back to sign in" variant="outline" onPress={() => router.replace("/login")} />
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="Request access" subtitle="Tell us a little about how you'd use StudyScribe.">
      <View className="gap-4">
        <Input label="Name" value={name} onChangeText={setName} autoComplete="name" />
        <Input label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        <Input label="What will you record? (optional)" value={reason} onChangeText={setReason} multiline maxLength={1000} />
        {request.error ? (
          <Text variant="small" className="text-destructive" accessibilityLiveRegion="polite">
            {errorMessage(request.error, "Check your name and email and try again.")}
          </Text>
        ) : null}
        <Button
          label="Send request"
          loading={request.isPending}
          onPress={() => request.mutate({ name: name.trim(), email: email.trim(), reason: reason.trim() || undefined })}
        />
        <Button label="Back to sign in" variant="ghost" size="sm" onPress={() => router.back()} />
      </View>
    </AuthFrame>
  );
}
