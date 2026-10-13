import { useState } from "react";
import { Share, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { GraduationCap } from "lucide-react-native";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, SkeletonList } from "@/components/ui/misc";
import { Screen } from "@/components/ui/Screen";
import { Segmented } from "@/components/ui/Segmented";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { errorMessage, trpc } from "@/lib/trpc";
import { useTheme } from "@/theme/tokens";

type Guide = { id: number; title: string; content: string; keyPoints?: string[] | null; status?: string | null; createdAt: Date | string };

export default function StudyGuideScreen() {
  const recordingId = Number(useLocalSearchParams<{ id: string }>().id);
  const theme = useTheme();
  const toast = useToast();
  const utils = trpc.useUtils();
  const list = trpc.studyGuides.list.useQuery({ recordingId });
  const generate = trpc.studyGuides.generate.useMutation({
    onSuccess: () => utils.studyGuides.list.invalidate({ recordingId }),
    onError: (error) => toast.show(errorMessage(error), "error"),
  });
  const guides = ((list.data ?? []) as Guide[]).filter((guide) => guide.status !== "failed");
  const [selected, setSelected] = useState<string | null>(null);
  const guide = guides.find((item) => String(item.id) === selected) ?? guides[0];

  return (
    <Screen edges={["bottom"]}>
      {list.isLoading ? (
        <SkeletonList rows={3} />
      ) : !guide ? (
        <View className="gap-4">
          <EmptyState icon={<GraduationCap size={22} color={theme.primary} />} title="No study guide yet" body="A guide lays out what to revise from this recording, with the key points first." />
          <Button label="Write a study guide" loading={generate.isPending} onPress={() => generate.mutate({ recordingId })} />
        </View>
      ) : (
        <>
          {guides.length > 1 ? (
            <Segmented label="Study guides" value={String(guide.id)} onChange={setSelected} options={guides.slice(0, 4).map((item, index) => ({ value: String(item.id), label: index === 0 ? "Latest" : `Version ${guides.length - index}` }))} />
          ) : null}
          <Text variant="title">{guide.title}</Text>
          {guide.keyPoints?.length ? (
            <Card className="gap-2 bg-brand-mist">
              <Text variant="label" className="text-primary">
                Key points
              </Text>
              {guide.keyPoints.map((point) => (
                <View key={point} className="flex-row gap-2">
                  <Text variant="body" className="text-primary">
                    •
                  </Text>
                  <Text variant="body" className="flex-1">
                    {point}
                  </Text>
                </View>
              ))}
            </Card>
          ) : null}
          <Card>
            <Markdown source={guide.content} />
          </Card>
          <View className="flex-row gap-3">
            <Button className="flex-1" label="Share" variant="outline" onPress={() => Share.share({ title: guide.title, message: `${guide.title}\n\n${guide.content}` })} />
            <Button className="flex-1" label="Write a new one" variant="outline" loading={generate.isPending} onPress={() => generate.mutate({ recordingId })} />
          </View>
        </>
      )}
    </Screen>
  );
}
