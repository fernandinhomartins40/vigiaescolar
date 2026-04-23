import { useState } from "react";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { escolas as escolasMock, type Escola } from "@/data/mock";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Search, Building2 } from "lucide-react";
import { toast } from "sonner";

const maskCNPJ = (v: string) =>
  v.replace(/\D/g, "").slice(0, 14)
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");

export default function Escolas() {
  const [list, setList] = useState<Escola[]>(escolasMock);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<Partial<Escola>>({
    nome: "",
    cnpj: "",
    telefone: "",
    email: "",
    endereco: "",
    cidade: "",
    estado: "",
    horarioEntrada: "07:30",
    horarioSaida: "12:00",
    toleranciaMin: 15,
    ativa: true,
  });

  const filtered = list.filter((e) => e.nome.toLowerCase().includes(search.toLowerCase()));

  function salvar() {
    if (!form.nome || !form.cnpj) {
      toast.error("Preencha nome e CNPJ");
      return;
    }
    const nova: Escola = {
      id: `esc-${Date.now()}`,
      nome: form.nome!,
      cnpj: form.cnpj!,
      telefone: form.telefone || "",
      email: form.email || "",
      endereco: form.endereco || "",
      cidade: form.cidade || "",
      estado: form.estado || "",
      logo: `https://api.dicebear.com/7.x/shapes/svg?seed=${form.nome}`,
      horarioEntrada: form.horarioEntrada!,
      horarioSaida: form.horarioSaida!,
      toleranciaMin: Number(form.toleranciaMin || 15),
      ativa: form.ativa ?? true,
      totalAlunos: 0,
      totalCameras: 0,
    };
    setList([nova, ...list]);
    setOpen(false);
    toast.success("Escola cadastrada com sucesso!");
  }

  return (
    <>
      <PageHeader
        title="Escolas"
        subtitle="Gerencie as instituições conectadas ao sistema"
        breadcrumb={[{ label: "Início", href: "/" }, { label: "Escolas" }]}
        actions={
          <Button onClick={() => setOpen(true)} className="bg-primary text-primary-foreground hover:bg-primary/90 glow-primary">
            <Plus className="h-4 w-4 mr-1" /> Nova Escola
          </Button>
        }
      />

      <div className="glass-card p-4 mb-4 flex items-center gap-3">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar escola..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border-0 bg-transparent focus-visible:ring-0"
        />
      </div>

      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-background/40 border-b border-primary/10">
              <tr className="text-left font-display tracking-wider text-xs uppercase text-muted-foreground">
                <th className="px-4 py-3">Logo</th>
                <th className="px-4 py-3">Escola</th>
                <th className="px-4 py-3">CNPJ</th>
                <th className="px-4 py-3">Cidade</th>
                <th className="px-4 py-3 text-center">Alunos</th>
                <th className="px-4 py-3 text-center">Câmeras</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-b border-primary/5 hover:bg-primary/5 transition">
                  <td className="px-4 py-3">
                    <img src={e.logo} alt="" className="h-10 w-10 rounded-lg border border-primary/30 bg-muted" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{e.nome}</div>
                    <div className="text-xs text-muted-foreground">{e.endereco}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{e.cnpj}</td>
                  <td className="px-4 py-3">
                    {e.cidade}/{e.estado}
                  </td>
                  <td className="px-4 py-3 text-center font-display font-bold text-primary">{e.totalAlunos}</td>
                  <td className="px-4 py-3 text-center font-display font-bold text-secondary">{e.totalCameras}</td>
                  <td className="px-4 py-3">
                    <StatusBadge variant={e.ativa ? "ativo" : "inativo"} />
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    <Building2 className="h-10 w-10 mx-auto mb-2 opacity-40" />
                    Nenhuma escola encontrada.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl glass-card">
          <DialogHeader>
            <DialogTitle className="font-display tracking-wide text-xl">Nova Escola</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Label>Nome da Escola *</Label>
              <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </div>
            <div>
              <Label>CNPJ *</Label>
              <Input
                value={form.cnpj}
                onChange={(e) => setForm({ ...form, cnpj: maskCNPJ(e.target.value) })}
                placeholder="00.000.000/0000-00"
              />
            </div>
            <div>
              <Label>Telefone</Label>
              <Input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <Label>E-mail institucional</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <Label>Endereço completo</Label>
              <Input value={form.endereco} onChange={(e) => setForm({ ...form, endereco: e.target.value })} />
            </div>
            <div>
              <Label>Cidade</Label>
              <Input value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value })} />
            </div>
            <div>
              <Label>Estado</Label>
              <Input value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })} maxLength={2} />
            </div>
            <div>
              <Label>Horário de entrada</Label>
              <Input type="time" value={form.horarioEntrada} onChange={(e) => setForm({ ...form, horarioEntrada: e.target.value })} />
            </div>
            <div>
              <Label>Horário de saída</Label>
              <Input type="time" value={form.horarioSaida} onChange={(e) => setForm({ ...form, horarioSaida: e.target.value })} />
            </div>
            <div>
              <Label>Tolerância de atraso (min)</Label>
              <Input
                type="number"
                value={form.toleranciaMin}
                onChange={(e) => setForm({ ...form, toleranciaMin: Number(e.target.value) })}
              />
            </div>
            <div className="flex items-center gap-2 mt-6">
              <Switch checked={form.ativa} onCheckedChange={(v) => setForm({ ...form, ativa: v })} />
              <Label>Escola Ativa</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={salvar} className="bg-primary text-primary-foreground hover:bg-primary/90">
              Salvar Escola
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
