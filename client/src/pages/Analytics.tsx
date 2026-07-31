import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Mic, FileText, Zap, BookOpen, HelpCircle, Mail,
  MessageSquare, TrendingUp, ArrowLeft, Clock, CheckCircle, AlertCircle
} from "lucide-react";

function formatDuration(seconds: number | null): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function timeAgo(date: Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function Analytics() {
  const [, navigate] = useLocation();
  const { data, isLoading } = trpc.analytics.overview.useQuery();

  const stats = [
    { label: "Recordings", value: data?.totalRecordings ?? 0, icon: Mic, color: "text-blue-500", bg: "bg-blue-50" },
    { label: "Transcripts", value: data?.totalTranscripts ?? 0, icon: FileText, color: "text-green-500", bg: "bg-green-50" },
    { label: "Flashcards", value: data?.totalFlashcards ?? 0, icon: Zap, color: "text-yellow-500", bg: "bg-yellow-50" },
    { label: "Study Guides", value: data?.totalStudyGuides ?? 0, icon: BookOpen, color: "text-purple-500", bg: "bg-purple-50" },
    { label: "Quizzes", value: data?.totalQuizzes ?? 0, icon: HelpCircle, color: "text-orange-500", bg: "bg-orange-50" },
    { label: "Email Drafts", value: data?.totalEmailDrafts ?? 0, icon: Mail, color: "text-pink-500", bg: "bg-pink-50" },
    { label: "AI Conversations", value: data?.totalChatMessages ?? 0, icon: MessageSquare, color: "text-indigo-500", bg: "bg-indigo-50" },
    { label: "Recordings (30d)", value: data?.recentRecordings ?? 0, icon: TrendingUp, color: "text-teal-500", bg: "bg-teal-50" },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card px-4 sm:px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")} className="gap-1 text-muted-foreground">
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Dashboard</span>
          </Button>
          <div className="h-4 w-px bg-border" />
          <div>
            <h1 className="text-lg font-semibold">Analytics</h1>
            <p className="text-xs text-muted-foreground">Your StudyScribe AI usage overview</p>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Stats Grid */}
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wide">All Time</h2>
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
                    <div className={`w-9 h-9 rounded-lg ${stat.bg} flex items-center justify-center mb-3`}>
                      <stat.icon className={`w-5 h-5 ${stat.color}`} />
                    </div>
                    <div className="text-2xl font-bold">{stat.value.toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{stat.label}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wide">Recent Recordings</h2>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-4 space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />
                  ))}
                </div>
              ) : !data?.recentActivity?.length ? (
                <div className="p-8 text-center text-muted-foreground">
                  <Mic className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No recordings yet. Start by recording or uploading audio.</p>
                </div>
              ) : (
                <div className="divide-y">
                  {data.recentActivity.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 cursor-pointer transition-colors"
                      onClick={() => navigate(`/recording/${r.id}`)}
                    >
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                        <Mic className="w-4 h-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{r.title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDuration(r.duration)}
                          </span>
                          <span className="text-xs text-muted-foreground">·</span>
                          <span className="text-xs text-muted-foreground">{timeAgo(r.createdAt)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Badge variant="outline" className="text-xs capitalize">{r.audience}</Badge>
                        {r.status === "completed" ? (
                          <CheckCircle className="w-4 h-4 text-green-500" />
                        ) : r.status === "failed" ? (
                          <AlertCircle className="w-4 h-4 text-red-500" />
                        ) : (
                          <div className="w-4 h-4 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
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
          <h2 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wide">Tips to Get More Value</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { icon: Zap, title: "Generate Flashcards", desc: "Open any recording and use the Flashcards tab to auto-generate study cards.", color: "text-yellow-500" },
              { icon: HelpCircle, title: "Take Practice Quizzes", desc: "Use the AI Study Tools sidebar to create and take quizzes from your transcripts.", color: "text-orange-500" },
              { icon: BookOpen, title: "Search Knowledge Base", desc: "Use the Knowledge Base to search across all your recordings at once.", color: "text-purple-500" },
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
    </div>
  );
}
