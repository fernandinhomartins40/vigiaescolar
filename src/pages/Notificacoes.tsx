import { useState } from "react";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { alunos, notificacoes, responsaveis } from "@/data/mock";
import { Bell, RefreshCw, MessageCircle, Smartphone } from "lucide-react";
import { toast } from "sonner";

export default function Notificacoes() {
  const [tipo, setTipo] = useState("all");
  const [status, setStatus] = useState("all");

  const list = notificacoes.filter(
    (n) => (tipo === "all" || n.tipo === tipo) && (status === "all" || n.status === status),
  );

  const statusVariant = (s: string) => (s === "Entregue" ? "ok" : s === "Falhou" ? "alerta" : "atencao");

  return (
    <>
      <PageHeader
        title="Notificações"
        subtitle="Histórico de alertas enviados aos responsáveis"
        breadcrumb={[{ label: "Início", href: "/" }, { label: "Notificações" }]}
      />

      <div className="glass-card p-4 mb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <Select value={tipo} onValueChange={setTipo}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            {["Entrada", "Saída", "Falta", "Atraso"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos status</SelectItem>
            {["Entregue", "Falhou", "Pendente"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-background/40 border-b border-primary/10">
              <tr className="text-left font-display tracking-wider text-xs uppercase text-muted-foreground">
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
                const a = alunos.find((al) => al.id === n.alunoId)!;
                const r = responsaveis.find((rs) => rs.id === n.responsavelId)!;
                return (
                  <tr key={n.id} className="border-b border-primary/5 hover:bg-primary/5">
                    <td className="px-4 py-3"><StatusBadge variant={n.tipo === "Entrada" ? "presente" : n.tipo === "Saída" ? "saiu" : "alerta"}>{n.tipo}</StatusBadge></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <img src={a.foto} className="h-7 w-7 rounded-full bg-muted border border-primary/30" />{a.nome}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {r.nome}<br /><span className="text-[11px] font-mono">{r.whatsapp}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-xs">
                        {n.canal === "WhatsApp" ? <MessageCircle className="h-3.5 w-3.5 text-secondary" /> : <Smartphone className="h-3.5 w-3.5 text-primary" />}
                        {n.canal}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono">{n.horario}</td>
                    <td className="px-4 py-3"><StatusBadge variant={statusVariant(n.status) as any}>{n.status}</StatusBadge></td>
                    <td className="px-4 py-3 text-right">
                      {n.status === "Falhou" && (
                        <Button size="sm" variant="outline" onClick={() => toast.success("Notificação reenviada")}>
                          <RefreshCw className="h-3.5 w-3.5 mr-1" />Reenviar
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {list.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                  <Bell className="h-10 w-10 mx-auto mb-2 opacity-40" />Nenhuma notificação encontrada.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
