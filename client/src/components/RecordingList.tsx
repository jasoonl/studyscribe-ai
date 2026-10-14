import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import SwipeRow from "@/components/reactbits/SwipeRow";
import FuseButton from "@/components/reactbits/FuseButton";
import { CourseDot } from "@/components/CourseDot";
import { RecordingOrganizer } from "@/components/RecordingOrganizer";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon } from "@hugeicons/core-free-icons";

export type LibraryRecording = {
  id: number;
  title: string;
  audience: "student" | "professional" | null;
  createdAt: Date | string;
  courseId: number | null;
  tagIds: number[];
};

type Course = { id: number; name: string; color: string };
type Tag = { id: number; name: string; color: string | null };

type Props = {
  recordings: LibraryRecording[];
  courses: Course[] | undefined;
  tags: Tag[] | undefined;
  onDelete: (id: number) => void;
  /** Show each recording's course beside its date. Off on a course page, where it would repeat. */
  showCourse?: boolean;
};

/** The library rows, shared by the dashboard and the course page. */
export function RecordingList({ recordings, courses, tags, onDelete, showCourse = true }: Props) {
  const courseById = new Map((courses ?? []).map(course => [course.id, course]));
  const tagById = new Map((tags ?? []).map(tag => [tag.id, tag]));

  return (
    <div>
      {recordings.map(recording => {
        const course = recording.courseId !== null ? courseById.get(recording.courseId) : undefined;
        const recordingTags = recording.tagIds.map(id => tagById.get(id)).filter((tag): tag is Tag => Boolean(tag));
        return (
          <SwipeRow
            key={recording.id}
            label={`Recording ${recording.title}`}
            height={88}
            radius={16}
            rowColor="var(--card)"
            textColor="var(--foreground)"
            drawerColor="#b91c1c"
            actionColor="#dc2626"
            actions={[{ id: "trash", label: "Trash" }]}
            onCommit={() => onDelete(recording.id)}
            className="rounded-2xl ring-1 ring-border/60"
            style={{ marginBottom: 12 }}
          >
            <div className="min-w-0 flex-1">
              <Link href={`/recording/${recording.id}`}>
                <h3 className="cursor-pointer truncate font-semibold hover:text-primary">{recording.title}</h3>
              </Link>
              <p className="truncate text-sm text-muted-foreground">
                {new Date(recording.createdAt).toLocaleDateString()}
                <span className="capitalize"> · {recording.audience}</span>
              </p>
              <div className="mt-0.5 flex min-w-0 items-center gap-x-3 overflow-hidden whitespace-nowrap text-xs text-muted-foreground [mask-image:linear-gradient(to_right,black_88%,transparent)]">
                {showCourse && course && (
                  <Link href={`/courses/${course.id}`} className="flex min-w-0 items-center gap-1.5 hover:text-foreground">
                    <CourseDot color={course.color} />
                    <span className="truncate">{course.name}</span>
                  </Link>
                )}
                {recordingTags.slice(0, 3).map(tag => (
                  <span key={tag.id} className="flex shrink-0 items-center gap-1.5">
                    <CourseDot color={tag.color} className="size-1.5" />
                    {tag.name}
                  </span>
                ))}
                {recordingTags.length > 3 && <span className="shrink-0">+{recordingTags.length - 3}</span>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <RecordingOrganizer recordingId={recording.id} courseId={recording.courseId} tagIds={recording.tagIds} />
              <Link href={`/recording/${recording.id}`} className="hidden sm:block">
                <Button size="sm" variant="outline">View</Button>
              </Link>
              <FuseButton
                label="Delete"
                undoLabel="Undo"
                doneLabel="Moved to trash"
                icon={<HugeiconsIcon icon={Delete02Icon} size={14} strokeWidth={1.8} />}
                size="sm"
                radius={18}
                color="#ffffff"
                background="var(--destructive)"
                fuseColor="#fde68a"
                commitOn="fuseEnd"
                settle="stay"
                undoWindow={4000}
                onCommit={() => onDelete(recording.id)}
              />
            </div>
          </SwipeRow>
        );
      })}
    </div>
  );
}
