import { useState } from "react";
import { Pressable, View } from "react-native";
import { Plus, Trash2 } from "lucide-react-native";
import { ACTION_ITEM_KIND_LABELS, describeDueDate, localIsoDate, type ActionItemKind } from "@shared/actionItems";
import { Button, IconButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Checkbox, EmptyState, SkeletonList } from "@/components/ui/misc";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { usePlayer } from "@/components/AudioPlayer";
import { formatTimestamp } from "@/lib/format";
import { errorMessage, trpc } from "@/lib/trpc";
import { useTheme } from "@/theme/tokens";

export type ActionItemRow = {
  id: number;
  recordingId: number;
  text: string;
  kind: ActionItemKind;
  dueDate: string | null;
  dueText?: string | null;
  atSeconds?: number | null;
  done: boolean | number;
  source?: string;
};

export function ActionItemLine({ item, onToggle, onRemove, onOpen, subtitle }: { item: ActionItemRow; onToggle: (done: boolean) => void; onRemove?: () => void; onOpen?: () => void; subtitle?: string }) {
  const theme = useTheme();
  const done = Boolean(item.done);
  const today = localIsoDate(new Date());
  const due = item.dueDate ? describeDueDate(item.dueDate, today) : item.dueText ?? null;
  const meta = [ACTION_ITEM_KIND_LABELS[item.kind] ?? "Task", due, subtitle].filter(Boolean).join(" · ");
  return (
    <View className="flex-row items-start gap-2">
      <View className="flex-1">
        <Checkbox checked={done} onChange={onToggle} label={`${item.text}. ${meta}`}>
          <Text variant="body" className={done ? "text-muted-foreground line-through" : undefined}>
            {item.text}
          </Text>
          <Text variant="caption">{meta}</Text>
        </Checkbox>
        {onOpen ? (
          <Pressable accessibilityRole="link" onPress={onOpen} className="ml-[34px] py-1">
            <Text variant="caption" className="text-primary">
              {typeof item.atSeconds === "number" ? `Mentioned at ${formatTimestamp(item.atSeconds)}` : "Open recording"}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {onRemove ? <IconButton label={`Delete ${item.text}`} onPress={onRemove} icon={<Trash2 size={18} color={theme.mutedForeground} />} /> : null}
    </View>
  );
}

/** "Find tasks": homework, readings, exams and to-dos said in the recording, with due dates. */
export function TasksPanel({ recordingId }: { recordingId: number }) {
  const theme = useTheme();
  const toast = useToast();
  const player = usePlayer();
  const utils = trpc.useUtils();
  const [text, setText] = useState("");
  const items = trpc.actionItems.list.useQuery({ recordingId });
  const invalidate = () => {
    utils.actionItems.list.invalidate({ recordingId });
    utils.actionItems.listAll.invalidate();
  };
  const extract = trpc.actionItems.extract.useMutation({ onSuccess: invalidate, onError: (error) => toast.show(errorMessage(error), "error") });
  const update = trpc.actionItems.update.useMutation({ onSuccess: invalidate, onError: (error) => toast.show(errorMessage(error), "error") });
  const remove = trpc.actionItems.remove.useMutation({ onSuccess: invalidate });
  const add = trpc.actionItems.add.useMutation({
    onSuccess: () => {
      setText("");
      invalidate();
    },
    onError: (error) => toast.show(errorMessage(error), "error"),
  });

  const data = items.data as { available: boolean; items: ActionItemRow[] } | undefined;
  const list = data?.items ?? [];

  return (
    <View className="gap-4">
      <Card className="gap-3">
        <Text variant="subheading">Find tasks</Text>
        <Text variant="muted">Pulls out homework, readings, exams and to-dos mentioned in the recording, with due dates. Running it again keeps the ones you finished or added.</Text>
        <Button label={list.length ? "Find tasks again" : "Find tasks"} loading={extract.isPending} onPress={() => extract.mutate({ recordingId })} />
      </Card>
      {items.isLoading ? (
        <SkeletonList rows={2} />
      ) : data && !data.available ? (
        <EmptyState title="Tasks are not available yet" body="The server needs an update before tasks can be saved." />
      ) : list.length === 0 ? (
        <EmptyState title="No tasks" body="Nothing found yet. Add one below or tap Find tasks." />
      ) : (
        <Card className="gap-2">
          {list.map((item) => (
            <ActionItemLine
              key={item.id}
              item={item}
              onToggle={(done) => update.mutate({ id: item.id, done })}
              onRemove={() => remove.mutate({ id: item.id })}
              onOpen={typeof item.atSeconds === "number" && player ? () => player.seek(item.atSeconds!, true) : undefined}
            />
          ))}
        </Card>
      )}
      <View className="flex-row items-end gap-2">
        <Input className="flex-1" label="Add a task" value={text} onChangeText={setText} placeholder="Read chapter 4" returnKeyType="done" onSubmitEditing={() => text.trim() && add.mutate({ recordingId, text: text.trim(), kind: "task", dueDate: null })} />
        <IconButton label="Add task" disabled={!text.trim()} onPress={() => add.mutate({ recordingId, text: text.trim(), kind: "task", dueDate: null })} icon={<Plus size={22} color={theme.primary} />} className="mb-1 bg-secondary" />
      </View>
    </View>
  );
}
