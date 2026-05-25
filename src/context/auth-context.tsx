import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { clearAuthStorage, getStoredToken, setStoredTenantId, setStoredToken } from "@/lib/api";
import {
  authKeys,
  getSession,
  login,
  logout,
  register,
  resourceKeys,
} from "@/lib/resources";
import type { AuthSession, AuthUser, LoginPayload, RegisterPayload } from "@/lib/domain";

type AuthContextValue = {
  session: AuthSession | null;
  user: AuthUser | null;
  tenantId: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  sessionError: Error | null;
  login: (payload: LoginPayload) => Promise<AuthSession>;
  register: (payload: RegisterPayload) => Promise<AuthSession>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function isApiErrorWithStatus(error: unknown, status: number) {
  return Boolean(error && typeof error === "object" && "status" in error && Number((error as { status?: number }).status) === status);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const sessionQuery = useQuery({
    queryKey: authKeys.session,
    queryFn: getSession,
    retry: false,
    staleTime: 1000 * 60 * 5,
    enabled: Boolean(getStoredToken()),
  });

  useEffect(() => {
    const session = sessionQuery.data ?? null;
    if (session?.accessToken) {
      setStoredToken(session.accessToken);
    }
    if (session?.user.tenantId) {
      setStoredTenantId(session.user.tenantId);
    }
    if (sessionQuery.data === null) {
      clearAuthStorage();
    }
  }, [sessionQuery.data]);

  const syncSession = useCallback(
    async (session: AuthSession) => {
      if (session.accessToken) {
        setStoredToken(session.accessToken);
      }
      if (session.user.tenantId) {
        setStoredTenantId(session.user.tenantId);
      }

      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== "auth",
      });
      queryClient.setQueryData(authKeys.session, session);
      await queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== "auth",
      });
      return session;
    },
    [queryClient],
  );

  const performLogin = useCallback(async (payload: LoginPayload) => syncSession(await login(payload)), [syncSession]);

  const performRegister = useCallback(async (payload: RegisterPayload) => syncSession(await register(payload)), [syncSession]);

  const performLogout = useCallback(async () => {
    try {
      await logout();
    } catch (error) {
      if (!isApiErrorWithStatus(error, 401)) {
        throw error;
      }
    } finally {
      clearAuthStorage();
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== "auth",
      });
      queryClient.setQueryData<AuthSession | null>(authKeys.session, null);
    }
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session: sessionQuery.data ?? null,
      user: sessionQuery.data?.user ?? null,
      tenantId: sessionQuery.data?.user.tenantId ?? null,
      isLoading: sessionQuery.isLoading,
      isAuthenticated: Boolean(sessionQuery.data?.user),
      sessionError: sessionQuery.error instanceof Error ? sessionQuery.error : null,
      login: performLogin,
      register: performRegister,
      signOut: performLogout,
      refreshSession: async () => {
        await queryClient.invalidateQueries({ queryKey: authKeys.session });
      },
    }),
    [performLogin, performRegister, performLogout, queryClient, sessionQuery.data, sessionQuery.error, sessionQuery.isLoading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth deve ser usado dentro de AuthProvider");
  }
  return context;
}

export function useTenantResourceKeyFactory() {
  const { tenantId } = useAuth();
  return useMemo(
    () => ({
      schools: resourceKeys.schools(tenantId),
      turmas: resourceKeys.turmas(tenantId),
      responsibles: resourceKeys.responsibles(tenantId),
      students: resourceKeys.students(tenantId),
      cameras: resourceKeys.cameras(tenantId),
      cameraEvents: resourceKeys.cameraEvents(tenantId),
      biometricReferences: resourceKeys.biometricReferences(tenantId),
      notifications: resourceKeys.notifications(tenantId),
      settings: resourceKeys.settings(tenantId),
      guardianPortal: resourceKeys.guardianPortal(tenantId),
      dashboard: resourceKeys.dashboard(tenantId),
      gateways: resourceKeys.gateways(tenantId),
    }),
    [tenantId],
  );
}
