import { View } from "react-native";
import { AlertCircle } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/misc";
import { Text } from "@/components/ui/Text";
import { rowErrorText } from "@/lib/sources/errors";
import { rowPercent, stageSentence, type UploadRow } from "@/lib/sources/pipeline";
import { useSourceUploads } from "@/lib/sources/UploadsProvider";
import { useTheme } from "@/theme/tokens";

function UploadRowView({ row }: { row: UploadRow }) {
  const theme = useTheme();
  const { retry, remove } = useSourceUploads();
  const percent = rowPercent(row);
  const sentence = stageSentence(row);
  const failed = row.stage === "error";
  const working = !failed && row.stage !== "done";
  return (
    <View className="gap-2 rounded-xl border border-border bg-card p-4">
      <Text variant="subheading" numberOfLines={2}>
        {row.name}
      </Text>
      {failed && row.error ? (
        <View className="flex-row items-start gap-2">
          <AlertCircle size={16} color={theme.destructive} />
          <Text variant="small" className="flex-1 text-destructive" accessibilityLiveRegion="polite">
            {rowErrorText(row.error)}
          </Text>
        </View>
      ) : (
        <Text variant="small" className="text-muted-foreground" accessibilityLiveRegion="polite">
          {sentence}
        </Text>
      )}
      {working && percent !== null ? <ProgressBar value={percent / 100} label={`${row.name}, ${sentence}, ${percent} percent`} /> : null}
      <View className="flex-row gap-2">
        {failed && row.canRetry ? <Button label="Retry" variant="outline" size="sm" className="min-h-[44px]" onPress={() => retry(row.id)} accessibilityLabel={`Retry ${row.name}`} /> : null}
        {row.stage !== "done" ? (
          <Button
            label={failed ? "Dismiss" : "Cancel"}
            variant="ghost"
            size="sm"
            className="min-h-[44px]"
            onPress={() => remove(row.id)}
            accessibilityLabel={`${failed ? "Dismiss" : "Cancel"} ${row.name}`}
          />
        ) : null}
      </View>
    </View>
  );
}

/** Files going up or being read right now, above the library. Only this course's, or all when no course is given. */
export function UploadRows({ courseId }: { courseId?: number }) {
  const { rows } = useSourceUploads();
  const shown = rows.filter((row) => (courseId === undefined || row.courseId === courseId) && !(row.id.startsWith("resume-") && row.stage === "done"));
  if (shown.length === 0) return null;
  return (
    <View className="gap-3">
      {shown.map((row) => (
        <UploadRowView key={row.id} row={row} />
      ))}
    </View>
  );
}
