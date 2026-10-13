import { Link, useRoute } from "wouter";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CourseDot } from "@/components/CourseDot";
import { trpc } from "@/lib/trpc";
import { formatRecordingDuration } from "@/lib/formatDuration";

/** A course in the team library (F3): its recordings, opened read only through the shared view. */
export default function TeamCourse() {
  const [, params] = useRoute("/team/courses/:id");
  const courseId = Number(params?.id);
  const { data, isLoading, error } = trpc.teams.courseRecordings.useQuery({ courseId }, { enabled: Number.isInteger(courseId) && courseId > 0, retry: false });

  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-16 max-w-4xl items-center gap-3 px-4">
          <Link href="/team">
            <Button variant="ghost" size="sm" className="gap-2"><ArrowLeft className="h-4 w-4" />Team</Button>
          </Link>
          <h1 className="flex min-w-0 items-center gap-2 truncate text-lg font-semibold">
            {data && <CourseDot color={data.course.color} />}
            <span className="truncate">{data?.course.name ?? "Course"}</span>
          </h1>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-10">
        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : error || !data ? (
          <Card className="p-6"><p className="text-sm text-muted-foreground">{error?.message ?? "This course is not in your team's library."}</p></Card>
        ) : (
          <Card className="gap-0 p-0">
            <p className="border-b border-border px-5 py-3 text-sm text-muted-foreground">Shared by {data.course.ownerName ?? "a teammate"}{data.course.term ? ` · ${data.course.term}` : ""}. Read only.</p>
            {data.recordings.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">No recordings in this course yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {data.recordings.map(recording => (
                  <li key={recording.id}>
                    <Link href={`/shared-with-me/${recording.id}`} className="flex items-center gap-4 px-5 py-3.5 hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{recording.title}</span>
                        <span className="block text-xs text-muted-foreground">{new Date(recording.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}{recording.status !== "completed" ? " · transcript not ready" : ""}</span>
                      </span>
                      <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{formatRecordingDuration(recording.duration)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </main>
    </div>
  );
}
