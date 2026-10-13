import { useState } from "react";
import { Share, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { X } from "lucide-react-native";
import { Button, IconButton } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Segmented } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { WEB_URL } from "@/lib/config";
import { errorMessage, trpc } from "@/lib/trpc";
import { useTheme } from "@/theme/tokens";

type Role = "view" | "comment" | "edit";
const ROLE_LABELS: Record<Role, string> = { view: "Can view", comment: "Can comment", edit: "Can edit" };

/** Public link (shared through the system share sheet) and sharing with people by email, with roles. */
export function ShareSheet({ recordingId, title, open, onClose }: { recordingId: number; title: string; open: boolean; onClose: () => void }) {
  const theme = useTheme();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("view");
  const state = trpc.sharing.getShareState.useQuery({ recordingId }, { enabled: open });
  const refresh = () => utils.sharing.getShareState.invalidate({ recordingId });
  const enable = trpc.sharing.enablePublicLink.useMutation({ onSuccess: refresh, onError: (error) => toast.show(errorMessage(error), "error") });
  const disable = trpc.sharing.disablePublicLink.useMutation({ onSuccess: refresh });
  const invite = trpc.sharing.shareWithUser.useMutation({
    onSuccess: () => {
      setEmail("");
      refresh();
      toast.show("Shared.", "success");
    },
    onError: (error) => toast.show(errorMessage(error), "error"),
  });
  const unshare = trpc.sharing.unshareWithUser.useMutation({ onSuccess: refresh });

  const token = state.data?.publicShareToken ?? null;
  const link = token ? `${WEB_URL}/shared/${token}` : null;

  return (
    <Sheet open={open} onClose={onClose} title="Share recording" description="People with the link can read the transcript and notes and play the audio without an account.">
      <View className="gap-3 rounded-xl border border-border bg-card p-4">
        <Text variant="subheading">Public link</Text>
        {link ? (
          <>
            <Text variant="small" selectable numberOfLines={2}>
              {link}
            </Text>
            <View className="flex-row gap-2">
              <Button className="flex-1" label="Share link" size="sm" onPress={() => Share.share({ title, message: `${title}\n${link}`, url: link })} />
              <Button className="flex-1" label="Copy" size="sm" variant="outline" onPress={() => Clipboard.setStringAsync(link).then(() => toast.show("Link copied.", "success"))} />
            </View>
            <Button label="Turn off the link" size="sm" variant="ghost" loading={disable.isPending} onPress={() => disable.mutate({ recordingId })} />
          </>
        ) : (
          <Button label="Create a public link" size="sm" variant="outline" loading={enable.isPending} onPress={() => enable.mutate({ recordingId })} />
        )}
      </View>

      <View className="gap-3 rounded-xl border border-border bg-card p-4">
        <Text variant="subheading">Share with people</Text>
        <Input label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="classmate@school.edu" />
        <Segmented label="Access" value={role} onChange={setRole} options={(Object.keys(ROLE_LABELS) as Role[]).map((value) => ({ value, label: ROLE_LABELS[value] }))} />
        <Button label="Share" size="sm" loading={invite.isPending} disabled={!email.includes("@")} onPress={() => invite.mutate({ recordingId, email: email.trim(), role })} />
        {(state.data?.shares ?? []).map((share) => (
          <View key={share.id} className="flex-row items-center gap-2 border-t border-border pt-2">
            <View className="flex-1">
              <Text variant="small">{share.sharedWithEmail}</Text>
              <Text variant="caption">{ROLE_LABELS[(share.role as Role) ?? "view"]}</Text>
            </View>
            <IconButton label={`Stop sharing with ${share.sharedWithEmail}`} onPress={() => unshare.mutate({ recordingId, sharedWithUserId: share.sharedWithUserId })} icon={<X size={18} color={theme.mutedForeground} />} />
          </View>
        ))}
      </View>
    </Sheet>
  );
}
