import { useCallback, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { FileText, Plus } from "lucide-react-native";
import { AddSourceSheet } from "@/components/sources/AddSourceSheet";
import { SourceRow } from "@/components/sources/SourceRow";
import { UploadRows } from "@/components/sources/UploadRows";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { EmptyState, ErrorState, SkeletonList } from "@/components/ui/misc";
import { Screen } from "@/components/ui/Screen";
import { Sheet } from "@/components/ui/Sheet";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { errorMessage, trpc } from "@/lib/trpc";
import { isStalled, isWorkingStatus, pollIntervalFor, watchStartFor } from "@/lib/sources/pipeline";
import { useSourceUploads } from "@/lib/sources/UploadsProvider";
import { useNow } from "@/lib/useNow";
import { useTheme } from "@/theme/tokens";

export default function CourseSourcesScreen() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const theme = useTheme();
  const toast = useToast();
  const utils = trpc.useUtils();
  const { resume, rows } = useSourceUploads();
  const watchedSince = useRef(Date.now());
  const wasWorking = useRef(false);
  // Polling gives up after 15 minutes of watching; coming back to the screen or new work starts a fresh window.
  useFocusEffect(
    useCallback(() => {
      watchedSince.current = Date.now();
    }, []),
  );
  const course = trpc.courses.get.useQuery({ id });
  const list = trpc.sources.list.useQuery(
    { courseId: id },
    {
      retry: false,
      refetchInterval: (query) => {
        const sources = query.state.data?.sources ?? [];
        const working = sources.some((source) => isWorkingStatus(source.status));
        watchedSince.current = watchStartFor({ working, wasWorking: wasWorking.current, watchedSince: watchedSince.current, now: Date.now() });
        wasWorking.current = working;
        return pollIntervalFor(
          sources.map((source) => source.status),
          Date.now() - watchedSince.current,
        );
      },
    },
  );
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<{ id: number; title: string } | null>(null);
  const now = useNow(true, 15_000);

  const refresh = () => {
    void utils.sources.list.invalidate();
    void utils.sources.get.invalidate();
  };
  const remove = trpc.sources.remove.useMutation({ onSuccess: refresh, onError: (error) => toast.show(errorMessage(error), "error") });
  const rename = trpc.sources.update.useMutation({
    onSuccess: () => {
      setRenaming(null);
      refresh();
    },
    onError: (error) => toast.show(errorMessage(error), "error"),
  });
  const retry = trpc.sources.retry.useMutation({
    onSuccess: (source) => {
      watchedSince.current = Date.now();
      refresh();
      resume({ id: source.id, title: source.title, sizeBytes: source.sizeBytes, courseId: source.courseId, kind: source.kind });
    },
    onError: (error) => toast.show(errorMessage(error), "error"),
  });

  // Hidden entirely when the server has no study sources (reached by a link).
  if (list.data && list.data.available === false) {
    return (
      <Screen edges={["bottom"]}>
        <Stack.Screen options={{ title: "Study sources" }} />
        <EmptyState title="Study sources are not available yet" body="Check back after the next update." />
      </Screen>
    );
  }

  const sources = list.data?.sources ?? [];
  const driven = new Set(rows.map((row) => row.sourceId).filter((value): value is number => value !== null));

  const openMore = (source: (typeof sources)[number]) => {
    Alert.alert(source.title, undefined, [
      { text: "Rename", onPress: () => setRenaming({ id: source.id, title: source.title }) },
      {
        text: "Delete",
        style: "destructive",
        onPress: () =>
          Alert.alert("Delete this source?", "The file and everything made from it will be removed.", [
            { text: "Cancel", style: "cancel" },
            { text: "Delete", style: "destructive", onPress: () => remove.mutate({ id: source.id }) },
          ]),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  return (
    <Screen edges={["bottom"]} refreshing={list.isRefetching} onRefresh={() => list.refetch()}>
      <Stack.Screen options={{ title: "Study sources" }} />
      <View className="gap-1">
        <Text variant="title">{course.data?.name ?? "Study sources"}</Text>
        <Text variant="muted">Slides, PDFs and notes for this course.</Text>
      </View>
      <Button label="Add a source" icon={<Plus size={18} color={theme.primaryForeground} />} onPress={() => setAdding(true)} />
      <UploadRows courseId={id} />
      {list.isLoading ? (
        <SkeletonList rows={3} />
      ) : list.error ? (
        <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : sources.length === 0 && rows.length === 0 ? (
        <EmptyState
          icon={<FileText size={22} color={theme.primary} />}
          title="No study sources yet"
          body="Add PDFs, PowerPoint (.pptx) or Word (.docx) files, or text and Markdown notes. Files can be up to 25MB, and text files up to 2MB."
          action={{ label: "Add a source", onPress: () => setAdding(true) }}
        />
      ) : (
        <View className="gap-3">
          {sources
            .filter((source) => !(driven.has(source.id) && source.status !== "ready" && source.status !== "failed"))
            .map((source) => (
              <SourceRow
                key={source.id}
                source={source}
                stalled={isStalled(source, now) && !driven.has(source.id)}
                onOpen={() => router.push(`/sources/${source.id}`)}
                onContinue={() => {
                  watchedSince.current = Date.now();
                  resume({ id: source.id, title: source.title, sizeBytes: source.sizeBytes, courseId: source.courseId, kind: source.kind });
                }}
                onRetry={() => retry.mutate({ id: source.id })}
                onMore={() => openMore(source)}
              />
            ))}
        </View>
      )}
      <AddSourceSheet open={adding} onClose={() => setAdding(false)} courseId={id} />
      <Sheet open={renaming !== null} onClose={() => setRenaming(null)} title="Rename source">
        <Input label="Title" value={renaming?.title ?? ""} onChangeText={(title) => setRenaming((current) => (current ? { ...current, title } : current))} maxLength={200} />
        <Button
          label="Save"
          loading={rename.isPending}
          disabled={!renaming?.title.trim()}
          onPress={() => renaming && rename.mutate({ id: renaming.id, title: renaming.title.trim() })}
        />
      </Sheet>
    </Screen>
  );
}
