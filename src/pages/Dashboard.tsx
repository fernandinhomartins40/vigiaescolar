import { useMemo, type ComponentType, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, Camera, GraduationCap, School, UserCheck } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useTenantResourceKeyFactory } from "@/context/auth-context";
import { getDashboard } from "@/lib/resources";

function CircularProgress({ value, size = 88 }: { value: number; size?: number }) {
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="hsl(var(--muted))" strokeWidth="6" fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="hsl(var(--primary))"
          strokeWidth="6"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ filter: "drop-shadow(0 0 6px hsl(var(--primary) / 0.6))" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-xl font-bold text-primary">{value}%</span>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  alert,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  hint?: string;
  alert?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="glass-card p-5 relative overflow-hidden">
      <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-gradient-tech opacity-50 blur-2xl" />
      <div className="relative flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-display tracking-widest text-muted-foreground uppercase">
            <Icon className="h-3.5 w-3.5" />
            {label}
          </div>
          <div className={`mt-2 font-display text-3xl font-bold ${alert ? "text-destructive text-glow" : "text-foreground"}`}>
            {value}
          </div>
          {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const keys = useTenantResourceKeyFactory();
  const dashboardQuery = useQuery({
    queryKey: keys.dashboard,
    queryFn: getDashboard,
    refetchInterval: 30_000,
  });

  const data = dashboardQuery.data;
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
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Visao geral consolidada pela API em tempo real"
        actions={
          <div className="glass-card px-4 py-2 flex items-center gap-2 text-xs font-display tracking-widest">
            <Activity className="h-4 w-4 text-secondary" />
            <span className="text-secondary">{latestEvents.length} EVENTOS HOJE</span>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={School} label="Escolas" value={resumo.totalEscolas} hint="em producao">
          <div className="rounded-lg p-2 bg-primary/10 border border-primary/30">
            <School className="h-5 w-5 text-primary" />
          </div>
        </StatCard>
        <StatCard icon={GraduationCap} label="Alunos Ativos" value={resumo.totalAlunos} hint={`${resumo.camerasOnline} cameras online`}>
          <div className="rounded-lg p-2 bg-primary/10 border border-primary/30">
            <GraduationCap className="h-5 w-5 text-primary" />
          </div>
        </StatCard>
        <StatCard icon={UserCheck} label="Presentes Hoje" value={`${resumo.presentes}/${resumo.totalAlunos}`}>
          <CircularProgress value={resumo.presencaPct} size={72} />
        </StatCard>
        <StatCard icon={AlertTriangle} label="Alertas Pendentes" value={resumo.ausentes} hint="alunos ausentes" alert={resumo.ausentes > 0}>
          <div className={`rounded-lg p-2 border ${resumo.ausentes > 0 ? "bg-destructive/15 border-destructive/40 glow-danger" : "bg-muted border-border"}`}>
            <AlertTriangle className={`h-5 w-5 ${resumo.ausentes > 0 ? "text-destructive" : "text-muted-foreground"}`} />
          </div>
        </StatCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <div className="glass-card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-display font-semibold tracking-wide text-foreground">ENTRADAS POR HORA</h3>
              <p className="text-xs text-muted-foreground">Movimento do dia atual</p>
            </div>
            <span className="text-xs font-display tracking-widest text-primary">API</span>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={entriesByHour}>
                <defs>
                  <linearGradient id="ent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.6} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="hora" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--primary) / 0.3)",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                />
                <Area type="monotone" dataKey="entradas" stroke="hsl(var(--primary))" strokeWidth={2.5} fill="url(#ent)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold tracking-wide">ULTIMAS DETECCOES</h3>
            <Camera className="h-4 w-4 text-primary" />
          </div>
          <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {latestEvents.map((event) => {
              const student = students.find((item) => item.id === event.alunoId);
              const school = schools.find((item) => item.id === student?.escolaId);
              return (
                <li key={event.id} className="flex items-center gap-3 rounded-lg border border-primary/10 bg-background/40 p-2.5 hover:border-primary/30 transition">
                  <img src={student?.foto} alt={student?.nome ?? "Evento"} className="h-9 w-9 rounded-full bg-muted border border-primary/30 object-cover" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{student?.nome ?? "Rosto desconhecido"}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {student?.turma ?? "Revisao"} - {school?.nome.split(" ")[0] ?? "Sem escola"}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-display tracking-wider text-foreground">{event.horario}</div>
                    <StatusBadge variant={event.tipo === "Entrou" ? "presente" : event.tipo === "Saiu" ? "saiu" : "alerta"}>{event.tipo}</StatusBadge>
                  </div>
                </li>
              );
            })}
            {dashboardQuery.isLoading && <li className="text-sm text-muted-foreground">Carregando eventos...</li>}
          </ul>
        </div>
      </div>

      <div className="glass-card p-5 mt-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-display font-semibold tracking-wide">PRESENCA POR TURMA</h3>
            <p className="text-xs text-muted-foreground">Status atualizado pelo backend</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {turmas.map((turma) => (
            <div key={`${turma.escola}-${turma.turma}`} className="rounded-lg border border-primary/15 bg-background/50 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="font-display font-semibold text-sm">{turma.turma}</span>
                <StatusBadge variant={turma.pct >= 80 ? "ok" : turma.pct >= 60 ? "atencao" : "alerta"} />
              </div>
              <div className="text-[11px] text-muted-foreground mb-2 truncate">{turma.escola}</div>
              <div className="flex items-end justify-between mb-1.5">
                <span className="text-xs text-muted-foreground">
                  {turma.presentes}/{turma.total}
                </span>
                <span className="font-display font-bold text-primary">{turma.pct}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-primary to-secondary transition-all" style={{ width: `${turma.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
