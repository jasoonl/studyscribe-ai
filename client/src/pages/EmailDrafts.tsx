import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useParams, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Mail, ArrowLeft, Sparkles, Clock, ChevronRight, FileText,
  Copy, Check, FileCheck
} from "lucide-react";
import { Streamdown } from "streamdown";

type DraftType = "email-summary" | "document" | "report";
type ToneType = "formal" | "casual" | "technical" | "persuasive";

const TONES: { value: ToneType; label: string; description: string }[] = [
  { value: "formal", label: "Formal", description: "Professional & structured" },
  { value: "casual", label: "Casual", description: "Friendly & conversational" },
  { value: "technical", label: "Technical", description: "Expert & detailed" },
  { value: "persuasive", label: "Persuasive", description: "Motivating & action-oriented" },
];

const DRAFT_TYPES: { value: DraftType; label: string; description: string; icon: React.ReactNode; color: string }[] = [
  {
    value: "email-summary",
    label: "Email Summary",
    description: "A concise email to share with colleagues or classmates",
    icon: <Mail className="w-5 h-5" />,
    color: "text-blue-400",
  },
  {
    value: "document",
    label: "Document",
    description: "A structured document with all key information",
    icon: <FileText className="w-5 h-5" />,
    color: "text-emerald-400",
  },
  {
    value: "report",
    label: "Formal Report",
    description: "A professional report with executive summary and findings",
    icon: <FileCheck className="w-5 h-5" />,
    color: "text-amber-400",
  },
];

export default function EmailDrafts() {
  const { recordingId } = useParams<{ recordingId: string }>();
  const recId = parseInt(recordingId || "0", 10);
  const [selectedDraftId, setSelectedDraftId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [selectedTone, setSelectedTone] = useState<ToneType>("formal");

  const { data: recording } = trpc.recordings.get.useQuery({ id: recId }, { enabled: !!recId });
  const { data: drafts, isLoading, refetch } = trpc.emailDrafts.list.useQuery(
    { recordingId: recId },
    { enabled: !!recId }
  );
  const { data: selectedDraft, isLoading: isLoadingDraft } = trpc.emailDrafts.get.useQuery(
    { id: selectedDraftId! },
    { enabled: !!selectedDraftId }
  );

  const generateMutation = trpc.emailDrafts.generate.useMutation({
    onSuccess: (data) => {
      toast.success(`"${data.title}" generated!`);
      refetch();
    },
    onError: (err) => toast.error(err.message || "Failed to generate draft"),
  });

  const toneLabel = (tone: string) => {
    return TONES.find(t => t.value === tone)?.label ?? tone;
  };

  const handleCopy = async () => {
    if (!selectedDraft) return;
    const text = `Subject: ${selectedDraft.subject}\n\n${selectedDraft.content}`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Copied to clipboard!");
    setTimeout(() => setCopied(false), 2000);
  };

  const draftTypeLabel = (type: string) => {
    return DRAFT_TYPES.find(t => t.value === type)?.label ?? type;
  };

  const draftTypeColor = (type: string) => {
    return DRAFT_TYPES.find(t => t.value === type)?.color ?? "text-muted-foreground";
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href={`/recording/${recId}`}>
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
          </Link>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Mail className="w-5 h-5 text-blue-500 shrink-0" />
            <div className="min-w-0">
              <h1 className="font-semibold text-sm truncate">Email Drafts & Documents</h1>
              {recording && <p className="text-xs text-muted-foreground truncate">{recording.title}</p>}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 flex gap-6">
        {/* Sidebar */}
        <div className="w-72 shrink-0 space-y-4">
          {/* Generate buttons */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Generate New</p>
            {/* Tone selector */}
            <div className="mb-4 p-3 rounded-lg border border-border bg-muted/20">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">
                Writing Tone
              </label>
              <Select value={selectedTone} onValueChange={(val) => setSelectedTone(val as ToneType)}>
                <SelectTrigger className="w-full text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TONES.map((tone) => (
                    <SelectItem key={tone.value} value={tone.value}>
                      <div className="flex flex-col">
                        <span className="font-medium">{tone.label}</span>
                        <span className="text-xs text-muted-foreground">{tone.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Draft type buttons */}
            <div className="space-y-2">
              {DRAFT_TYPES.map((type) => (
                <button
                  key={type.value}
                  onClick={() => generateMutation.mutate({ recordingId: recId, draftType: type.value, tone: selectedTone })}
                  disabled={generateMutation.isPending}
                  className="w-full text-left p-3 rounded-lg border border-border bg-card hover:border-blue-400/50 hover:bg-blue-50/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className={type.color}>{type.icon}</span>
                    <span className="text-sm font-medium">{type.label}</span>
                    {generateMutation.isPending && generateMutation.variables?.draftType === type.value && (
                      <Sparkles className="w-3 h-3 text-blue-400 animate-pulse ml-auto" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{type.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Existing drafts */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Saved Drafts ({drafts?.length ?? 0})
            </p>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg mb-2" />)
            ) : drafts?.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No drafts yet.</p>
            ) : (
              <div className="space-y-2">
                {drafts?.map((draft) => (
                  <button
                    key={draft.id}
                    onClick={() => setSelectedDraftId(draft.id)}
                    className={`w-full text-left p-3 rounded-lg border transition-all hover:border-blue-400 hover:bg-blue-50/5 ${
                      selectedDraftId === draft.id
                        ? "border-blue-500 bg-blue-50/10"
                        : "border-border bg-card"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate">{draft.title}</p>
                        <div className="flex items-center gap-1.5 mt-1">
                          <Badge variant="outline" className={`text-xs px-1.5 py-0 ${draftTypeColor(draft.draftType ?? "email-summary")}`}>
                            {draftTypeLabel(draft.draftType ?? "email-summary")}
                          </Badge>
                          {draft.tone && (
                            <Badge variant="secondary" className="text-xs px-1.5 py-0">
                              {toneLabel(draft.tone)}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1 mt-1">
                          <Clock className="w-3 h-3 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">
                            {new Date(draft.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {generateMutation.isPending && (
            <Card className="mb-4 border-blue-500/30 bg-blue-50/5">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
                  <Sparkles className="w-4 h-4 text-blue-400 animate-pulse" />
                </div>
                <div>
                  <p className="text-sm font-medium">Generating draft…</p>
                  <p className="text-xs text-muted-foreground">AI is writing your {draftTypeLabel(generateMutation.variables?.draftType ?? "email-summary")}. This may take 15–30 seconds.</p>
                </div>
              </CardContent>
            </Card>
          )}

          {!selectedDraftId ? (
            <Card className="border-dashed h-64 flex items-center justify-center">
              <CardContent className="text-center p-8">
                <Mail className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">Select a draft from the list, or generate a new one.</p>
              </CardContent>
            </Card>
          ) : isLoadingDraft ? (
            <Card>
              <CardHeader>
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-32" />
              </CardHeader>
              <CardContent className="space-y-3">
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
              </CardContent>
            </Card>
          ) : selectedDraft ? (
            <Card>
              <CardHeader className="border-b border-border pb-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className={`text-xs ${draftTypeColor(selectedDraft.draftType ?? "email-summary")}`}>
                        {draftTypeLabel(selectedDraft.draftType ?? "email-summary")}
                      </Badge>
                      {selectedDraft.tone && (
                        <Badge variant="secondary" className="text-xs">
                          {toneLabel(selectedDraft.tone)}
                        </Badge>
                      )}
                    </div>
                    <CardTitle className="text-base">{selectedDraft.title}</CardTitle>
                    <CardDescription className="mt-1">
                      Generated {new Date(selectedDraft.createdAt).toLocaleString()}
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopy}
                    className="gap-2 shrink-0"
                  >
                    {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                    {copied ? "Copied!" : "Copy"}
                  </Button>
                </div>
                {/* Subject line */}
                <div className="mt-3 p-3 rounded-lg bg-muted/30 border border-border">
                  <p className="text-xs text-muted-foreground mb-0.5">Subject</p>
                  <p className="text-sm font-medium">{selectedDraft.subject}</p>
                </div>
              </CardHeader>
              <CardContent className="pt-5">
                <div className="prose prose-sm prose-invert max-w-none">
                  <Streamdown>{selectedDraft.content}</Streamdown>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
