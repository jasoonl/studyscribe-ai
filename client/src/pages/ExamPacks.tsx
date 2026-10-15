import { useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { ArrowLeft, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CourseDot } from "@/components/CourseDot";
import { ExamPackDialog } from "@/components/ExamPackDialog";
import { trpc } from "@/lib/trpc";
import { formatDate, t, tn, useI18n } from "@/i18n";

/** Exam packs (C8): combined study guide and practice exam across recordings. */
export default function ExamPacks() {
  useI18n();
  const search = useSearch();
  const [, navigate] = useLocation();
  const courseParam = new URLSearchParams(search).get("course");
  const initialCourseId = courseParam && /^\d+$/.test(courseParam) ? Number(courseParam) : undefined;
  const [creating, setCreating] = useState(initialCourseId !== undefined);
  const { data, isLoading } = trpc.examPacks.list.useQuery();
  const { data: courses } = trpc.courses.list.useQuery({ includeArchived: true });
  const courseById = new Map((courses ?? []).map(course => [course.id, course]));
  const packs = data?.packs ?? [];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="container flex h-16 items-center justify-between gap-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              {t("common.library")}
            </Button>
          </Link>
          {data?.available !== false && (
            <Button size="sm" className="gap-2" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              {t("examPack.newPack")}
            </Button>
          )}
        </div>
      </header>

      <main id="main-content" className="container max-w-3xl pb-20 pt-10" tabIndex={-1}>
        <h1 className="text-4xl font-bold tracking-[-0.04em] sm:text-5xl">{t("examPack.packs")}</h1>
        <p className="mt-2 max-w-lg text-sm text-muted-foreground">
          {t("examPack.intro")}
        </p>

        <div className="mt-8">
          {isLoading ? (
            <div className="flex justify-center py-20"><Loader2 className="h-7 w-7 animate-spin text-accent" /></div>
          ) : data && !data.available ? (
            <p className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-muted-foreground">{t("examPack.unavailable")}</p>
          ) : packs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-6 py-14 text-center">
              <p className="mx-auto max-w-md text-muted-foreground">{t("examPack.empty")}</p>
              <Button variant="outline" className="mt-5 gap-2" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" />
                {t("examPack.newPack")}
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-card shadow-sm">
              {packs.map(pack => {
                const course = pack.courseId !== null ? courseById.get(pack.courseId) : undefined;
                return (
                  <li key={pack.id}>
                    <Link
                      href={`/exam-packs/${pack.id}`}
                      className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{pack.title}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                          {course && (
                            <span className="inline-flex items-center gap-1.5">
                              <CourseDot color={course.color} />
                              {course.name}
                            </span>
                          )}
                          <span>{tn("library.recordings", pack.recordingCount)}</span>
                          <span>{pack.questionCount ? tn("quiz.questions", pack.questionCount) : t("examPack.noExamYet")}</span>
                          <span>{formatDate(pack.createdAt)}</span>
                        </p>
                      </div>
                      {pack.lastScore !== null && (
                        <div className="shrink-0 text-right">
                          <p className="text-lg font-semibold tabular-nums">{pack.lastScore}%</p>
                          <p className="text-xs text-muted-foreground">{t("examPack.lastScore")}</p>
                        </div>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>

      <ExamPackDialog
        open={creating}
        onOpenChange={open => {
          setCreating(open);
          if (!open && initialCourseId !== undefined) navigate("/exam-packs", { replace: true });
        }}
        initialCourseId={initialCourseId}
      />
    </div>
  );
}
