import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SkeletonList } from "@/components/ui/misc";
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { errorMessage, trpc } from "@/lib/trpc";

/** The standing list of names and terms sent with every transcription (B2). */
export default function VocabularyScreen() {
  const toast = useToast();
  const utils = trpc.useUtils();
  const vocabulary = trpc.vocabulary.get.useQuery({});
  const [text, setText] = useState("");
  const save = trpc.vocabulary.save.useMutation({
    onSuccess: (result) => {
      utils.vocabulary.get.invalidate();
      toast.show(`Saved ${result.terms.length} ${result.terms.length === 1 ? "term" : "terms"}.`, "success");
    },
    onError: (error) => toast.show(errorMessage(error), "error"),
  });

  useEffect(() => {
    if (vocabulary.data) setText(vocabulary.data.terms.join("\n"));
  }, [vocabulary.data]);

  return (
    <Screen edges={["bottom"]}>
      <Text variant="muted">
        Names, course codes and technical words the transcription should expect. One per line, up to six words each. Used for every recording, together with any you add to a single recording.
      </Text>
      {vocabulary.isLoading ? (
        <SkeletonList rows={1} />
      ) : (
        <Input value={text} onChangeText={setText} multiline accessibilityLabel="Custom vocabulary" placeholder={"Krebs cycle\nProfessor Okonkwo\nBIO 201"} style={{ minHeight: 220 }} />
      )}
      <Button label="Save" loading={save.isPending} onPress={() => save.mutate({ terms: text })} />
    </Screen>
  );
}
