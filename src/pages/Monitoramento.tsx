import { useMemo, useState, type ComponentType, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Bell,
  Camera,
  GraduationCap,
  MessageCircle,
  RefreshCw,
  School,
  ShieldCheck,
  Smartphone,
  TrendingUp,
  UserCheck,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTenantResourceKeyFactory } from "@/context/auth-context";
import { getDashboard, listNotifications, listResponsibles, listStudents, resendNotification } from "@/lib/resources";
import { CamerasView } from "./Cameras";
import { cn } from "@/lib/utils";

// ─── Circular Progress ────────────────────────────────────────────────────────

function CircularProgress({ value, size = 72 }: { value: number; size?: number }) {
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="hsl(var(--muted))" strokeWidth="6" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="hsl(var(--primary))" strokeWidth="6" fill="none"
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-bold text-base text-primary">{value}%</span>
      </div>
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, hint, alert, accent, children }: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  hint?: string;
  alert?: boolean;
  accent?: "green" | "blue" | "red";
  children?: ReactNode;
}) {
  const accentClass = alert ? "status-bar-red" : accent === "blue" ? "status-bar-blue" : "status-bar-green";
  return (
    <div className={`glass-card p-4 ${accentClass}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            <Icon className="h-3.5 w-3.5" />
            {label}
          </div>
          <div className={`mt-2 text-3xl font-bold ${alert ? "text-destructive" : "text-foreground"}`}>{value}</div>
          {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Aba: Visão Geral ─────────────────────────────────────────────────────────

function TabVisaoGeral() {
  const keys = useTenantResourceKeyFactory();
  const q = useQuery({ queryKey: keys.dashboard, queryFn: getDashboard, refetchInterval: 30_000 });
  const data = q.data;
  const students = data?.alunos ?? [];
  const schools = data?.escolas ?? [];
  const latestEvents = data?.eventosHoje ?? [];
  const entriesByHour = data?.entradasPorHora ?? [];
  const turmas = data?.classAttendance ?? [];

  const resumo = useMemo(() => {
    const totalAlunos = data?.resumo.alunos ?? 0;
    const presentes = data?.resumo.presentesHoje ?? 0;
    return {
      totalEscolas: data?.resumo.escolas ?? 0,
      totalAlunos,
      camerasOnline: data?.resumo.camerasAtivas ?? 0,
      presentes,
      ausentes: data?.resumo.ausentesHoje ?? 0,
      presencaPct: totalAlunos > 0 ? Math.round((presentes / totalAlunos) * 100) : 0,
    };
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={School} label="Escolas" value={resumo.totalEscolas} hint="em produção" accent="blue">
          <div className="rounded-lg p-2 bg-accent/10 border border-accent/20">
            <School className="h-5 w-5 text-accent" />
          </div>
        </StatCard>
        <StatCard icon={GraduationCap} label="Alunos" value={resumo.totalAlunos} hint={`${resumo.camerasOnline} câmeras online`} accent="blue">
          <div className="rounded-lg p-2 bg-accent/10 border border-accent/20">
            <GraduationCap className="h-5 w-5 text-accent" />
          </div>
        </StatCard>
        <StatCard icon={UserCheck} label="Presentes hoje" value={`${resumo.presentes}/${resumo.totalAlunos}`} accent="green">
          <CircularProgress value={resumo.presencaPct} />
        </StatCard>
        <StatCard icon={AlertTriangle} label="Alertas pendentes" value={resumo.ausentes} hint="alunos ausentes" alert={resumo.ausentes > 0}>
          <div className={`rounded-lg p-2 border ${resumo.ausentes > 0 ? "bg-destructive/10 border-destructive/20" : "bg-muted border-border"}`}>
            <AlertTriangle className={`h-5 w-5 ${resumo.ausentes > 0 ? "text-destructive" : "text-muted-foreground"}`} />
          </div>
        </StatCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="glass-card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-foreground">Entradas por hora</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Movimento do dia atual</p>
            </div>
            <span className="flex items-center gap-1.5 text-xs text-primary font-medium">
              <TrendingUp className="h-3.5 w-3.5" /> Ao vivo
            </span>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={entriesByHour}>
                <defs>
                  <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(145 100% 27%)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="hsl(145 100% 27%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="hora" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }} />
                <Area type="monotone" dataKey="entradas" stroke="hsl(145 100% 27%)" strokeWidth={2} fill="url(#grad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground">Últimas detecções</h3>
            <Camera className="h-4 w-4 text-muted-foreground" />
          </div>
          <ul className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {latestEvents.map((event) => {
              const student = students.find((s) => s.id === event.alunoId);
              const school = schools.find((s) => s.id === student?.escolaId);
              return (
                <li key={event.id} className="flex items-center gap-3 rounded-lg border border-border bg-background p-2.5 hover:border-primary/30 transition-colors">
                  <img src={student?.foto} alt={student?.nome ?? ""} className="h-9 w-9 rounded-full bg-muted border border-border object-cover" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{student?.nome ?? "Rosto desconhecido"}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{student?.turma} — {school?.nome.split(" ")[0]}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs text-muted-foreground mb-1">{event.horario}</div>
                    <StatusBadge variant={event.tipo === "Entrou" ? "presente" : event.tipo === "Saiu" ? "saiu" : "alerta"}>{event.tipo}</StatusBadge>
                  </div>
                </li>
              );
            })}
            {q.isLoading && <li className="text-sm text-muted-foreground text-center py-4">Carregando...</li>}
            {!q.isLoading && latestEvents.length === 0 && (
              <li className="text-sm text-muted-foreground text-center py-4">Nenhum evento hoje</li>
            )}
          </ul>
        </div>
      </div>

      {/* Presença por turma */}
      <div className="glass-card p-5">
        <h3 className="font-semibold text-foreground mb-4">Presença por turma</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {turmas.map((turma) => (
            <div key={`${turma.escola}-${turma.turma}`} className="rounded-lg border border-border bg-background p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-sm">{turma.turma}</span>
                <StatusBadge variant={turma.pct >= 80 ? "ok" : turma.pct >= 60 ? "atencao" : "alerta"} />
              </div>
              <div className="text-[11px] text-muted-foreground mb-2 truncate">{turma.escola}</div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-muted-foreground">{turma.presentes}/{turma.total}</span>
                <span className="font-bold text-sm text-primary">{turma.pct}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${turma.pct}%` }} />
              </div>
            </div>
          ))}
          {turmas.length === 0 && !q.isLoading && (
            <div className="col-span-full text-sm text-muted-foreground text-center py-4">Nenhuma turma encontrada</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Aba: Câmeras ao Vivo ─────────────────────────────────────────────────────

function TabCamerasVivo() {
  return <CamerasView mode="guard" />;
}

// ─── Aba: Notificações ────────────────────────────────────────────────────────

function TabNotificacoes() {
  const keys = useTenantResourceKeyFactory();
  const queryClient = useQueryClient();
  const [tipo, setTipo] = useState("all");
  const [status, setStatus] = useState("all");

  const notificationsQuery = useQuery({
    queryKey: [...keys.notifications, tipo, status] as const,
    queryFn: () => listNotifications({ tipo: tipo === "all" ? undefined : tipo, status: status === "all" ? undefined : status }),
  });
  const studentsQuery = useQuery({ queryKey: keys.students, queryFn: listStudents });
  const responsiblesQuery = useQuery({ queryKey: keys.responsibles, queryFn: listResponsibles });

  const resendMutation = useMutation({
    mutationFn: resendNotification,
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: keys.notifications }); toast.success("Notificação reenviada"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao reenviar"),
  });

  const list = notificationsQuery.data ?? [];
  const statusVariant = (v: string) => v === "Entregue" ? "ok" : v === "Falhou" ? "alerta" : "atencao";

  return (
    <div className="space-y-4">
      <div className="glass-card p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <Select value={tipo} onValueChange={setTipo}>
          <SelectTrigger><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            {["Entrada", "Saída", "Falta", "Atraso"].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {["Entregue", "Falhou", "Pendente"].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted border-b border-border">
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Aluno</th>
                <th className="px-4 py-3">Responsável</th>
                <th className="px-4 py-3">Canal</th>
                <th className="px-4 py-3">Horário</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {list.map((n) => {
                const student = studentsQuery.data?.find((s) => s.id === n.alunoId);
                const resp = responsiblesQuery.data?.find((r) => r.id === n.responsavelId);
                if (!student || !resp) return null;
                return (
                  <tr key={n.id} className="border-b border-border hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-3">
                      <StatusBadge variant={n.tipo === "Entrada" ? "presente" : n.tipo === "Saída" ? "saiu" : "alerta"}>{n.tipo}</StatusBadge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <img src={student.foto} className="h-7 w-7 rounded-full bg-muted border border-border object-cover" />
                        {student.nome}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {resp.nome}<br /><span className="text-[11px] font-mono">{resp.whatsapp}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-xs">
                        {n.canal === "WhatsApp" ? <MessageCircle className="h-3.5 w-3.5 text-green-600" /> : <Smartphone className="h-3.5 w-3.5 text-primary" />}
                        {n.canal}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{n.horario}</td>
                    <td className="px-4 py-3"><StatusBadge variant={statusVariant(n.status) as "ok" | "alerta" | "atencao"}>{n.status}</StatusBadge></td>
                    <td className="px-4 py-3 text-right">
                      {n.status === "Falhou" && (
                        <Button size="sm" variant="outline" onClick={() => resendMutation.mutate(n.id)}>
                          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Reenviar
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {list.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                  <Bell className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  Nenhuma notificação encontrada.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

type MonitorTab = "visao-geral" | "cameras-vivo" | "notificacoes";

const monitorTabs: { id: MonitorTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "visao-geral", label: "Visão Geral", icon: Activity },
  { id: "cameras-vivo", label: "Câmeras ao Vivo", icon: ShieldCheck },
  { id: "notificacoes", label: "Notificações", icon: Bell },
];

export default function Monitoramento() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("aba") as MonitorTab | null;
  const [active, setActive] = useState<MonitorTab>(
    monitorTabs.some((t) => t.id === tabParam) ? (tabParam as MonitorTab) : "visao-geral",
  );

  function goTo(id: MonitorTab) {
    setActive(id);
    setSearchParams({ aba: id }, { replace: true });
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-5 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Monitoramento</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Visão em tempo real da segurança escolar</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-green-700 font-medium">
          <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse-soft" />
          Sistema online
        </div>
      </div>

      {/* Abas */}
      <div className="flex gap-1 mb-5 border-b border-border">
        {monitorTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => goTo(tab.id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
              active === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Conteúdo */}
      {active === "visao-geral" && <TabVisaoGeral />}
      {active === "cameras-vivo" && <TabCamerasVivo />}
      {active === "notificacoes" && <TabNotificacoes />}
    </div>
  );
}
