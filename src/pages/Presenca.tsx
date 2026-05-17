import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Download,
  Eye,
  MessageCircle,
  RefreshCw,
  ScanFace,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTenantResourceKeyFactory } from "@/context/auth-context";
import type { StudentPresence } from "@/lib/domain";
import { formatWhatsAppLink } from "@/lib/whatsapp";
import { listBiometricEvents, listPresence, listResponsibles, listSchools, updatePresence } from "@/lib/resources";
import { cn } from "@/lib/utils";

type PresencaTab = "presenca" | "revisao-facial";
type MatchFilter = "REVIEW_REQUIRED" | "UNMATCHED" | "MATCHED";

// ─── Aba: Presença do dia ─────────────────────────────────────────────────────

function TabPresenca() {
  const queryClient = useQueryClient();
  const keys = useTenantResourceKeyFactory();
  const [escolaId, setEscolaId] = useState("");
  const [turma, setTurma] = useState<string>("all");
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));

  const schoolsQuery = useQuery({ queryKey: keys.schools, queryFn: listSchools });

  useEffect(() => {
    if (!escolaId && schoolsQuery.data?.[0]?.id) setEscolaId(schoolsQuery.data[0].id);
  }, [escolaId, schoolsQuery.data]);

  const presenceQuery = useQuery({
    queryKey: [...keys.students, escolaId, turma, data] as const,
    queryFn: () => listPresence({ schoolId: escolaId, date: data, turma: turma === "all" ? undefined : turma }),
    enabled: Boolean(escolaId),
  });

  const responsiblesQuery = useQuery({ queryKey: keys.responsibles, queryFn: listResponsibles });

  const updateMutation = useMutation({
    mutationFn: async ({ studentId, status }: { studentId: string; status: StudentPresence }) =>
      updatePresence(studentId, { presencaHoje: status }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.students });
      await queryClient.invalidateQueries({ queryKey: keys.cameraEvents });
      await queryClient.invalidateQueries({ queryKey: [...keys.students, escolaId, turma, data] });
      toast.success("Presença atualizada");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Falha ao atualizar presença"),
  });

  const turmas = useMemo(
    () => Array.from(new Set((presenceQuery.data ?? []).map((student) => student.turma))),
    [presenceQuery.data],
  );

  const list = presenceQuery.data ?? [];
  const presentes = list.filter((s) => s.presencaHoje === "presente").length;
  const atrasados = list.filter((s) => s.presencaHoje === "atrasado").length;
  const ausentes = list.filter((s) => s.presencaHoje === "ausente").length;

  return (
    <div className="space-y-4">
      <div className="glass-card p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <Select value={escolaId} onValueChange={setEscolaId}>
          <SelectTrigger><SelectValue placeholder="Selecione a escola" /></SelectTrigger>
          <SelectContent>
            {schoolsQuery.data?.map((school) => (
              <SelectItem key={school.id} value={school.id}>{school.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={turma} onValueChange={setTurma}>
          <SelectTrigger><SelectValue placeholder="Turma" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as turmas</SelectItem>
            {turmas.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="glass-card p-4 text-center">
          <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Presentes</div>
          <div className="text-3xl font-bold text-green-700">{presentes}</div>
        </div>
        <div className="glass-card p-4 text-center">
          <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Atrasados</div>
          <div className="text-3xl font-bold text-amber-700">{atrasados}</div>
        </div>
        <div className="glass-card p-4 text-center">
          <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Ausentes</div>
          <div className="text-3xl font-bold text-destructive">{ausentes}</div>
        </div>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted border-b border-border">
              <tr className="text-left font-medium text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Aluno</th>
                <th className="px-4 py-3">Turma</th>
                <th className="px-4 py-3">Entrada</th>
                <th className="px-4 py-3">Saída</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-center">Notificado</th>
                <th className="px-4 py-3">Alterar status</th>
                <th className="px-4 py-3 text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {list.map((student) => {
                const responsible = responsiblesQuery.data?.find((item) => item.id === student.responsavelPrincipalId);
                const link = responsible
                  ? formatWhatsAppLink(responsible.whatsapp, `Atualização sobre ${student.nome.split(" ")[0]}: status ${student.presencaHoje}.`)
                  : undefined;
                const notificado = student.presencaHoje !== "ausente";

                return (
                  <tr key={student.id} className="border-b border-border hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <img src={student.foto} alt={student.nome} className="h-8 w-8 rounded-full bg-muted border border-border object-cover" />
                        <span className="font-medium">{student.nome}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{student.turma}</td>
                    <td className="px-4 py-3 font-mono">{student.horarioEntrada || "—"}</td>
                    <td className="px-4 py-3 font-mono">{student.horarioSaida || "—"}</td>
                    <td className="px-4 py-3">
                      <StatusBadge variant={student.presencaHoje as StudentPresence} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      {notificado ? <Check className="h-4 w-4 text-green-700 inline" /> : <X className="h-4 w-4 text-destructive inline" />}
                    </td>
                    <td className="px-4 py-3">
                      <Select
                        value={student.presencaHoje}
                        onValueChange={(value) => updateMutation.mutate({ studentId: student.id, status: value as StudentPresence })}
                      >
                        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["presente", "atrasado", "ausente", "saiu"].map((value) => (
                            <SelectItem key={value} value={value}>{value}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {link && (
                        <a href={link} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-green-700 border border-green-200 bg-green-50 hover:bg-green-100 rounded-md px-2 py-1">
                          <MessageCircle className="h-3 w-3" />
                          WhatsApp
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
              {list.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                    Nenhum aluno encontrado para essa seleção.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Aba: Revisão Facial ──────────────────────────────────────────────────────

function TabRevisaoFacial() {
  const keys = useTenantResourceKeyFactory();
  const [matchStatus, setMatchStatus] = useState<MatchFilter>("REVIEW_REQUIRED");

  const eventsQuery = useQuery({
    queryKey: [...keys.biometricReferences, "events", matchStatus] as const,
    queryFn: () => listBiometricEvents({ matchStatus }),
    refetchInterval: 30_000,
  });

  const events = eventsQuery.data ?? [];

  function eventLabel(type: string) {
    if (type === "ENTRY") return "Entrada";
    if (type === "EXIT") return "Saída";
    return "Desconhecido";
  }

  function confidenceLabel(value?: number | null) {
    if (value === null || value === undefined) return "0%";
    return `${Math.round(value * 100)}%`;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Select value={matchStatus} onValueChange={(value) => setMatchStatus(value as MatchFilter)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="REVIEW_REQUIRED">Em revisão</SelectItem>
            <SelectItem value="UNMATCHED">Desconhecidos</SelectItem>
            <SelectItem value="MATCHED">Reconhecidos</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => eventsQuery.refetch()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Atualizar
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="glass-card p-4">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Eventos na fila
          </div>
          <div className="text-3xl font-bold">{events.length}</div>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2">
            <ScanFace className="h-4 w-4 text-primary" />
            Filtro atual
          </div>
          <div className="text-lg font-bold">{matchStatus}</div>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2">
            <CheckCircle2 className="h-4 w-4 text-green-700" />
            Atualização
          </div>
          <div className="text-sm text-muted-foreground">{eventsQuery.isFetching ? "Sincronizando..." : "A cada 30 segundos"}</div>
        </div>
      </div>

      <div className="glass-card p-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold text-foreground">Eventos Faciais</h2>
          <Eye className="h-4 w-4 text-primary" />
        </div>

        <div className="space-y-3">
          {events.map((event) => (
            <article key={event.id} className="rounded-lg border border-border bg-background p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-base">
                      {event.student?.name || "Rosto desconhecido"}
                    </h3>
                    <StatusBadge variant={event.matchStatus === "MATCHED" ? "ok" : event.matchStatus === "REVIEW_REQUIRED" ? "atencao" : "alerta"}>
                      {event.matchStatus}
                    </StatusBadge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {eventLabel(event.type)} · {event.school?.name || "Escola não informada"} · {event.camera?.name || "Câmera não informada"}
                  </p>
                  {event.reviewReason && <p className="mt-2 text-xs text-amber-700">{event.reviewReason}</p>}
                </div>
                <div className="shrink-0 text-left md:text-right">
                  <div className="text-xl font-bold text-primary">{confidenceLabel(event.confidence)}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(event.recognizedAt).toLocaleString("pt-BR")}
                  </div>
                </div>
              </div>
            </article>
          ))}

          {!events.length && !eventsQuery.isLoading && (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Nenhum evento encontrado para este filtro.
            </div>
          )}

          {eventsQuery.isLoading && <div className="text-sm text-muted-foreground">Carregando eventos...</div>}
        </div>
      </div>
    </div>
  );
}

// ─── Página Presença (com abas) ───────────────────────────────────────────────

const tabs: { id: PresencaTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "presenca", label: "Presença do Dia", icon: ClipboardCheck },
  { id: "revisao-facial", label: "Revisão Facial", icon: ScanFace },
];

export default function Presenca() {
  const [active, setActive] = useState<PresencaTab>("presenca");

  return (
    <>
      <PageHeader
        title="Turmas & Presença"
        subtitle="Controle diário de entradas, saídas e revisão facial"
        breadcrumb={[{ label: "Início", href: "/" }, { label: "Presença" }]}
        actions={
          active === "presenca" ? (
            <Button variant="outline" disabled title="Endpoint de relatórios ainda não exposto pela API">
              <Download className="h-4 w-4 mr-1" />
              Exportar PDF
            </Button>
          ) : undefined
        }
      />

      {/* Abas */}
      <div className="flex gap-1 mb-4 border-b border-border">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActive(id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
              active === id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {active === "presenca" && <TabPresenca />}
      {active === "revisao-facial" && <TabRevisaoFacial />}
    </>
  );
}
