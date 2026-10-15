import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Mic, Upload, FileText, Zap, BookOpen,
  HelpCircle, Mail, Search, MessageSquare, ChevronDown, ChevronUp
} from "lucide-react";
import { useI18n, t } from "@/i18n";
import type { MessageKey } from "@shared/i18n";

type Category = "gettingStarted" | "ai" | "organization" | "sharing" | "account" | "recording";

interface FAQItem {
  id: string;
  category: Category;
}

/** Questions and answers live in the message files as help.faq.<id>.q and help.faq.<id>.a. */
const faqs: FAQItem[] = [
  { id: "templates", category: "gettingStarted" },
  { id: "record", category: "gettingStarted" },
  { id: "formats", category: "gettingStarted" },
  { id: "duration", category: "gettingStarted" },
  { id: "studyGuide", category: "ai" },
  { id: "quiz", category: "ai" },
  { id: "emailDrafts", category: "ai" },
  { id: "assistant", category: "ai" },
  { id: "flashcards", category: "ai" },
  { id: "courses", category: "organization" },
  { id: "ask", category: "organization" },
  { id: "tasks", category: "organization" },
  { id: "keyTerms", category: "ai" },
  { id: "examPack", category: "ai" },
  { id: "vocabulary", category: "gettingStarted" },
  { id: "liveTranscript", category: "gettingStarted" },
  { id: "tabAudio", category: "gettingStarted" },
  { id: "studyHelp", category: "ai" },
  { id: "captions", category: "gettingStarted" },
  { id: "followUps", category: "ai" },
  { id: "search", category: "organization" },
  { id: "delete", category: "organization" },
  { id: "shareRoles", category: "sharing" },
  { id: "comments", category: "sharing" },
  { id: "groups", category: "sharing" },
  { id: "notion", category: "sharing" },
  { id: "webhooks", category: "sharing" },
  { id: "skipSilence", category: "ai" },
  { id: "resetPassword", category: "account" },
  { id: "google", category: "account" },
  { id: "setupList", category: "gettingStarted" },
  { id: "openSignup", category: "gettingStarted" },
  { id: "translate", category: "ai" },
  { id: "plans", category: "account" },
  { id: "upgrade", category: "account" },
  { id: "calendar", category: "organization" },
  { id: "noteTaker", category: "recording" },
  { id: "slides", category: "recording" },
  { id: "emailAttendees", category: "sharing" },
  { id: "teams", category: "account" },
  { id: "api", category: "account" },
];

const categories: Array<"all" | Category> = ["all", ...Array.from(new Set(faqs.map(f => f.category)))];

const features = [
  { icon: Mic, id: "recording", color: "bg-blue-50 text-blue-600" },
  { icon: Upload, id: "upload", color: "bg-green-50 text-green-600" },
  { icon: FileText, id: "transcription", color: "bg-primary/5 text-primary" },
  { icon: Zap, id: "flashcards", color: "bg-yellow-50 text-yellow-600" },
  { icon: BookOpen, id: "guides", color: "bg-orange-50 text-orange-600" },
  { icon: HelpCircle, id: "quizzes", color: "bg-red-50 text-red-600" },
  { icon: Mail, id: "drafts", color: "bg-pink-50 text-pink-600" },
  { icon: MessageSquare, id: "assistant", color: "bg-primary/5 text-primary" },
  { icon: MessageSquare, id: "ask", color: "bg-sky-50 text-sky-600" },
  { icon: Search, id: "kb", color: "bg-teal-50 text-teal-600" },
  { icon: MessageSquare, id: "comments", color: "bg-sky-50 text-sky-600" },
];

const faqText = (id: string, part: "q" | "a") => t(`help.faq.${id}.${part}` as MessageKey);

export default function Help() {
  const [, navigate] = useLocation();
  useI18n();
  const [activeCategory, setActiveCategory] = useState<"all" | Category>("all");
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const filteredFaqs = activeCategory === "all" ? faqs : faqs.filter(f => f.category === activeCategory);

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-background focus:outline-none">
      {/* Header */}
      <div className="border-b bg-card px-4 sm:px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")} className="gap-1 text-muted-foreground">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">{t("common.library")}</span>
          </Button>
          <div className="h-4 w-px bg-border" />
          <div>
            <h1 className="text-lg font-semibold">{t("help.title")}</h1>
            <p className="text-xs text-muted-foreground">{t("help.subtitle")}</p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-8">
        {/* Features Overview */}
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wide">{t("help.features")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {features.map((f) => (
              <Card key={f.id} className="border-0 shadow-sm">
                <CardContent className="p-4">
                  <div className={`w-9 h-9 rounded-lg ${f.color} flex items-center justify-center mb-3`}>
                    <f.icon className="w-5 h-5" />
                  </div>
                  <p className="text-sm font-semibold">{t(`help.feature.${f.id}` as MessageKey)}</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{t(`help.feature.${f.id}Desc` as MessageKey)}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wide">{t("help.faq")}</h2>

          {/* Category Filter */}
          <div className="flex flex-wrap gap-2 mb-4">
            {categories.map((cat) => (
              <Badge
                key={cat}
                variant={activeCategory === cat ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => setActiveCategory(cat)}
              >
                {t(`help.cat.${cat}` as MessageKey)}
              </Badge>
            ))}
          </div>

          <div className="space-y-2">
            {filteredFaqs.map((faq, i) => (
              <Card key={faq.id} className="border-0 shadow-sm overflow-hidden">
                <button
                  className="w-full text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-muted/40 transition-colors"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Badge variant="outline" className="text-xs flex-shrink-0">{t(`help.cat.${faq.category}` as MessageKey)}</Badge>
                    <span className="text-sm font-medium truncate">{faqText(faq.id, "q")}</span>
                  </div>
                  {openFaq === i ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  )}
                </button>
                {openFaq === i && (
                  <div className="px-4 pb-4 pt-1 border-t bg-muted/20">
                    <p className="text-sm text-muted-foreground leading-relaxed">{faqText(faq.id, "a")}</p>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </div>

        {/* Contact / Support */}
        <Card className="border-0 shadow-sm bg-brand-mist">
          <CardContent className="p-6 text-center">
            <MessageSquare className="w-8 h-8 text-blue-500 mx-auto mb-2" />
            <h3 className="font-semibold mb-1">{t("help.stillQuestions")}</h3>
            <p className="text-sm text-muted-foreground mb-4">{t("help.stillQuestionsText")}</p>
            <Button onClick={() => navigate("/dashboard")} size="sm">
              {t("help.goToLibrary")}
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
