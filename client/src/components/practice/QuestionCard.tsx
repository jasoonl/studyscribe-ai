import { useId } from "react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { PracticeQuestion } from "@/lib/practiceTypes";

/** One question with no hint, no answer and no explanation. Options are large radio rows. */
export function QuestionCard({
  question,
  number,
  total,
  value,
  onChange,
  onBlur,
  disabled,
}: {
  question: PracticeQuestion;
  number: number;
  total: number;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
}) {
  const { t, formatNumber } = useI18n();
  const base = useId();
  const labelId = `${base}-q`;
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-6">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold tabular-nums text-muted-foreground">{t("practice.questionOf", { number: formatNumber(number), total: formatNumber(total) })}</span>
        <Badge variant="outline" className="text-xs">
          {question.type === "multiple-choice" ? t("cards.multipleChoice") : t("quiz.shortAnswer")}
        </Badge>
      </div>
      <p id={labelId} className="mt-3 text-base font-medium leading-relaxed">{question.question}</p>
      <div className="mt-4">
        {question.type === "multiple-choice" && question.options ? (
          <RadioGroup value={value} onValueChange={onChange} onBlur={onBlur} disabled={disabled} aria-labelledby={labelId} className="gap-2">
            {question.options.map((option, index) => {
              const id = `${base}-${index}`;
              return (
                <Label
                  key={id}
                  htmlFor={id}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-3 text-sm font-normal transition-colors",
                    value === option ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50",
                  )}
                >
                  <RadioGroupItem value={option} id={id} />
                  <span className="min-w-0 flex-1 break-words">{option}</span>
                </Label>
              );
            })}
          </RadioGroup>
        ) : (
          <Textarea
            value={value}
            onChange={event => onChange(event.target.value)}
            onBlur={onBlur}
            disabled={disabled}
            aria-labelledby={labelId}
            placeholder={t("quiz.answerPlaceholder")}
            maxLength={2000}
            className="min-h-[110px] resize-none text-base"
          />
        )}
      </div>
    </div>
  );
}
