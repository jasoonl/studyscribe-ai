import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { QueryCache, QueryClient, QueryClientProvider, MutationCache } from "@tanstack/react-query";
import { createAuthClient } from "./authApi";
import { API_URL } from "./config";
import { createSessionController, type SessionController, type SessionState } from "./session";
import { secureTokenStore } from "./tokenStore";
import { createTrpcClient, isUnauthorized, trpc } from "./trpc";

export const authClient = createAuthClient(API_URL);

const SessionContext = createContext<{ state: SessionState; controller: SessionController } | null>(null);

/**
 * Session + data layer for the whole app: restores the keychain token, gives
 * tRPC the bearer token, and signs out when the API says the session is gone.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const controller = useMemo(() => createSessionController(secureTokenStore, authClient), []);
  const [state, setState] = useState<SessionState>(controller.getState());

  useEffect(() => {
    const unsubscribe = controller.subscribe(setState);
    controller.restore().catch(() => undefined);
    return () => {
      unsubscribe();
    };
  }, [controller]);

  const queryClient = useMemo(() => {
    const onError = (error: unknown) => {
      if (isUnauthorized(error)) controller.expire().catch(() => undefined);
    };
    return new QueryClient({
      queryCache: new QueryCache({ onError }),
      mutationCache: new MutationCache({ onError }),
      defaultOptions: {
        queries: { retry: (count, error) => !isUnauthorized(error) && count < 2, staleTime: 15_000 },
      },
    });
  }, [controller]);

  const trpcClient = useMemo(() => createTrpcClient(() => controller.getToken()), [controller]);

  // A different account must never see the previous one's cached data.
  const userId = state.status === "signedIn" ? state.user.id : null;
  useEffect(() => {
    queryClient.clear();
  }, [userId, queryClient]);

  return (
    <SessionContext.Provider value={{ state, controller }}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </trpc.Provider>
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside SessionProvider");
  return context;
}

/** The signed-in user; only call below the signed-in guard. */
export function useUser() {
  const { state } = useSession();
  if (state.status !== "signedIn") throw new Error("Not signed in");
  return state.user;
}
