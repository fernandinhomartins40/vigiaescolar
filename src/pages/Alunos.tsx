import { useState } from "react";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { alunos as alunosMock, escolas, responsaveis } from "@/data/mock";
import { Plus, Search, GraduationCap, Camera, Check, ChevronRight, ChevronLeft, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function Alunos() {
  const [list] = useState(alunosMock);
  const [escolaFilter, setEscolaFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [vinculados, setVinculados] = useState<string[]>([]);
  const [principal, setPrincipal] = useState<string | null>(null);
  const [biometriaFotos, setBiometriaFotos] = useState<string[]>([]);

  const filtered = list.filter(
    (a) =>
      (escolaFilter === "all" || a.escolaId === escolaFilter) &&
      a.nome.toLowerCase().includes(search.toLowerCase()),
  );

  function reset() {
    setStep(1);
    setVinculados([]);
    setPrincipal(null);
    setBiometriaFotos([]);
  }

  function capturar() {
    const angulos = ["frontal", "esquerda", "direita", "superior"];
    const ang = angulos[biometriaFotos.length % angulos.length];
    setBiometriaFotos([...biometriaFotos, ang]);
    toast.success(`Foto ${ang} capturada`);
  }

  function finalizar() {
    setOpen(false);
    reset();
    toast.success("Aluno cadastrado com sucesso!");
  }

  return (
    <>
      <PageHeader
        title="Alunos"
        subtitle="Cadastro com vinculação de responsáveis e biometria facial"
        breadcrumb={[{ label: "Início", href: "/" }, { label: "Alunos" }]}
        actions={
          <Button onClick={() => { reset(); setOpen(true); }} className="bg-primary text-primary-foreground hover:bg-primary/90 glow-primary">
            <Plus className="h-4 w-4 mr-1" /> Novo Aluno
          </Button>
        }
      />

      <div className="glass-card p-4 mb-4 flex flex-col md:flex-row gap-3">
        <div className="flex items-center gap-2 flex-1">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar aluno..." className="border-0 bg-transparent focus-visible:ring-0" />
        </div>
        <Select value={escolaFilter} onValueChange={setEscolaFilter}>
          <SelectTrigger className="w-full md:w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as escolas</SelectItem>
            {escolas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map((a) => {
          const escola = escolas.find((e) => e.id === a.escolaId)!;
          return (
            <div key={a.id} className="glass-card p-4 hover:border-primary/40 transition group">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <img src={a.foto} alt="" className="h-14 w-14 rounded-full border-2 border-primary/40 bg-muted" />
                  {a.biometriaAtiva && <span title="Biometria ativa" className="absolute -bottom-1 -right-1 bg-secondary text-secondary-foreground rounded-full p-0.5"><Check className="h-3 w-3" /></span>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-display font-semibold truncate">{a.nome}</div>
                  <div className="text-xs text-muted-foreground truncate">{a.turma} • {escola.nome.split(" ")[0]}</div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[11px] font-mono text-muted-foreground">Mat. {a.matricula}</span>
                <StatusBadge variant={a.presencaHoje as any} />
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent className="max-w-3xl glass-card max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display tracking-wide text-xl">Novo Aluno</DialogTitle>
            {/* Stepper */}
            <div className="flex items-center gap-2 mt-3">
              {[1, 2, 3].map((s) => (
                <div key={s} className="flex items-center gap-2 flex-1">
                  <div className={cn("h-8 w-8 rounded-full border-2 flex items-center justify-center font-display font-bold text-sm", step >= s ? "border-primary bg-primary/15 text-primary glow-primary" : "border-border text-muted-foreground")}>
                    {step > s ? <Check className="h-4 w-4" /> : s}
                  </div>
                  <span className={cn("text-xs font-display tracking-wide hidden sm:block", step >= s ? "text-primary" : "text-muted-foreground")}>
                    {s === 1 ? "DADOS" : s === 2 ? "RESPONSÁVEIS" : "BIOMETRIA"}
                  </span>
                  {s < 3 && <div className={cn("flex-1 h-px", step > s ? "bg-primary" : "bg-border")} />}
                </div>
              ))}
            </div>
          </DialogHeader>

          {step === 1 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2 flex items-center gap-4">
                <div className="h-20 w-20 rounded-full border-2 border-dashed border-primary/30 bg-muted flex items-center justify-center">
                  <Camera className="h-6 w-6 text-muted-foreground" />
                </div>
                <Button variant="outline" type="button">Upload Foto</Button>
              </div>
              <div className="md:col-span-2"><Label>Nome completo *</Label><Input /></div>
              <div><Label>Data de nascimento *</Label><Input type="date" /></div>
              <div><Label>Matrícula *</Label><Input placeholder="20250000" /></div>
              <div>
                <Label>Escola *</Label>
                <Select><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{escolas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Turma *</Label><Input placeholder="Ex: 5º Ano A" /></div>
              <div>
                <Label>Turno</Label>
                <Select defaultValue="Manhã"><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["Manhã", "Tarde", "Integral"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select defaultValue="Ativo"><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["Ativo", "Transferido", "Inativo"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <Label>Buscar responsável já cadastrado</Label>
              <Input placeholder="Digite o nome..." className="mb-3" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-72 overflow-y-auto">
                {responsaveis.map((r) => {
                  const sel = vinculados.includes(r.id);
                  return (
                    <button
                      type="button"
                      key={r.id}
                      onClick={() => setVinculados(sel ? vinculados.filter((id) => id !== r.id) : [...vinculados, r.id])}
                      className={cn("flex items-center gap-3 p-3 rounded-lg border transition text-left", sel ? "border-primary bg-primary/10 glow-primary" : "border-border bg-background/40 hover:border-primary/40")}
                    >
                      <img src={r.foto} className="h-10 w-10 rounded-full bg-muted border border-primary/30" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{r.nome}</div>
                        <div className="text-[11px] text-muted-foreground">{r.parentesco} • {r.whatsapp}</div>
                      </div>
                      {sel && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); setPrincipal(r.id); }} title="Definir como principal">
                          <Star className={cn("h-5 w-5", principal === r.id ? "fill-warning text-warning" : "text-muted-foreground")} />
                        </button>
                      )}
                    </button>
                  );
                })}
              </div>
              {vinculados.length === 0 && <p className="text-xs text-muted-foreground mt-2">Selecione no mínimo 1 responsável.</p>}
            </div>
          )}

          {step === 3 && (
            <div>
              <div className="relative aspect-video bg-background border border-primary/30 rounded-lg overflow-hidden tech-grid scanline mb-4">
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                  <Camera className="h-12 w-12 text-primary/60" />
                  <span className="font-display tracking-widest text-primary/80 text-sm">CÂMERA ATIVA</span>
                </div>
                {/* Guia oval */}
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-52 border-2 border-dashed border-primary/70 rounded-[50%] glow-primary" />
                <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-destructive/20 border border-destructive/50 px-2 py-1 rounded text-xs font-display tracking-wider">
                  <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-pulse-soft" /> AO VIVO
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mb-4">
                {["Iluminação: Boa", "Nitidez: Boa", "Ângulo: Frontal"].map((q) => (
                  <div key={q} className="flex items-center gap-1.5 text-xs text-secondary border border-secondary/30 bg-secondary/10 rounded-md p-2">
                    <Check className="h-3.5 w-3.5" />{q}
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <Button onClick={capturar} className="bg-primary text-primary-foreground hover:bg-primary/90">
                  <Camera className="h-4 w-4 mr-1" />Capturar Foto Biométrica
                </Button>
                <span className="text-xs text-muted-foreground">{biometriaFotos.length} foto(s) capturada(s)</span>
                <StatusBadge variant={biometriaFotos.length >= 3 ? "ok" : "atencao"}>
                  {biometriaFotos.length >= 3 ? "Pronto para treinar" : "Biometria não cadastrada"}
                </StatusBadge>
              </div>
              <div className="grid grid-cols-4 gap-2 mb-3">
                {biometriaFotos.map((ang, i) => (
                  <div key={i} className="aspect-square border border-primary/40 bg-gradient-tech rounded-lg flex flex-col items-center justify-center text-xs font-display tracking-wider text-primary">
                    <Camera className="h-5 w-5 mb-1" />{ang}
                  </div>
                ))}
              </div>
              <Button disabled={biometriaFotos.length < 3} className="w-full bg-secondary text-secondary-foreground hover:bg-secondary/90 disabled:opacity-50">
                Treinar Modelo Biométrico
              </Button>
            </div>
          )}

          <DialogFooter className="gap-2">
            {step > 1 && <Button variant="outline" onClick={() => setStep(step - 1)}><ChevronLeft className="h-4 w-4" />Voltar</Button>}
            {step < 3 && <Button onClick={() => setStep(step + 1)} className="bg-primary text-primary-foreground hover:bg-primary/90">Próximo<ChevronRight className="h-4 w-4" /></Button>}
            {step === 3 && <Button onClick={finalizar} className="bg-secondary text-secondary-foreground hover:bg-secondary/90 glow-success">Finalizar Cadastro</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {filtered.length === 0 && (
        <div className="glass-card p-12 text-center text-muted-foreground">
          <GraduationCap className="h-10 w-10 mx-auto mb-2 opacity-40" />
          Nenhum aluno encontrado.
        </div>
      )}
    </>
  );
}
