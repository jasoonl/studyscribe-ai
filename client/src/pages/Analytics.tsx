import { PRESSABLE_FOCUS, pressable } from "@/lib/pressable";
import { trpc } from "@/lib/trpc";
import { formatRecordingDuration } from "@/lib/formatDuration";
import { useLocation } from "wouter";
import { useI18n } from "@/i18n";
import { relativeTime } from "@/lib/relativeTime";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Mic, FileText, Zap, BookOpen, HelpCircle, Mail,
  MessageSquare, TrendingUp, ArrowLeft, Clock, CheckCircle, AlertCircle
} from "lucide-react";

export default function Analytics() {
  const [, navigate] = useLocation();
  const { data, isLoading } = trpc.analytics.overview.useQuery();
  const { t, formatNumber } = useI18n();

  const stats = [
    { label: t("analytics.recordings"), value: data?.totalRecordings ?? 0, icon: Mic, color: "text-primary", bg: "bg-primary/15" },
    { label: t("analytics.transcripts"), value: data?.totalTranscripts ?? 0, icon: FileText, color: "text-green-500", bg: "bg-green-50" },
    { label: t("analytics.flashcards"), value: data?.totalFlashcards ?? 0, icon: Zap, color: "text-yellow-500", bg: "bg-yellow-50" },
    { label: t("analytics.studyGuides"), value: data?.totalStudyGuides ?? 0, icon: BookOpen, color: "text-primary", bg: "bg-primary/15" },
    { label: t("analytics.quizzes"), value: data?.totalQuizzes ?? 0, icon: HelpCircle, color: "text-orange-500", bg: "bg-orange-50" },
    { label: t("analytics.emailDrafts"), value: data?.totalEmailDrafts ?? 0, icon: Mail, color: "text-pink-500", bg: "bg-pink-50" },
    { label: t("analytics.conversations"), value: data?.totalChatMessages ?? 0, icon: MessageSquare, color: "text-primary", bg: "bg-primary/15" },
    { label: t("analytics.recent30"), value: data?.recentRecordings ?? 0, icon: TrendingUp, color: "text-teal-500", bg: "bg-teal-50" },
  ];

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-background focus:outline-none">
      {/* Header */}
      <div className="border-b bg-card px-4 sm:px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")} className="gap-1 text-muted-foreground">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">{t("common.library")}</span>
          </Button>
          <div className="h-4 w-px bg-border" />
          <div>
            <h1 className="text-lg font-semibold">{t("analytics.title")}</h1>
            <p className="text-xs text-muted-foreground">{t("analytics.subtitle")}</p>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Stats Grid */}
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wide">{t("analytics.allTime")}</h2>
          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {stats.map((stat) => (
                <Card key={stat.label} className="border-0 shadow-sm">
                  <CardContent className="p-4">
                    <div className={`w-9 h-9 rounded-2xl ${stat.bg} flex items-center justify-center mb-3`}>
                      <stat.icon className={`w-5 h-5 ${stat.color}`} />
                    </div>
                    <div className="text-2xl font-bold">{formatNumber(stat.value)}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{stat.label}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wide">{t("analytics.recentRecordings")}</h2>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-4 space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-12 rounded-2xl bg-muted animate-pulse" />
                  ))}
                </div>
              ) : !data?.recentActivity?.length ? (
                <div className="p-8 text-center text-muted-foreground">
                  <Mic className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">{t("analytics.none")}</p>
                </div>
              ) : (
                <div className="divide-y">
                  {data.recentActivity.map((r) => (
                    <div
                      key={r.id}
                      className={`flex items-center gap-3 px-4 py-3 hover:bg-muted/40 cursor-pointer transition-colors ${PRESSABLE_FOCUS}`}
                      {...pressable(() => navigate(`/recording/${r.id}`), "link")}
                    >
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                        <Mic className="w-4 h-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{r.title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatRecordingDuration(r.duration)}
                          </span>
                          <span className="text-xs text-muted-foreground">·</span>
                          <span className="text-xs text-muted-foreground">{relativeTime(r.createdAt)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Badge variant="outline" className="text-xs">{r.audience === "professional" ? t("analytics.audience.professional") : t("analytics.audience.student")}</Badge>
                        {r.status === "completed" ? (
                          <CheckCircle className="w-4 h-4 text-green-500" />
                        ) : r.status === "failed" ? (
                          <AlertCircle className="w-4 h-4 text-red-500" />
                        ) : (
                          <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Usage Tips */}
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wide">{t("analytics.tips")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { icon: Zap, title: t("analytics.tip1Title"), desc: t("analytics.tip1"), color: "text-yellow-500" },
              { icon: HelpCircle, title: t("analytics.tip2Title"), desc: t("analytics.tip2"), color: "text-orange-500" },
              { icon: BookOpen, title: t("analytics.tip3Title"), desc: t("analytics.tip3"), color: "text-primary" },
            ].map((tip) => (
              <Card key={tip.title} className="border-0 shadow-sm">
                <CardContent className="p-4">
                  <tip.icon className={`w-5 h-5 ${tip.color} mb-2`} />
                  <p className="text-sm font-medium">{tip.title}</p>
                  <p className="text-xs text-muted-foreground mt-1">{tip.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
