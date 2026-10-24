import { useMemo, useState } from "react";
import { View } from "react-native";
import { Segmented } from "@/components/ui/Segmented";
import { Text } from "@/components/ui/Text";
import { filterFlags, type SourceFlag } from "@/lib/sources/model";
import { FlagCard } from "./FlagCard";

/** "Likely on a test" by default, with a switch to every detail found. */
export function LikelyOnTestTab({ flags, onOpen }: { flags: SourceFlag[]; onOpen: (flag: SourceFlag) => void }) {
  const [filter, setFilter] = useState<"test" | "all">("test");
  const shown = useMemo(() => filterFlags(flags, filter), [flags, filter]);
  return (
    <View className="gap-4">
      <Segmented
        label="Which details to show"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "test", label: "Likely on a test" },
          { value: "all", label: "Show all details" },
        ]}
      />
      <Text variant="muted" accessibilityLiveRegion="polite">
        {shown.length === 1 ? "1 detail" : `${shown.length} details`}
      </Text>
      {shown.length === 0 ? (
        <View className="rounded-xl border border-dashed border-border px-5 py-8">
          <Text variant="muted" className="text-center">
            {flags.length === 0 ? "No key details were found in this file." : "Nothing here looks likely to be on a test. Show all details to see everything found."}
          </Text>
        </View>
      ) : (
        shown.map((flag) => <FlagCard key={flag.id} flag={flag} onOpen={onOpen} />)
      )}
    </View>
  );
}
