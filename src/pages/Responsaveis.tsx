import { useState } from "react";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { responsaveis as respMock, type Responsavel, alunos } from "@/data/mock";
import { Plus, Search, Phone, Mail, Users } from "lucide-react";
import { toast } from "sonner";

const maskCPF = (v: string) =>
  v.replace(/\D/g, "").slice(0, 11)
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1-$2");

const maskWhats = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 13);
  if (d.length <= 2) return `+${d}`;
  if (d.length <= 4) return `+${d.slice(0, 2)} (${d.slice(2)}`;
  if (d.length <= 9) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4)}`;
  return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
};

export default function Responsaveis() {
  const [list, setList] = useState<Responsavel[]>(respMock);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<Partial<Responsavel>>({
    parentesco: "Mãe",
    ativo: true,
  });

  const filtered = list.filter((r) => r.nome.toLowerCase().includes(search.toLowerCase()));

  function salvar() {
    if (!form.nome || !form.cpf || !form.whatsapp || !form.email) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }
    const novo: Responsavel = {
      id: `r-${Date.now()}`,
      nome: form.nome!,
      cpf: form.cpf!,
      whatsapp: form.whatsapp!,
      email: form.email!,
      parentesco: form.parentesco as Responsavel["parentesco"],
      foto: `https://api.dicebear.com/7.x/avataaars/svg?seed=${form.nome}`,
      ativo: true,
      filhosIds: [],
    };
    setList([novo, ...list]);
    setOpen(false);
    setForm({ parentesco: "Mãe", ativo: true });
    toast.success("Responsável cadastrado!");
  }

  return (
    <>
      <PageHeader
        title="Pais & Responsáveis"
        subtitle="Cadastro de responsáveis legais que recebem notificações"
        breadcrumb={[{ label: "Início", href: "/" }, { label: "Responsáveis" }]}
        actions={
          <Button onClick={() => setOpen(true)} className="bg-primary text-primary-foreground hover:bg-primary/90 glow-primary">
            <Plus className="h-4 w-4 mr-1" /> Novo Responsável
          </Button>
        }
      />

      <div className="glass-card p-4 mb-4 flex items-center gap-3">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border-0 bg-transparent focus-visible:ring-0"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((r) => {
          const filhos = alunos.filter((a) => a.responsaveisIds.includes(r.id));
          return (
            <div key={r.id} className="glass-card p-4 hover:border-primary/40 transition">
              <div className="flex items-center gap-3">
                <img src={r.foto} alt="" className="h-14 w-14 rounded-full border-2 border-primary/40 bg-muted" />
                <div className="min-w-0 flex-1">
                  <div className="font-display font-semibold truncate">{r.nome}</div>
                  <div className="text-xs text-muted-foreground">{r.parentesco}</div>
                </div>
                <StatusBadge variant={r.ativo ? "ativo" : "inativo"}>{r.ativo ? "Ativo" : "Inativo"}</StatusBadge>
              </div>
              <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-secondary" />{r.whatsapp}</div>
                <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-primary" />{r.email}</div>
                <div className="flex items-center gap-2"><Users className="h-3.5 w-3.5 text-primary" />{filhos.length} filho(s) vinculado(s)</div>
              </div>
              {filhos.length > 0 && (
                <div className="mt-3 flex -space-x-2">
                  {filhos.slice(0, 4).map((f) => (
                    <img key={f.id} src={f.foto} title={f.nome} className="h-7 w-7 rounded-full border-2 border-card bg-muted" />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl glass-card max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display tracking-wide text-xl">Novo Responsável</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Label>Nome completo *</Label>
              <Input value={form.nome || ""} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </div>
            <div>
              <Label>CPF *</Label>
              <Input value={form.cpf || ""} onChange={(e) => setForm({ ...form, cpf: maskCPF(e.target.value) })} placeholder="000.000.000-00" />
            </div>
            <div>
              <Label>Grau de parentesco</Label>
              <Select value={form.parentesco} onValueChange={(v) => setForm({ ...form, parentesco: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Pai", "Mãe", "Avó", "Avô", "Tio", "Tia", "Responsável Legal", "Outro"].map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>WhatsApp *</Label>
              <Input value={form.whatsapp || ""} onChange={(e) => setForm({ ...form, whatsapp: maskWhats(e.target.value) })} placeholder="+55 (00) 00000-0000" />
            </div>
            <div>
              <Label>E-mail *</Label>
              <Input type="email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <Label>Senha de acesso ao app *</Label>
              <Input type="password" placeholder="Mínimo 8 caracteres" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={salvar} className="bg-primary text-primary-foreground hover:bg-primary/90">Cadastrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
