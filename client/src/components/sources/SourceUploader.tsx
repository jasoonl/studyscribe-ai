import { useId, useRef, useState } from "react";
import { ClipboardPaste, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UploadRow } from "@/hooks/useSourceUploads";
import { acceptAttribute } from "@/lib/sourceUpload";
import { SOURCE_LIMITS } from "@/lib/sourceModel";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { MAX_SOURCE_LABEL, MAX_SOURCE_TEXT_LABEL } from "@shared/const";
import { SourceUploadRow } from "./SourceUploadRow";

type Props = {
  rows: UploadRow[];
  onFiles: (files: File[]) => void;
  onPaste: () => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
  /** Smaller layout for a library that already has sources. */
  compact?: boolean;
};

/**
 * The drop zone is a labelled button around a hidden multi-file input, so click, Enter and
 * Space all open the picker; dragging files onto it is an extra, not the only way.
 */
export function SourceUploader({ rows, onFiles, onPaste, onRetry, onRemove, disabled, compact }: Props) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [dragging, setDragging] = useState(false);

  return (
    <div className="space-y-3">
      <div
        onDragOver={event => {
          if (disabled) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={event => {
          event.preventDefault();
          setDragging(false);
          if (!disabled) onFiles(Array.from(event.dataTransfer.files));
        }}
        className={cn(
          "rounded-2xl border border-dashed border-border bg-card transition-colors",
          dragging && "border-primary bg-brand-mist",
          compact ? "p-3 sm:p-4" : "p-4 sm:p-6",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          tabIndex={-1}
          accept={acceptAttribute(SOURCE_LIMITS.extensions)}
          aria-label={t("sources.upload.chooseFiles")}
          onChange={event => {
            onFiles(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
        <div className={cn("flex gap-3", compact ? "flex-col sm:flex-row sm:items-center" : "flex-col items-center text-center")}>
          <button
            type="button"
            disabled={disabled}
            aria-describedby={hintId}
            onClick={() => inputRef.current?.click()}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
              compact ? "w-full sm:w-auto" : "w-full sm:w-auto",
            )}
          >
            <Upload className="size-4" aria-hidden="true" />
            {t("sources.upload.button")}
          </button>
          <Button type="button" variant="outline" className="min-h-11 w-full gap-2 sm:w-auto" disabled={disabled} onClick={onPaste}>
            <ClipboardPaste className="size-4" aria-hidden="true" />
            {t("sources.paste.open")}
          </Button>
          <p id={hintId} className="text-sm text-muted-foreground sm:min-w-0">
            {t("sources.upload.hint", { size: MAX_SOURCE_LABEL, textSize: MAX_SOURCE_TEXT_LABEL })}
          </p>
        </div>
      </div>

      {rows.length > 0 && (
        <ul className="space-y-2" aria-label={t("sources.upload.listLabel")}>
          {rows.map(row => (
            <SourceUploadRow key={row.id} row={row} onRetry={onRetry} onRemove={onRemove} />
          ))}
        </ul>
      )}
    </div>
  );
}
