import { useState } from "react";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { alunos, escolas, formatWhatsAppLink, responsaveis } from "@/data/mock";
import { Check, X, Download, MessageCircle } from "lucide-react";
import { toast } from "sonner";

export default function Presenca() {
  const [escolaId, setEscolaId] = useState(escolas[0].id);
  const [turma, setTurma] = useState<string>("all");
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));

  const turmas = Array.from(new Set(alunos.filter((a) => a.escolaId === escolaId).map((a) => a.turma)));
  const list = alunos.filter((a) => a.escolaId === escolaId && (turma === "all" || a.turma === turma));

  const presentes = list.filter((a) => a.presencaHoje === "presente").length;
  const atrasados = list.filter((a) => a.presencaHoje === "atrasado").length;
  const ausentes = list.filter((a) => a.presencaHoje === "ausente").length;

  return (
    <>
      <PageHeader
        title="Turmas & Presença"
        subtitle="Controle diário de entradas, saídas e ausências"
        breadcrumb={[{ label: "Início", href: "/" }, { label: "Presença" }]}
        actions={
          <Button variant="outline" onClick={() => toast.success("Lista exportada (simulado)")}>
            <Download className="h-4 w-4 mr-1" />Exportar PDF
          </Button>
        }
      />

      <div className="glass-card p-4 mb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <Select value={escolaId} onValueChange={setEscolaId}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{escolas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={turma} onValueChange={setTurma}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as turmas</SelectItem>
            {turmas.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="glass-card p-4 text-center"><div className="text-xs font-display tracking-widest text-muted-foreground">PRESENTES</div><div className="font-display text-3xl font-bold text-secondary">{presentes}</div></div>
        <div className="glass-card p-4 text-center"><div className="text-xs font-display tracking-widest text-muted-foreground">ATRASADOS</div><div className="font-display text-3xl font-bold text-warning">{atrasados}</div></div>
        <div className="glass-card p-4 text-center"><div className="text-xs font-display tracking-widest text-muted-foreground">AUSENTES</div><div className="font-display text-3xl font-bold text-destructive">{ausentes}</div></div>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-background/40 border-b border-primary/10">
              <tr className="text-left font-display tracking-wider text-xs uppercase text-muted-foreground">
                <th className="px-4 py-3">Aluno</th>
                <th className="px-4 py-3">Turma</th>
                <th className="px-4 py-3">Entrada</th>
                <th className="px-4 py-3">Saída</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-center">Notificado</th>
                <th className="px-4 py-3 text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {list.map((a) => {
                const r = responsaveis.find((r) => r.id === a.responsavelPrincipalId)!;
                const link = formatWhatsAppLink(r.whatsapp, `Atualização sobre ${a.nome.split(" ")[0]}: status ${a.presencaHoje}.`);
                const notificado = a.presencaHoje !== "ausente";
                return (
                  <tr key={a.id} className="border-b border-primary/5 hover:bg-primary/5">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <img src={a.foto} className="h-8 w-8 rounded-full bg-muted border border-primary/30" />
                        <span className="font-medium">{a.nome}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{a.turma}</td>
                    <td className="px-4 py-3 font-mono">{a.horarioEntrada || "—"}</td>
                    <td className="px-4 py-3 font-mono">{a.horarioSaida || "—"}</td>
                    <td className="px-4 py-3"><StatusBadge variant={a.presencaHoje as any} /></td>
                    <td className="px-4 py-3 text-center">
                      {notificado ? <Check className="h-4 w-4 text-secondary inline" /> : <X className="h-4 w-4 text-destructive inline" />}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-secondary border border-secondary/40 bg-secondary/10 hover:bg-secondary/20 rounded-md px-2 py-1">
                        <MessageCircle className="h-3 w-3" />WhatsApp
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
