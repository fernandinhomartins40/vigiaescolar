import { useState } from "react";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { alunos, escolas, eventosHoje } from "@/data/mock";
import { Bell, History, Lock, ShieldCheck, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";

export default function PWA() {
  const [logged, setLogged] = useState(false);
  // pega 2 filhos da Carla para a demo
  const filhos = alunos.filter((a) => a.responsavelPrincipalId === "r1");

  return (
    <>
      <PageHeader
        title="App do Responsável (PWA)"
        subtitle="Demonstração do aplicativo que os pais utilizam no celular"
        breadcrumb={[{ label: "Início", href: "/" }, { label: "App PWA" }]}
      />

      <div className="flex justify-center">
        <div className="relative">
          {/* Phone frame */}
          <div className="w-[360px] h-[720px] rounded-[40px] border-8 border-card bg-background overflow-hidden glass-card relative shadow-glow-primary">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 h-6 w-32 bg-card rounded-b-2xl z-20" />

            {!logged ? (
              <div className="p-6 pt-16 h-full flex flex-col">
                <div className="flex flex-col items-center mb-6">
                  <div className="h-16 w-16 rounded-2xl bg-gradient-tech border border-primary/40 flex items-center justify-center glow-primary mb-3">
                    <ShieldCheck className="h-8 w-8 text-primary" />
                  </div>
                  <h2 className="font-display font-bold tracking-widest text-lg">VIGIAESCOLAR</h2>
                  <p className="text-xs text-muted-foreground">App do Responsável</p>
                </div>
                <div className="space-y-3 flex-1">
                  <div>
                    <Label className="text-xs">E-mail</Label>
                    <Input defaultValue="carla@email.com" />
                  </div>
                  <div>
                    <Label className="text-xs">Senha</Label>
                    <Input type="password" defaultValue="••••••••" />
                  </div>
                  <Button onClick={() => setLogged(true)} className="w-full bg-primary text-primary-foreground hover:bg-primary/90 glow-primary mt-4">
                    <Lock className="h-4 w-4 mr-1" />Entrar
                  </Button>
                  <p className="text-xs text-center text-muted-foreground">Demo: clique em entrar para ver o feed</p>
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col pt-10">
                <header className="px-4 py-3 border-b border-primary/15 flex items-center justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground">Olá,</div>
                    <div className="font-display font-semibold">Carla Mendes</div>
                  </div>
                  <Bell className="h-5 w-5 text-primary" />
                </header>

                {/* Push notification */}
                <div className="m-3 p-3 rounded-xl border border-secondary/40 bg-secondary/10 flex items-start gap-2 animate-fade-in">
                  <span className="h-2 w-2 mt-1.5 rounded-full bg-secondary glow-success animate-pulse-soft" />
                  <div className="text-xs">
                    <div className="font-display font-bold text-secondary tracking-wide">🔔 João chegou na escola</div>
                    <div className="text-muted-foreground mt-0.5">Detectado às 07:45 • E.M. Monteiro Lobato</div>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-3 space-y-3 pb-3">
                  {filhos.map((f) => {
                    const escola = escolas.find((e) => e.id === f.escolaId)!;
                    const status = f.presencaHoje;
                    const statusInfo = status === "ausente" ? { color: "bg-destructive text-destructive-foreground", text: "Ausente hoje" } :
                                       status === "saiu" ? { color: "bg-muted text-muted-foreground", text: "Em casa" } :
                                       { color: "bg-secondary text-secondary-foreground", text: "Na escola" };
                    return (
                      <div key={f.id} className="rounded-xl border border-primary/20 bg-background/60 p-3">
                        <div className="flex items-center gap-3 mb-3">
                          <img src={f.foto} className="h-12 w-12 rounded-full border-2 border-primary/40 bg-muted" />
                          <div className="min-w-0 flex-1">
                            <div className="font-display font-semibold truncate">{f.nome}</div>
                            <div className="text-[11px] text-muted-foreground truncate">{f.turma} • {escola.nome.split(" ")[0]}</div>
                          </div>
                          <span className={cn("text-[10px] font-display tracking-wider px-2 py-0.5 rounded font-bold", statusInfo.color)}>{statusInfo.text}</span>
                        </div>
                        <div className="space-y-1.5 text-xs border-l-2 border-primary/30 pl-3 py-1">
                          {f.horarioEntrada && (
                            <div><span className="font-mono text-primary">{f.horarioEntrada}</span> — {f.nome.split(" ")[0]} entrou na escola ✅</div>
                          )}
                          {f.horarioSaida && (
                            <div><span className="font-mono text-warning">{f.horarioSaida}</span> — {f.nome.split(" ")[0]} saiu da escola 🍽️</div>
                          )}
                          {!f.horarioEntrada && (
                            <div className="text-destructive">Sem registros de entrada hoje ⚠️</div>
                          )}
                        </div>
                        <Button variant="outline" size="sm" className="w-full mt-3 text-xs">
                          <History className="h-3.5 w-3.5 mr-1" />Ver histórico de presenças
                        </Button>
                      </div>
                    );
                  })}
                </div>

                <nav className="border-t border-primary/15 grid grid-cols-3 py-2">
                  <button className="flex flex-col items-center text-primary text-[10px] font-display tracking-wider"><Smartphone className="h-4 w-4 mb-0.5" />HOJE</button>
                  <button className="flex flex-col items-center text-muted-foreground text-[10px] font-display tracking-wider"><History className="h-4 w-4 mb-0.5" />HISTÓRICO</button>
                  <button className="flex flex-col items-center text-muted-foreground text-[10px] font-display tracking-wider"><Bell className="h-4 w-4 mb-0.5" />ALERTAS</button>
                </nav>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
