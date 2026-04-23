import { useEffect, useState } from "react";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { alunos, cameras, escolas, eventosHoje, formatWhatsAppLink, responsaveis } from "@/data/mock";
import { Camera as CameraIcon, MessageCircle, AlertTriangle, Settings, Maximize2 } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

function useNow() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function BoundingBox({
  top,
  left,
  width,
  height,
  label,
  color = "secondary",
  delay = 0,
}: {
  top: string;
  left: string;
  width: string;
  height: string;
  label: string;
  color?: "secondary" | "destructive";
  delay?: number;
}) {
  const colorClass = color === "secondary"
    ? "border-secondary text-secondary shadow-[0_0_12px_hsl(var(--secondary)/0.7)]"
    : "border-destructive text-destructive shadow-[0_0_12px_hsl(var(--destructive)/0.7)]";
  return (
    <div
      className={cn("absolute border-2 rounded-md bbox-move", colorClass)}
      style={{ top, left, width, height, animationDelay: `${delay}s` }}
    >
      <div className={cn(
        "absolute -top-6 left-0 text-[10px] font-display font-bold tracking-widest px-2 py-0.5 rounded",
        color === "secondary" ? "bg-secondary text-secondary-foreground" : "bg-destructive text-destructive-foreground",
      )}>
        {label}
      </div>
      {/* corners */}
      <div className="absolute -top-0.5 -left-0.5 w-3 h-3 border-t-2 border-l-2 border-current" />
      <div className="absolute -top-0.5 -right-0.5 w-3 h-3 border-t-2 border-r-2 border-current" />
      <div className="absolute -bottom-0.5 -left-0.5 w-3 h-3 border-b-2 border-l-2 border-current" />
      <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 border-b-2 border-r-2 border-current" />
    </div>
  );
}

export default function Cameras() {
  const now = useNow();
  const [cameraId, setCameraId] = useState(cameras[0].id);
  const [escolaExpand, setEscolaExpand] = useState<string>("esc-1");
  const camera = cameras.find((c) => c.id === cameraId)!;
  const escola = escolas.find((e) => e.id === camera.escolaId)!;

  // turmas para grid inferior
  const turmasEsc = Array.from(new Set(alunos.filter((a) => a.escolaId === escolaExpand).map((a) => a.turma)));

  const ausentes = alunos.filter((a) => a.escolaId === escolaExpand && a.presencaHoje === "ausente");

  return (
    <>
      <PageHeader
        title="Câmeras & Portões"
        subtitle="Monitor ao vivo com reconhecimento facial em tempo real"
        breadcrumb={[{ label: "Início", href: "/" }, { label: "Câmeras" }]}
        actions={
          <Link to="/cameras/cadastro">
            <Button variant="outline"><Settings className="h-4 w-4 mr-1" />Cadastrar Câmera</Button>
          </Link>
        }
      />

      {ausentes.length > 0 && (
        <div className="glass-card border-destructive/50 bg-destructive/10 p-4 mb-4 flex items-center gap-3 animate-pulse-soft">
          <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
          <div className="text-sm">
            <span className="font-display font-bold text-destructive tracking-wide">⚠️ {ausentes.length} aluno(s) ainda não chegaram</span>
            <span className="text-muted-foreground ml-2">— Aula começa em 5 minutos</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        {/* Monitor ao vivo */}
        <div className="xl:col-span-2 glass-card p-4">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Select value={cameraId} onValueChange={setCameraId}>
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {cameras.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground hidden md:inline">{escola.nome}</span>
            </div>
            <div className="flex items-center gap-3 text-xs font-display tracking-widest">
              <span className="text-secondary">{camera.fps} FPS</span>
              <span className="text-primary">{camera.resolucao}</span>
              <span className="font-bold text-primary text-lg text-glow">{now.toLocaleTimeString("pt-BR")}</span>
            </div>
          </div>

          <div className="relative aspect-video bg-background border border-primary/30 rounded-lg overflow-hidden tech-grid scanline">
            {/* Live badge */}
            <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 bg-destructive/20 backdrop-blur border border-destructive/50 px-2.5 py-1 rounded text-xs font-display tracking-wider">
              <span className="relative inline-flex h-2 w-2">
                <span className="absolute inset-0 rounded-full bg-destructive animate-ping" />
                <span className="relative h-2 w-2 rounded-full bg-destructive" />
              </span>
              <span className="font-bold">AO VIVO</span>
            </div>
            <div className="absolute top-3 right-3 z-10 text-xs font-display tracking-widest text-primary/80 bg-background/60 backdrop-blur border border-primary/30 px-2 py-1 rounded">
              {camera.fps}FPS • {camera.resolucao}
            </div>

            <div className="absolute inset-0 flex items-center justify-center">
              <CameraIcon className="h-20 w-20 text-primary/20" />
            </div>

            {/* Bounding boxes */}
            <BoundingBox top="22%" left="18%" width="14%" height="22%" label="JOÃO MENDES • 5º A" color="secondary" delay={0} />
            <BoundingBox top="35%" left="48%" width="13%" height="20%" label="MARIA MENDES • 5º A" color="secondary" delay={1.2} />
            <BoundingBox top="50%" left="72%" width="14%" height="22%" label="DESCONHECIDO" color="destructive" delay={2.4} />

            <button className="absolute bottom-3 right-3 p-2 bg-background/60 backdrop-blur border border-primary/30 rounded hover:bg-primary/20">
              <Maximize2 className="h-4 w-4 text-primary" />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg border border-primary/15 bg-background/40 p-2">
              <div className="text-[10px] font-display tracking-widest text-muted-foreground">DETECÇÕES</div>
              <div className="font-display text-xl font-bold text-primary">{eventosHoje.length}</div>
            </div>
            <div className="rounded-lg border border-secondary/30 bg-secondary/10 p-2">
              <div className="text-[10px] font-display tracking-widest text-muted-foreground">RECONHECIDOS</div>
              <div className="font-display text-xl font-bold text-secondary">{eventosHoje.filter((e) => e.reconhecido).length}</div>
            </div>
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-2">
              <div className="text-[10px] font-display tracking-widest text-muted-foreground">DESCONHECIDOS</div>
              <div className="font-display text-xl font-bold text-destructive">1</div>
            </div>
          </div>
        </div>

        {/* Atividade em tempo real */}
        <div className="glass-card p-4 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-semibold tracking-wide">ATIVIDADE EM TEMPO REAL</h3>
            <span className="h-2 w-2 rounded-full bg-secondary animate-pulse-soft" />
          </div>
          <ul className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
            {eventosHoje.map((e) => {
              const a = alunos.find((al) => al.id === e.alunoId)!;
              const r = responsaveis.find((r) => r.id === a.responsavelPrincipalId)!;
              const link = formatWhatsAppLink(r.whatsapp, `Olá ${r.nome}, seu(sua) filho(a) ${a.nome.split(" ")[0]} ${e.tipo === "Entrou" ? "entrou na" : "saiu da"} escola às ${e.horario}.`);
              return (
                <li key={e.id} className="flex items-center gap-3 p-2 rounded-lg border border-primary/10 bg-background/40 hover:border-primary/30">
                  <div className="relative">
                    <img src={a.foto} className="h-10 w-10 rounded-full bg-muted border border-primary/30" />
                    <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card bg-secondary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{a.nome}</div>
                    <div className="text-[11px] text-muted-foreground">{a.turma} • {e.horario}</div>
                  </div>
                  <StatusBadge variant={e.tipo === "Entrou" ? "presente" : "saiu"}>{e.tipo}</StatusBadge>
                  <a href={link} target="_blank" rel="noreferrer" className="p-2 rounded-md bg-secondary/15 border border-secondary/40 hover:bg-secondary/25 text-secondary" title="Notificar via WhatsApp">
                    <MessageCircle className="h-4 w-4" />
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* Monitor de turmas */}
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div>
            <h3 className="font-display font-semibold tracking-wide">MONITOR DE TURMAS</h3>
            <p className="text-xs text-muted-foreground">Status de presença por turma</p>
          </div>
          <Select value={escolaExpand} onValueChange={setEscolaExpand}>
            <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              {escolas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {turmasEsc.map((turma) => {
            const list = alunos.filter((a) => a.escolaId === escolaExpand && a.turma === turma);
            const pres = list.filter((a) => a.presencaHoje !== "ausente").length;
            const pct = Math.round((pres / list.length) * 100);
            return (
              <div key={turma} className="rounded-lg border border-primary/20 bg-background/40 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-display font-semibold tracking-wide">{turma}</span>
                  <StatusBadge variant={pct >= 80 ? "ok" : pct >= 60 ? "atencao" : "alerta"} />
                </div>
                <div className="flex items-end justify-between mb-2 text-sm">
                  <span className="text-muted-foreground">{pres}/{list.length} presentes</span>
                  <span className="font-display font-bold text-primary text-lg">{pct}%</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden mb-3">
                  <div className="h-full rounded-full bg-gradient-to-r from-primary to-secondary transition-all" style={{ width: `${pct}%` }} />
                </div>
                <div className="grid grid-cols-5 sm:grid-cols-6 gap-2">
                  {list.map((a) => {
                    const borderColor = a.presencaHoje === "ausente" ? "border-destructive" : a.presencaHoje === "atrasado" ? "border-warning" : "border-secondary";
                    const r = responsaveis.find((r) => r.id === a.responsavelPrincipalId)!;
                    const link = formatWhatsAppLink(r.whatsapp, `Olá ${r.nome}, ${a.nome.split(" ")[0]} ainda não chegou na escola.`);
                    return (
                      <div key={a.id} className="relative group" title={`${a.nome} • ${a.presencaHoje}`}>
                        <img src={a.foto} className={cn("h-12 w-12 rounded-full border-2 bg-muted", borderColor, a.presencaHoje === "ausente" && "grayscale")} />
                        {a.presencaHoje === "presente" && a.horarioEntrada && (
                          <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[9px] font-display tracking-wide bg-secondary text-secondary-foreground rounded px-1">{a.horarioEntrada}</span>
                        )}
                        {a.presencaHoje === "ausente" && (
                          <a href={link} target="_blank" rel="noreferrer" className="absolute -top-1 -right-1 bg-secondary text-secondary-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition" title="Notificar via WhatsApp">
                            <MessageCircle className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
