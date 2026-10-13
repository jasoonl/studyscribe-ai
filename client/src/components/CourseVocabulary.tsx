import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

/**
 * A course's own vocabulary: names and terms used for every recording filed
 * under the course when it is transcribed (between the recording's own terms
 * and the standing list in Settings).
 */
export function CourseVocabulary({ courseId }: { courseId: number }) {
  const id = useId();
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.vocabulary.getCourse.useQuery({ courseId }, { enabled: courseId > 0, retry: false });
  const [value, setValue] = useState("");
  const [dirty, setDirty] = useState(false);
  const save = trpc.vocabulary.saveCourse.useMutation({
    onSuccess: async result => {
      setValue(result.terms.join("\n"));
      setDirty(false);
      await utils.vocabulary.getCourse.invalidate({ courseId });
      toast.success(result.terms.length ? `Saved ${result.terms.length} term${result.terms.length === 1 ? "" : "s"}` : "Course vocabulary cleared");
    },
    onError: error => toast.error(error.message || "Could not save the course vocabulary"),
  });

  useEffect(() => {
    if (data && !dirty) setValue(data.terms.join("\n"));
  }, [data, dirty]);

  if (isLoading || !data) return null;
  if (!data.available) return null;

  return (
    <section aria-labelledby={`${id}-heading`} className="mt-10 rounded-xl border border-border bg-card p-5 shadow-sm">
      <h2 id={`${id}-heading`} className="text-base font-semibold">Course vocabulary</h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        Names and terms to listen for in every recording filed under this course. Recordings started from this course, or retried after you file them here, use them.
      </p>
      <form
        className="mt-4 space-y-3"
        onSubmit={event => {
          event.preventDefault();
          save.mutate({ courseId, terms: value });
        }}
      >
        <Label htmlFor={id} className="sr-only">
          Course vocabulary, one per line
        </Label>
        <Textarea
          id={id}
          value={value}
          onChange={event => {
            setValue(event.target.value);
            setDirty(true);
          }}
          placeholder={"Prof. Okafor\nKrebs cycle\nATP synthase"}
          rows={4}
          className="resize-y text-sm"
          aria-describedby={`${id}-hint`}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            One per line, up to six words each, {data.max} at most.
          </p>
          <Button type="submit" size="sm" disabled={!dirty || save.isPending}>
            {save.isPending ? "Saving…" : "Save vocabulary"}
          </Button>
        </div>
      </form>
    </section>
  );
}
