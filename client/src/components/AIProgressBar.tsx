import { Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface AIProgressBarProps {
  isLoading: boolean;
  title: string;
  description?: string;
}

export function AIProgressBar({ isLoading, title, description }: AIProgressBarProps) {
  if (!isLoading) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-accent" />
        <span className="text-sm font-medium">{title}</span>
      </div>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      <Progress value={66} className="h-2" />
    </div>
  );
}
