import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  CalendarDays,
  CheckCircle2,
  Download,
  History,
  Home,
  Loader2,
  LogOut,
  RefreshCw,
  Share,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth, useTenantResourceKeyFactory } from "@/context/auth-context";
import type { GuardianPortalChild } from "@/lib/domain";
import { getGuardianPortal } from "@/lib/resources";
import { cn } from "@/lib/utils";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type TabId = "hoje" | "historico" | "alertas";

const tabs: Array<{ id: TabId; label: string; icon: typeof Home }> = [
  { id: "hoje", label: "Hoje", icon: Home },
  { id: "historico", label: "Historico", icon: History },
  { id: "alertas", label: "Alertas", icon: Bell },
];

function isStandaloneMode() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

function isIosDevice() {
  if (typeof window === "undefined") return false;
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

function childStatus(child: GuardianPortalChild) {
  if (child.presencaHoje === "presente") {
    return { label: "Na escola", className: "bg-secondary text-secondary-foreground" };
  }
  if (child.presencaHoje === "atrasado") {
    return { label: "Atrasado", className: "bg-warning text-warning-foreground" };
  }
  if (child.presencaHoje === "saiu") {
    return { label: "Saiu", className: "bg-muted text-muted-foreground" };
  }
  return { label: "Sem entrada", className: "bg-destructive text-destructive-foreground" };
}

export default function PWA() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const keys = useTenantResourceKeyFactory();
  const [activeTab, setActiveTab] = useState<TabId>("hoje");
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(isStandaloneMode);
  const isGuardian = user?.role === "responsavel";
  const isIos = isIosDevice();

  const portalQuery = useQuery({
    queryKey: keys.guardianPortal,
    queryFn: getGuardianPortal,
    enabled: isGuardian,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setInstallPrompt(null);
      setStandalone(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const portal = portalQuery.data;
  const latestChild = useMemo(() => {
    if (!portal?.latestEvent) return undefined;
    return portal.children.find((child) => child.id === portal.latestEvent?.alunoId);
  }, [portal]);

  const handleInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  if (!isGuardian) {
    return (
      <main className="min-h-screen bg-background px-5 py-8 text-foreground">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md flex-col justify-center">
          <div className="rounded-lg border border-warning/35 bg-warning/10 p-5">
            <TriangleAlert className="h-8 w-8 text-warning" />
            <h1 className="mt-4 font-display text-2xl font-semibold">Portal do responsavel</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Este painel e separado da administracao e deve ser acessado com uma conta do tipo responsavel.
            </p>
            <Button className="mt-5 w-full" onClick={handleSignOut}>
              Entrar com outra conta
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col">
        <header className="sticky top-0 z-30 border-b border-primary/10 bg-background/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/30 bg-primary/10">
              <ShieldCheck className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">VigiaEscolar</p>
              <h1 className="truncate font-display text-xl font-semibold">
                Ola, {portal?.guardian.nome || user?.nome || "Responsavel"}
              </h1>
            </div>
            <Button variant="ghost" size="icon" onClick={() => portalQuery.refetch()} title="Atualizar">
              {portalQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={handleSignOut} title="Sair">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <section className="flex-1 px-4 py-4">
          {!standalone && (
            <div className="mb-4 rounded-lg border border-primary/20 bg-card/80 p-4">
              <div className="flex items-start gap-3">
                <Smartphone className="mt-0.5 h-5 w-5 text-primary" />
                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-lg font-semibold">Instalar app</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Use este portal como aplicativo no celular, com acesso rapido pela tela inicial.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {installPrompt && (
                      <Button size="sm" onClick={handleInstall}>
                        <Download className="mr-2 h-4 w-4" />
                        Instalar
                      </Button>
                    )}
                    {isIos && (
                      <div className="inline-flex items-center gap-2 rounded-md border border-primary/20 px-3 py-2 text-xs text-muted-foreground">
                        <Share className="h-3.5 w-3.5 text-primary" />
                        Safari: Compartilhar, Adicionar a Tela de Inicio
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {portalQuery.isLoading && (
            <div className="flex min-h-[50vh] items-center justify-center">
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                Carregando painel do responsavel
              </div>
            </div>
          )}

          {portalQuery.isError && (
            <div className="rounded-lg border border-destructive/35 bg-destructive/10 p-5">
              <TriangleAlert className="h-7 w-7 text-destructive" />
              <h2 className="mt-3 font-display text-xl font-semibold">Nao foi possivel abrir o portal</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {portalQuery.error instanceof Error ? portalQuery.error.message : "Falha ao buscar dados do responsavel."}
              </p>
              <Button className="mt-4" onClick={() => portalQuery.refetch()}>
                Tentar novamente
              </Button>
            </div>
          )}

          {portal && (
            <>
              {portal.latestEvent && latestChild && (
                <div className="mb-4 rounded-lg border border-secondary/30 bg-secondary/10 p-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 text-secondary" />
                    <div className="min-w-0">
                      <h2 className="font-display text-lg font-semibold text-secondary">
                        {latestChild.nome.split(" ")[0]} {portal.latestEvent.tipo === "Entrou" ? "chegou na escola" : "saiu da escola"}
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {latestChild.escolaNome} as {portal.latestEvent.horario}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "hoje" && (
                <div className="space-y-4">
                  {portal.children.length === 0 && (
                    <div className="rounded-lg border border-primary/20 bg-card/80 p-5 text-sm text-muted-foreground">
                      Nenhum aluno vinculado a esta conta.
                    </div>
                  )}

                  {portal.children.map((child) => {
                    const status = childStatus(child);
                    return (
                      <article key={child.id} className="rounded-lg border border-primary/15 bg-card/80 p-4">
                        <div className="flex items-center gap-3">
                          <img
                            src={child.foto}
                            alt=""
                            className="h-14 w-14 rounded-full border border-primary/25 bg-muted object-cover"
                          />
                          <div className="min-w-0 flex-1">
                            <h2 className="truncate font-display text-xl font-semibold">{child.nome}</h2>
                            <p className="truncate text-sm text-muted-foreground">
                              {child.turma} - {child.escolaNome}
                            </p>
                          </div>
                          <span className={cn("shrink-0 rounded px-2 py-1 text-xs font-semibold", status.className)}>
                            {status.label}
                          </span>
                        </div>

                        <div className="mt-4 space-y-3 border-l border-primary/25 pl-4">
                          {child.timeline.map((item, index) => (
                            <div key={`${child.id}-${item.horario}-${index}`} className="relative">
                              <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <CalendarDays className="h-3.5 w-3.5" />
                                {item.horario}
                              </div>
                              <p className="mt-1 text-sm">{item.descricao}</p>
                            </div>
                          ))}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}

              {activeTab === "historico" && (
                <div className="space-y-3">
                  {portal.children.flatMap((child) =>
                    child.timeline.map((item, index) => (
                      <div key={`${child.id}-history-${index}`} className="rounded-lg border border-primary/15 bg-card/80 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <h2 className="truncate font-display text-lg font-semibold">{child.nome}</h2>
                            <p className="text-sm text-muted-foreground">{item.descricao}</p>
                          </div>
                          <span className="rounded bg-muted px-2 py-1 font-mono text-xs">{item.horario}</span>
                        </div>
                      </div>
                    )),
                  )}
                </div>
              )}

              {activeTab === "alertas" && (
                <div className="space-y-3">
                  {portal.recentNotifications.length === 0 && (
                    <div className="rounded-lg border border-primary/20 bg-card/80 p-5 text-sm text-muted-foreground">
                      Nenhuma notificacao recente.
                    </div>
                  )}

                  {portal.recentNotifications.map((notification) => {
                    const child = portal.children.find((item) => item.id === notification.alunoId);
                    return (
                      <div key={notification.id} className="rounded-lg border border-primary/15 bg-card/80 p-4">
                        <div className="flex items-start gap-3">
                          <Bell className="mt-0.5 h-5 w-5 text-primary" />
                          <div className="min-w-0 flex-1">
                            <h2 className="font-display text-lg font-semibold">{notification.tipo}</h2>
                            <p className="text-sm text-muted-foreground">
                              {child?.nome || "Aluno"} - {notification.canal} - {notification.horario}
                            </p>
                          </div>
                          <span className="rounded bg-muted px-2 py-1 text-xs">{notification.status}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </section>

        <nav className="sticky bottom-0 z-30 grid grid-cols-3 border-t border-primary/10 bg-background/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex min-h-12 flex-col items-center justify-center gap-1 text-xs font-medium transition",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="h-5 w-5" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>
    </main>
  );
}
