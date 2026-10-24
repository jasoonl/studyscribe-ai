import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Alert, ScrollView, View } from "react-native";
import { Stack, router, useIsFocused, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { AlertCircle, RotateCw, Trash2 } from "lucide-react-native";
import type { inferRouterOutputs } from "@trpc/server";
import { LikelyOnTestTab } from "@/components/sources/LikelyOnTestTab";
import { PagesTab } from "@/components/sources/PagesTab";
import { SourceSummaryTab } from "@/components/sources/SourceSummaryTab";
import {
  formatSize,
  isSourceStalled,
  pagesTabLabel,
  parseDetailParams,
  sourceErrorText,
  unitCountText,
  type DetailTab,
} from "@/components/sources/detailModel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/Segmented";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { failureReasonOf, failureText, isRetryableReason, kindLabel, stageOf, type SourceFlag } from "@/lib/sources/model";
import { SourceProgress } from "@/components/sources/SourceProgress";
import { useSourceUploads } from "@/lib/sources/UploadsProvider";
import { trpc, type AppRouter } from "@/lib/trpc";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { useTheme } from "@/theme/tokens";

type Detail = inferRouterOutputs<AppRouter>["sources"]["get"];

const STAGE_WORD = { waiting: "Waiting", reading: "Reading the file", summarizing: "Summarizing", ready: "Ready", failed: "Failed" } as const;

/** One study source: summary, details likely on a test, and the pages with the cited passage highlighted. */
export default function SourceDetailScreen() {
  const params = useLocalSearchParams<{ id: string; tab?: string; page?: string; q?: string }>();
  const id = Number(params.id);
  const validId = Number.isInteger(id) && id > 0;
  const theme = useTheme();
  const toast = useToast();
  const reduced = useReducedMotion();
  const focused = useIsFocused();
  const utils = trpc.useUtils();
  const uploads = useSourceUploads();
  const scroll = useRef<ScrollView>(null);
  const pagesY = useRef(0);
  const [actionError, setActionError] = useState<string | null>(null);

  const result = trpc.sources.get.useQuery(
    { id },
    {
      enabled: validId,
      retry: false,
      refetchInterval: (query) => {
        const status = query.state.data?.source.status;
        return focused && status && status !== "ready" && status !== "failed" ? 3000 : false;
      },
    },
  );
  const remove = trpc.sources.remove.useMutation();
  const retry = trpc.sources.retry.useMutation();

  const data: Detail | undefined = result.data;
  const source = data?.source;
  const flags = (data?.flags ?? []) as SourceFlag[];
  const units = data?.units ?? [];
  const unitCount = units.length;

  // The route's tab, page and quote are copied into state once per distinct set of params, so a
  // later link replaces them but a poll never does.
  const initial = parseDetailParams(params, unitCount);
  const paramKey = `${params.tab ?? ""}|${params.page ?? ""}|${params.q ?? ""}|${unitCount > 0}`;
  const [tab, setTab] = useState<DetailTab>(initial.tab);
  const [unit, setUnit] = useState<number | null>(initial.unit);
  const [quote, setQuote] = useState<string | null>(initial.quote);
  const [fromLink, setFromLink] = useState(initial.unit !== null);
  const appliedKey = useRef(paramKey);
  useEffect(() => {
    if (appliedKey.current === paramKey) return;
    appliedKey.current = paramKey;
    const next = parseDetailParams({ tab: params.tab, page: params.page, q: params.q }, unitCount);
    setTab(next.tab);
    setUnit(next.unit);
    setQuote(next.quote);
    setFromLink(next.unit !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramKey]);

  const stage = source ? stageOf(source.status) : null;
  const ready = stage === "ready";
  const working = stage === "waiting" || stage === "reading" || stage === "summarizing";
  const status = source?.status;
  const title = source?.title ?? "";
  // A poll that returns the same data does not re-render, so "stalled" needs its own clock.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(timer);
  }, [working]);
  const lastStatus = useRef<string | null>(null);
  useEffect(() => {
    if (!status) return;
    if (lastStatus.current && lastStatus.current !== "ready" && status === "ready") AccessibilityInfo.announceForAccessibility(`${title} is ready.`);
    lastStatus.current = status;
  }, [status, title]);

  const myRows = uploads.rows.filter((row) => row.sourceId === id);
  const driven = myRows.some((row) => row.stage !== "error" && row.stage !== "done");
  const failedRow = myRows.find((row) => row.stage === "error");
  const reason = failureReasonOf(source?.errorMessage, source?.kind);
  const stalled = source ? !driven && isSourceStalled(source, now) : false;

  const current = unit !== null ? (units[unit]?.unitIndex ?? 0) : (units[0]?.unitIndex ?? 0);
  const openUnit = (unitIndex: number, text: string | null) => {
    setUnit(units.findIndex((item) => item.unitIndex === unitIndex));
    setQuote(text);
    setFromLink(true);
    setTab("pages");
  };
  const openFlag = (flag: SourceFlag) => openUnit(flag.unitIndex, flag.quote);

  const refresh = () => Promise.all([utils.sources.get.invalidate({ id }), utils.sources.list.invalidate()]);

  const doRetry = async () => {
    if (!source) return;
    setActionError(null);
    try {
      await retry.mutateAsync({ id });
      uploads.resume({ id: source.id, title: source.title, sizeBytes: source.sizeBytes, courseId: source.courseId, kind: source.kind });
      await refresh();
    } catch (error) {
      setActionError(sourceErrorText(error));
    }
  };

  const doContinue = () => {
    if (!source) return;
    setActionError(null);
    uploads.resume({ id: source.id, title: source.title, sizeBytes: source.sizeBytes, courseId: source.courseId, kind: source.kind });
  };

  const confirmDelete = () => {
    if (!source) return;
    Alert.alert(`Delete "${source.title}"?`, "The file, its summary and its details are removed. This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setActionError(null);
          try {
            await remove.mutateAsync({ id });
            await utils.sources.list.invalidate();
            toast.show("Source deleted", "success");
            if (router.canGoBack()) router.back();
            else router.replace("/");
          } catch (error) {
            setActionError(sourceErrorText(error));
          }
        },
      },
    ]);
  };

  const onReveal = (y: number) => scroll.current?.scrollTo({ y: Math.max(0, pagesY.current + y - 24), animated: !reduced });

  const body = !validId ? (
    <EmptyState title="Source not found" body="This link does not point to a study source." action={{ label: "Go back", onPress: () => router.back() }} />
  ) : result.isLoading ? (
    <View accessible accessibilityLabel="Loading" className="gap-3">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-48 w-full" />
    </View>
  ) : !source ? (
    result.error ? (
      <ErrorState message={sourceErrorText(result.error)} onRetry={() => void result.refetch()} />
    ) : (
      <EmptyState title="Source not found" body="It may have been deleted." action={{ label: "Go back", onPress: () => router.back() }} />
    )
  ) : (
    <>
      <View className="gap-2">
        <Text variant="title">{source.title}</Text>
        <View className="flex-row flex-wrap items-center gap-2">
          <Badge label={STAGE_WORD[stage!]} tone={ready ? "success" : stage === "failed" ? "danger" : "primary"} />
          <Text variant="muted" className="shrink">
            {[kindLabel(source.kind), source.unitCount > 0 ? unitCountText(source.kind, source.unitCount) : null, formatSize(source.sizeBytes)].filter(Boolean).join(" · ")}
          </Text>
        </View>
      </View>

      {actionError ? (
        <View accessibilityRole="alert" accessibilityLiveRegion="assertive" className="flex-row items-start gap-2 rounded-xl border border-destructive/30 p-4">
          <AlertCircle size={18} color={theme.destructive} />
          <Text variant="small" className="flex-1 text-destructive">
            {actionError}
          </Text>
        </View>
      ) : null}

      {working ? (
        <View className="gap-3 rounded-xl border border-border bg-card p-4">
          <SourceProgress status={source.status} partsDone={source.partsDone} partCount={source.partCount} />
          <Text variant="muted">{stalled ? "This stopped before it finished. Continue to pick up where it left off." : "StudyScribe is reading this file. You can leave this screen."}</Text>
          {stalled ? <Button label="Continue" variant="outline" icon={<RotateCw size={16} color={theme.foreground} />} onPress={doContinue} /> : null}
        </View>
      ) : null}

      {stage === "failed" ? (
        <View accessibilityRole="alert" className="gap-3 rounded-xl border border-destructive/30 p-4">
          <View className="flex-row items-start gap-2">
            <AlertCircle size={18} color={theme.destructive} />
            <Text variant="small" className="flex-1 text-destructive">
              {failureText(reason)}
            </Text>
          </View>
          {isRetryableReason(reason) && !driven ? (
            <Button label="Retry" variant="outline" loading={retry.isPending} icon={<RotateCw size={16} color={theme.foreground} />} onPress={() => void doRetry()} />
          ) : null}
        </View>
      ) : null}

      {failedRow && stage !== "failed" ? (
        <View accessibilityRole="alert" className="gap-3 rounded-xl border border-destructive/30 p-4">
          <Text variant="small" className="text-destructive">
            The last attempt did not finish.
          </Text>
          <Button label="Try again" variant="outline" onPress={() => uploads.retry(failedRow.id)} />
        </View>
      ) : null}

      {ready ? (
        <>
          <Segmented
            label="Source sections"
            value={tab}
            onChange={(next) => {
              setTab(next);
              if (next !== "pages") {
                setQuote(null);
                setFromLink(false);
              }
            }}
            options={[
              { value: "summary", label: "Summary" },
              { value: "points", label: "Likely on a test" },
              { value: "pages", label: pagesTabLabel(source.kind) },
            ]}
          />
          {tab === "summary" ? <SourceSummaryTab summary={source.summary} flags={flags} onOpenFlag={openFlag} onSeeAll={() => setTab("points")} /> : null}
          {tab === "points" ? <LikelyOnTestTab flags={flags} onOpen={openFlag} /> : null}
          {tab === "pages" ? (
            <View onLayout={(event) => (pagesY.current = event.nativeEvent.layout.y)}>
              <PagesTab
                sourceId={source.id}
                units={units}
                current={current}
                quote={quote}
                focusHeading={fromLink}
                noun={pagesTabLabel(source.kind).replace(/s$/, "").toLowerCase()}
                onSelect={(unitIndex) => openUnit(unitIndex, null)}
                onReveal={onReveal}
              />
            </View>
          ) : null}
        </>
      ) : null}

      <Button
        label="Delete source"
        variant="destructiveOutline"
        loading={remove.isPending}
        icon={<Trash2 size={16} color={theme.destructive} />}
        onPress={confirmDelete}
      />
    </>
  );

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <Stack.Screen options={{ title: source?.title ?? "" }} />
      <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic">
        <View className="w-full max-w-[720px] self-center gap-4 px-4 pb-10 pt-3">{body}</View>
      </ScrollView>
    </SafeAreaView>
  );
}
