import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CourseDot } from "@/components/CourseDot";
import { trpc } from "@/lib/trpc";

/** Must match MAX_PACK_RECORDINGS on the server. */
const MAX_RECORDINGS = 12;

/**
 * Starts an exam pack (C8) from a course or from recordings picked one by one.
 * Creating it writes the study guide, which takes a little while; the pack
 * page then writes the practice exam.
 */
export function ExamPackDialog({
  open,
  onOpenChange,
  initialCourseId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialCourseId?: number;
}) {
  const [, navigate] = useLocation();
  const { data: courses } = trpc.courses.list.useQuery(undefined, { enabled: open });
  const { data: recordings } = trpc.recordings.list.useQuery(undefined, { enabled: open });
  const [mode, setMode] = useState<"course" | "pick">(initialCourseId ? "course" : "pick");
  const [courseId, setCourseId] = useState<string>(initialCourseId ? String(initialCourseId) : "");
  const [picked, setPicked] = useState<number[]>([]);
  const [filter, setFilter] = useState("");
  const [title, setTitle] = useState("");

  useEffect(() => {
    if (!open) return;
    setMode(initialCourseId ? "course" : "pick");
    setCourseId(initialCourseId ? String(initialCourseId) : "");
    setPicked([]);
    setFilter("");
    setTitle("");
  }, [open, initialCourseId]);

  const usableCourses = (courses ?? []).filter(course => course.recordingCount > 0);
  const ready = useMemo(() => (recordings ?? []).filter(recording => recording.status === "completed"), [recordings]);
  const visible = ready.filter(recording => recording.title.toLowerCase().includes(filter.trim().toLowerCase()));
  const selectedCourse = usableCourses.find(course => String(course.id) === courseId);

  const create = trpc.examPacks.create.useMutation({
    onSuccess: result => {
      onOpenChange(false);
      if (result.skipped > 0) toast.message(`Built from the ${result.used} most recent recordings with finished transcripts.`);
      navigate(`/exam-packs/${result.id}?new=1`);
    },
    onError: error => toast.error(error.message || "Could not make the exam pack"),
  });

  const canSubmit = mode === "course" ? !!selectedCourse : picked.length > 0;
  const submit = () => {
    if (!canSubmit) return;
    create.mutate(
      mode === "course"
        ? { courseId: selectedCourse!.id, title: title.trim() || undefined }
        : { recordingIds: picked, title: title.trim() || undefined },
    );
  };

  const toggle = (id: number, checked: boolean) =>
    setPicked(current => (checked ? (current.length >= MAX_RECORDINGS ? current : [...current, id]) : current.filter(item => item !== id)));

  return (
    <Dialog open={open} onOpenChange={next => { if (!create.isPending) onOpenChange(next); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New exam pack</DialogTitle>
          <DialogDescription>One study guide and one practice exam covering several recordings at once.</DialogDescription>
        </DialogHeader>

        {create.isPending ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center" role="status">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="font-medium">Writing the study guide</p>
            <p className="max-w-xs text-sm text-muted-foreground">Reading every transcript in the pack and organising it by topic. This usually takes under a minute.</p>
          </div>
        ) : (
          <form
            className="min-w-0 space-y-5"
            onSubmit={event => {
              event.preventDefault();
              submit();
            }}
          >
            <Tabs value={mode} onValueChange={value => setMode(value as "course" | "pick")}>
              <TabsList className="w-full">
                <TabsTrigger value="course" disabled={usableCourses.length === 0}>A whole course</TabsTrigger>
                <TabsTrigger value="pick">Pick recordings</TabsTrigger>
              </TabsList>

              <TabsContent value="course" className="pt-3">
                <Label htmlFor="pack-course" className="mb-1.5 block">Course</Label>
                <Select value={courseId} onValueChange={setCourseId}>
                  <SelectTrigger id="pack-course" className="w-full"><SelectValue placeholder="Choose a course" /></SelectTrigger>
                  <SelectContent>
                    {usableCourses.map(course => (
                      <SelectItem key={course.id} value={String(course.id)}>
                        <span className="flex items-center gap-2">
                          <CourseDot color={course.color} />
                          {course.name}
                          <span className="tabular-nums text-muted-foreground">{course.recordingCount}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-2 text-xs text-muted-foreground">Uses the course's finished transcripts, up to its {MAX_RECORDINGS} most recent recordings.</p>
              </TabsContent>

              <TabsContent value="pick" className="pt-3">
                {ready.length === 0 ? (
                  <p className="rounded-xl bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">No recordings with finished transcripts yet.</p>
                ) : (
                  <>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Filter by title" aria-label="Filter recordings by title" className="pl-9" />
                    </div>
                    <ul className="mt-2 max-h-64 divide-y divide-border overflow-y-auto rounded-xl border border-border" aria-label="Recordings">
                      {visible.map(recording => {
                        const checked = picked.includes(recording.id);
                        const id = `pack-recording-${recording.id}`;
                        return (
                          <li key={recording.id} className="flex items-center gap-3 px-3 py-2.5">
                            <Checkbox
                              id={id}
                              checked={checked}
                              disabled={!checked && picked.length >= MAX_RECORDINGS}
                              onCheckedChange={value => toggle(recording.id, value === true)}
                            />
                            <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                              <span className="block truncate text-sm font-medium">{recording.title}</span>
                              <span className="block text-xs text-muted-foreground">{new Date(recording.createdAt).toLocaleDateString()}</span>
                            </label>
                          </li>
                        );
                      })}
                      {visible.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted-foreground">No titles match.</li>}
                    </ul>
                    <p className="mt-2 text-xs tabular-nums text-muted-foreground" aria-live="polite">
                      {picked.length} of up to {MAX_RECORDINGS} selected
                    </p>
                  </>
                )}
              </TabsContent>
            </Tabs>

            <div className="space-y-1.5">
              <Label htmlFor="pack-title">Name <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Input
                id="pack-title"
                value={title}
                onChange={event => setTitle(event.target.value)}
                maxLength={200}
                placeholder={mode === "course" && selectedCourse ? `${selectedCourse.name} exam pack` : "Midterm revision"}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={!canSubmit}>Make exam pack</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
