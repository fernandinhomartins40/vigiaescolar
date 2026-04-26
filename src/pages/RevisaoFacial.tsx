import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Eye, RefreshCw, ScanFace } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTenantResourceKeyFactory } from "@/context/auth-context";
import { listBiometricEvents } from "@/lib/resources";

type MatchFilter = "REVIEW_REQUIRED" | "UNMATCHED" | "MATCHED";

function eventLabel(type: string) {
  if (type === "ENTRY") return "Entrada";
  if (type === "EXIT") return "Saida";
  return "Desconhecido";
}

function confidenceLabel(value?: number | null) {
  if (value === null || value === undefined) return "0%";
  return `${Math.round(value * 100)}%`;
}

export default function RevisaoFacial() {
  const keys = useTenantResourceKeyFactory();
  const [matchStatus, setMatchStatus] = useState<MatchFilter>("REVIEW_REQUIRED");

  const eventsQuery = useQuery({
    queryKey: [...keys.biometricReferences, "events", matchStatus] as const,
    queryFn: () => listBiometricEvents({ matchStatus }),
    refetchInterval: 30_000,
  });

  const events = eventsQuery.data ?? [];

  return (
    <>
      <PageHeader
        title="Revisao Facial"
        subtitle="Fila operacional de reconhecimentos incertos, desconhecidos e aprovados"
        breadcrumb={[{ label: "Inicio", href: "/" }, { label: "Revisao Facial" }]}
        actions={
          <div className="flex items-center gap-2">
            <Select value={matchStatus} onValueChange={(value) => setMatchStatus(value as MatchFilter)}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="REVIEW_REQUIRED">Em revisao</SelectItem>
                <SelectItem value="UNMATCHED">Desconhecidos</SelectItem>
                <SelectItem value="MATCHED">Reconhecidos</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => eventsQuery.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Atualizar
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="glass-card p-4">
          <div className="flex items-center gap-2 text-xs font-display tracking-widest text-muted-foreground">
            <AlertTriangle className="h-4 w-4 text-warning" />
            EVENTOS NA FILA
          </div>
          <div className="mt-2 font-display text-3xl font-bold">{events.length}</div>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center gap-2 text-xs font-display tracking-widest text-muted-foreground">
            <ScanFace className="h-4 w-4 text-primary" />
            FILTRO ATUAL
          </div>
          <div className="mt-2 font-display text-xl font-bold">{matchStatus}</div>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center gap-2 text-xs font-display tracking-widest text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-secondary" />
            ATUALIZACAO
          </div>
          <div className="mt-2 text-sm text-muted-foreground">{eventsQuery.isFetching ? "Sincronizando..." : "A cada 30 segundos"}</div>
        </div>
      </div>

      <div className="mt-4 glass-card p-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold tracking-wide">EVENTOS FACIAIS</h2>
          <Eye className="h-4 w-4 text-primary" />
        </div>

        <div className="space-y-3">
          {events.map((event) => (
            <article key={event.id} className="rounded-lg border border-primary/15 bg-background/50 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-lg font-semibold">
                      {event.student?.name || "Rosto desconhecido"}
                    </h3>
                    <StatusBadge variant={event.matchStatus === "MATCHED" ? "ok" : event.matchStatus === "REVIEW_REQUIRED" ? "atencao" : "alerta"}>
                      {event.matchStatus}
                    </StatusBadge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {eventLabel(event.type)} - {event.school?.name || "Escola nao informada"} - {event.camera?.name || "Camera nao informada"}
                  </p>
                  {event.reviewReason && <p className="mt-2 text-xs text-warning">{event.reviewReason}</p>}
                </div>
                <div className="shrink-0 text-left md:text-right">
                  <div className="font-display text-xl font-bold text-primary">{confidenceLabel(event.confidence)}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(event.recognizedAt).toLocaleString("pt-BR")}
                  </div>
                </div>
              </div>
            </article>
          ))}

          {!events.length && !eventsQuery.isLoading && (
            <div className="rounded-lg border border-dashed border-primary/20 p-8 text-center text-sm text-muted-foreground">
              Nenhum evento encontrado para este filtro.
            </div>
          )}

          {eventsQuery.isLoading && <div className="text-sm text-muted-foreground">Carregando eventos...</div>}
        </div>
      </div>
    </>
  );
}
