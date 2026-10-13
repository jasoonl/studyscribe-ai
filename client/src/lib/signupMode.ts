import { trpc } from "@/lib/trpc";

/**
 * Where "Get started" should go. With open sign-up on (an admin switch), it is
 * the sign-up form and reads "Sign up free"; otherwise it is the access request
 * form. Until the server answers, the invite wording is used, since that is
 * what a closed server says.
 */
export function useSignupMode() {
  const { data } = trpc.signup.mode.useQuery(undefined, { staleTime: 5 * 60_000, retry: false, refetchOnWindowFocus: false });
  const open = data?.openSignup ?? false;
  return {
    open,
    href: open ? "/signup" : "/request-access",
    label: open ? "Sign up free" : "Request access",
  };
}
