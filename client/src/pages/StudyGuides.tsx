import { useState } from "react";
import { useParams, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { formatDate, getUiLanguage, t, useI18n } from "@/i18n";
import { htmlLangFor, type MessageKey } from "@shared/i18n";
import { BookOpen, ArrowLeft, Sparkles, Clock, ChevronRight, FileText } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { SendToMenu } from "@/components/SendToMenu";
import { TranslateMenu } from "@/components/TranslateDialog";

/** Key points come back from the model with markdown emphasis (`**Term:** …`); show them as plain text. */
const plainKeyPoint = (text: string) => text.replace(/[*_`#]+/g, "").trim();

export default function StudyGuides() {
  useI18n();
  const { recordingId } = useParams<{ recordingId: string }>();
  const recId = parseInt(recordingId || "0", 10);
  const [selectedGuideId, setSelectedGuideId] = useState<number | null>(null);

  const { data: recording } = trpc.recordings.get.useQuery({ id: recId }, { enabled: !!recId });
  const { data: guides, isLoading, refetch } = trpc.studyGuides.list.useQuery(
    { recordingId: recId },
    { enabled: !!recId }
  );
  const { data: selectedGuide, isLoading: isLoadingGuide } = trpc.studyGuides.get.useQuery(
    { id: selectedGuideId! },
    { enabled: !!selectedGuideId }
  );

  const generateMutation = trpc.studyGuides.generate.useMutation({
    onSuccess: (data) => {
      toast.success(t("guides.generated", { title: data.title }));
      refetch();
    },
    onError: (err) => {
      toast.error(err.message || t("guides.generateFailed"));
    },
  });

  const handleGenerate = () => {
    if (!recId) return;
    generateMutation.mutate({ recordingId: recId });
  };

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-background focus:outline-none">
      {/* Header */}
      <div className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href={`/recording/${recId}`}>
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="w-4 h-4" />
              {t("recording.back")}
            </Button>
          </Link>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <BookOpen className="w-5 h-5 text-primary shrink-0" />
            <div className="min-w-0">
              <h1 className="font-semibold text-sm truncate">{t("guides.title")}</h1>
              {recording && (
                <p className="text-xs text-muted-foreground truncate">{recording.title}</p>
              )}
            </div>
          </div>
          <Button
            onClick={handleGenerate}
            disabled={generateMutation.isPending}
            size="sm"
            className="gap-2 shrink-0"
          >
            <Sparkles className="w-4 h-4" />
            {generateMutation.isPending ? t("quiz.generating") : t("guides.generate")}
          </Button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 flex flex-col lg:flex-row gap-6">
        {/* Sidebar: list of guides */}
        <div className="w-full lg:w-72 shrink-0 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
            {t("guides.listHeading", { count: guides?.length ?? 0 })}
          </p>

          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-2xl" />
            ))
          ) : guides?.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="p-4 text-center">
                <FileText className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">{t("guides.empty")}</p>
                <p className="text-xs text-muted-foreground mt-1">{t("guides.emptyHint")}</p>
              </CardContent>
            </Card>
          ) : (
            guides?.map((guide) => (
              <button
                key={guide.id}
                onClick={() => setSelectedGuideId(guide.id)}
                className={`w-full text-left p-3 rounded-2xl border transition-all hover:border-primary hover:bg-primary/5 ${
                  selectedGuideId === guide.id
                    ? "border-primary bg-primary/10"
                    : "border-border bg-card"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{guide.title}</p>
                    <div className="flex items-center gap-1 mt-1">
                      <Clock className="w-3 h-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">
                        {formatDate(guide.createdAt)}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                </div>
                {Array.isArray(guide.keyPoints) && guide.keyPoints.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {(guide.keyPoints as string[]).slice(0, 2).map((kp, i) => (
                      <Badge key={i} variant="secondary" className="text-xs !inline-block truncate max-w-[140px]">
                        {plainKeyPoint(kp)}
                      </Badge>
                    ))}
                  </div>
                )}
              </button>
            ))
          )}
        </div>

        {/* Main content: selected guide */}
        <div className="flex-1 min-w-0">
          {generateMutation.isPending && (
            <Card className="mb-4 border-primary/30 bg-primary/5">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                  <Sparkles className="w-4 h-4 text-primary animate-pulse" />
                </div>
                <div>
                  <p className="text-sm font-medium">{t("guides.progressTitle")}</p>
                  <p className="text-xs text-muted-foreground">{t("guides.progressText")}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {!selectedGuideId ? (
            <Card className="border-dashed h-64 flex items-center justify-center">
              <CardContent className="text-center p-8">
                <BookOpen className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">{t("guides.selectPrompt")}</p>
              </CardContent>
            </Card>
          ) : isLoadingGuide ? (
            <Card>
              <CardHeader>
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-32" />
              </CardHeader>
              <CardContent className="space-y-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-4 w-full" />
                ))}
              </CardContent>
            </Card>
          ) : selectedGuide ? (
            <Card>
              <CardHeader className="border-b border-border pb-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-lg">{selectedGuide.title}</CardTitle>
                    <CardDescription className="mt-1">
                      {t("guides.generatedAt", { date: new Date(selectedGuide.createdAt).toLocaleString(htmlLangFor(getUiLanguage())) })}
                    </CardDescription>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {selectedGuide.status === "completed" && <TranslateMenu kind="guide" id={selectedGuide.id} />}
                    {selectedGuide.status === "completed" && <SendToMenu kind="guide" id={selectedGuide.id} />}
                    <Badge variant="outline" className="shrink-0 border-green-500/50 text-green-400">
                      {selectedGuide.status ? t(`guides.status.${selectedGuide.status}` as MessageKey) : null}
                    </Badge>
                  </div>
                </div>
                {Array.isArray(selectedGuide.keyPoints) && (selectedGuide.keyPoints as string[]).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {(selectedGuide.keyPoints as string[]).map((kp, i) => (
                      <Badge key={i} variant="secondary" className="text-xs h-auto max-w-full whitespace-normal text-left">
                        {plainKeyPoint(kp)}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardHeader>
              <CardContent className="pt-5">
                <div className="prose prose-sm prose-invert max-w-none">
                  <Markdown>{selectedGuide.content}</Markdown>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </main>
  );
}
