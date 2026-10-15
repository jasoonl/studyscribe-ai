import { forwardRef, useId, useImperativeHandle, useMemo, useRef, useState, type ComponentProps, type KeyboardEvent } from "react";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { t, useI18n } from "@/i18n";
import { activeMentionQuery, filterCandidates, splitMentions, type MentionCandidate } from "@shared/mentions";

export type MentionPerson = MentionCandidate & { isYou?: boolean };

/** People who can be @mentioned on a recording (everyone who can read its comments). */
export function useMentionCandidates(recordingId: number, enabled: boolean): MentionPerson[] {
  const { data } = trpc.annotations.mentionable.useQuery({ recordingId }, { enabled: enabled && recordingId > 0, retry: false, staleTime: 60_000 });
  return data ?? [];
}

/** A comment body with @mentions of known people set in medium weight. */
export function MentionText({ body, people, className }: { body: string; people: MentionPerson[]; className?: string }) {
  const parts = useMemo(() => splitMentions(body, people.map(person => person.name)), [body, people]);
  return (
    <p className={className}>
      {parts.map((part, index) =>
        part.mention ? (
          <span key={index} className="font-medium text-primary">
            {part.text}
          </span>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </p>
  );
}

type Props = Omit<ComponentProps<typeof Textarea>, "value" | "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
  people: MentionPerson[];
  /** Called for Cmd/Ctrl+Enter while no suggestion list is open. */
  onSubmitShortcut?: () => void;
};

/**
 * A textarea that suggests people after "@". Arrow keys move through the
 * list, Enter or Tab picks, Escape closes it (without closing what the
 * textarea sits in). Follows the ARIA combobox pattern with a listbox.
 */
export const MentionTextarea = forwardRef<HTMLTextAreaElement, Props>(function MentionTextarea({ value, onValueChange, people, onSubmitShortcut, onKeyDown, className, ...rest }, ref) {
  useI18n();
  const inner = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => inner.current as HTMLTextAreaElement);
  const listId = useId();
  const [caret, setCaret] = useState(0);
  const [highlighted, setHighlighted] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  const query = activeMentionQuery(value, caret);
  const choices = useMemo(() => (query ? filterCandidates(people.filter(person => !person.isYou), query.query) : []), [people, query?.query, query?.start]);
  const open = Boolean(query && choices.length > 0 && dismissedAt !== query.start);
  const active = Math.min(highlighted, Math.max(choices.length - 1, 0));

  const pick = (person: MentionCandidate) => {
    if (!query) return;
    const before = value.slice(0, query.start);
    const after = value.slice(caret);
    const inserted = `@${person.name} `;
    const next = before + inserted + after.replace(/^\s+/, "");
    onValueChange(next);
    const position = before.length + inserted.length;
    requestAnimationFrame(() => {
      inner.current?.focus();
      inner.current?.setSelectionRange(position, position);
      setCaret(position);
    });
    setHighlighted(0);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setHighlighted((active + step + choices.length) % choices.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pick(choices[active]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setDismissedAt(query!.start);
        return;
      }
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && onSubmitShortcut) {
      event.preventDefault();
      onSubmitShortcut();
      return;
    }
    onKeyDown?.(event);
  };

  return (
    <div className="relative w-full">
      <Textarea
        ref={inner}
        value={value}
        onChange={event => {
          onValueChange(event.target.value);
          setCaret(event.target.selectionStart ?? event.target.value.length);
          setHighlighted(0);
        }}
        onSelect={event => setCaret(event.currentTarget.selectionStart ?? 0)}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${choices[active]?.id}` : undefined}
        className={className}
        {...rest}
      />
      {open && (
        <ul id={listId} role="listbox" aria-label={t("transcript.mentionList")} className="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg">
          {choices.map((person, index) => (
            <li
              key={person.id}
              id={`${listId}-${person.id}`}
              role="option"
              aria-selected={index === active}
              className={cn("cursor-pointer truncate rounded-md px-2.5 py-1.5", index === active && "bg-accent text-accent-foreground")}
              onMouseDown={event => {
                event.preventDefault();
                pick(person);
              }}
              onMouseEnter={() => setHighlighted(index)}
            >
              {person.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
