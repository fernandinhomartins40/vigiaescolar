import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/auth-context";

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="glass-card flex items-center gap-3 px-5 py-4">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <div>
          <div className="text-sm font-semibold">Carregando sessão</div>
          <div className="text-xs text-muted-foreground">Validando autenticação real</div>
        </div>
      </div>
    </div>
  );
}

function SessionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="glass-card max-w-md p-6 text-center">
        <TriangleAlert className="mx-auto h-10 w-10 text-warning" />
        <h2 className="mt-4 text-xl font-display font-semibold">Falha ao validar a sessão</h2>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <Button className="mt-5 bg-primary text-primary-foreground hover:bg-primary/90" onClick={onRetry}>
          Tentar novamente
        </Button>
      </div>
    </div>
  );
}

export function RequireAuth() {
  const { isLoading, isAuthenticated, sessionError, refreshSession } = useAuth();

  if (isLoading) {
    return <FullScreenLoader />;
  }

  if (sessionError && !("status" in sessionError && Number((sessionError as { status?: number }).status) === 401)) {
    return <SessionError message={sessionError.message || "Não foi possível falar com a API."} onRetry={refreshSession} />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

export function PublicOnlyRoute() {
  const { isLoading, isAuthenticated } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <FullScreenLoader />;
  }

  if (isAuthenticated) {
    const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || "/";
    return <Navigate to={from} replace />;
  }

  return <Outlet />;
}
