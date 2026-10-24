import { capabilitiesFrom } from "@/lib/practiceModel";
import { practiceApi } from "@/lib/practiceTypes";

/**
 * Whether the server has the practice tables and explanations. Until it answers, and when it
 * errors or says no, the practice and explanation controls stay out of sight and quizzes work
 * exactly as before.
 */
export function usePracticeCapabilities() {
  const query = practiceApi.practice.capabilities.useQuery(undefined, { retry: false, refetchOnWindowFocus: false, staleTime: 5 * 60_000 });
  const capabilities = capabilitiesFrom(query.data, query.isError);
  return { ...capabilities, loading: query.isLoading };
}
