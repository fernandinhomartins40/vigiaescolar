import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { alunos, escolas, eventosHoje, entradasPorHora, cameras } from "@/data/mock";
import { School, GraduationCap, UserCheck, AlertTriangle, Activity, Camera } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Area,
  AreaChart,
} from "recharts";

function CircularProgress({ value, size = 88 }: { value: number; size?: number }) {
  const radius = (size - 12) / 2;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (value / 100) * circ;
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
          strokeDasharray={circ}
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
  icon: any;
  label: string;
  value: string | number;
  hint?: string;
  alert?: boolean;
  children?: React.ReactNode;
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
          <div
            className={`mt-2 font-display text-3xl font-bold ${
              alert ? "text-destructive text-glow" : "text-foreground"
            }`}
          >
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
  const totalEscolas = escolas.length;
  const totalAlunos = alunos.length;
  const presentes = alunos.filter((a) => a.presencaHoje === "presente" || a.presencaHoje === "atrasado").length;
  const ausentes = alunos.filter((a) => a.presencaHoje === "ausente").length;
  const presencaPct = Math.round((presentes / totalAlunos) * 100);

  const ultimasEntradas = eventosHoje.slice(0, 10);

  // Turmas com % presença
  const turmas = Array.from(new Set(alunos.map((a) => `${a.escolaId}::${a.turma}`))).map((key) => {
    const [escolaId, turma] = key.split("::");
    const dela = alunos.filter((a) => a.escolaId === escolaId && a.turma === turma);
    const pres = dela.filter((a) => a.presencaHoje !== "ausente").length;
    const escola = escolas.find((e) => e.id === escolaId)!;
    return { turma, escola: escola.nome, total: dela.length, presentes: pres, pct: Math.round((pres / dela.length) * 100) };
  });

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Visão geral em tempo real do sistema de segurança"
        actions={
          <div className="glass-card px-4 py-2 flex items-center gap-2 text-xs font-display tracking-widest">
            <Activity className="h-4 w-4 text-secondary" />
            <span className="text-secondary">{eventosHoje.length} EVENTOS HOJE</span>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={School} label="Escolas" value={totalEscolas} hint="3 ativas">
          <div className="rounded-lg p-2 bg-primary/10 border border-primary/30">
            <School className="h-5 w-5 text-primary" />
          </div>
        </StatCard>
        <StatCard icon={GraduationCap} label="Alunos Ativos" value={totalAlunos} hint={`${cameras.length} câmeras online`}>
          <div className="rounded-lg p-2 bg-primary/10 border border-primary/30">
            <GraduationCap className="h-5 w-5 text-primary" />
          </div>
        </StatCard>
        <StatCard icon={UserCheck} label="Presentes Hoje" value={`${presentes}/${totalAlunos}`}>
          <CircularProgress value={presencaPct} size={72} />
        </StatCard>
        <StatCard icon={AlertTriangle} label="Alertas Pendentes" value={ausentes} hint="alunos ausentes" alert={ausentes > 0}>
          <div
            className={`rounded-lg p-2 border ${
              ausentes > 0 ? "bg-destructive/15 border-destructive/40 glow-danger" : "bg-muted border-border"
            }`}
          >
            <AlertTriangle className={`h-5 w-5 ${ausentes > 0 ? "text-destructive" : "text-muted-foreground"}`} />
          </div>
        </StatCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        {/* Gráfico */}
        <div className="glass-card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-display font-semibold tracking-wide text-foreground">ENTRADAS POR HORA</h3>
              <p className="text-xs text-muted-foreground">Movimento de hoje</p>
            </div>
            <span className="text-xs font-display tracking-widest text-primary">TEMPO REAL</span>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={entradasPorHora}>
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

        {/* Últimas entradas */}
        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold tracking-wide">ÚLTIMAS DETECÇÕES</h3>
            <Camera className="h-4 w-4 text-primary" />
          </div>
          <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {ultimasEntradas.map((e) => {
              const aluno = alunos.find((a) => a.id === e.alunoId)!;
              const escola = escolas.find((es) => es.id === aluno.escolaId)!;
              return (
                <li
                  key={e.id}
                  className="flex items-center gap-3 rounded-lg border border-primary/10 bg-background/40 p-2.5 hover:border-primary/30 transition"
                >
                  <img src={aluno.foto} alt={aluno.nome} className="h-9 w-9 rounded-full bg-muted border border-primary/30" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{aluno.nome}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {aluno.turma} • {escola.nome.split(" ")[0]}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-display tracking-wider text-foreground">{e.horario}</div>
                    <StatusBadge variant={e.tipo === "Entrou" ? "presente" : "saiu"}>
                      {e.tipo}
                    </StatusBadge>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* Turmas */}
      <div className="glass-card p-5 mt-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-display font-semibold tracking-wide">PRESENÇA POR TURMA</h3>
            <p className="text-xs text-muted-foreground">Status atualizado em tempo real</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {turmas.map((t) => (
            <div key={t.turma + t.escola} className="rounded-lg border border-primary/15 bg-background/50 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="font-display font-semibold text-sm">{t.turma}</span>
                <StatusBadge variant={t.pct >= 80 ? "ok" : t.pct >= 60 ? "atencao" : "alerta"} />
              </div>
              <div className="text-[11px] text-muted-foreground mb-2 truncate">{t.escola}</div>
              <div className="flex items-end justify-between mb-1.5">
                <span className="text-xs text-muted-foreground">
                  {t.presentes}/{t.total}
                </span>
                <span className="font-display font-bold text-primary">{t.pct}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-secondary transition-all"
                  style={{ width: `${t.pct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
