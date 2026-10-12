import { courseDotClass } from "@/lib/courseColors";
import { cn } from "@/lib/utils";

/** The small colour marker used beside course and tag names. Decorative: the name always sits next to it. */
export function CourseDot({ color, className }: { color: unknown; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", courseDotClass(color), className)} />;
}
