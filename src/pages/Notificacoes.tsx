import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, MessageCircle, RefreshCw, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTenantResourceKeyFactory } from "@/context/auth-context";
import { listNotifications, listResponsibles, listStudents, resendNotification } from "@/lib/resources";

export default function Notificacoes() {
  const queryClient = useQueryClient();
  const keys = useTenantResourceKeyFactory();
  const [tipo, setTipo] = useState("all");
  const [status, setStatus] = useState("all");

  const notificationsQuery = useQuery({
    queryKey: [...keys.notifications, tipo, status] as const,
    queryFn: () =>
      listNotifications({
        tipo: tipo === "all" ? undefined : tipo,
        status: status === "all" ? undefined : status,
      }),
  });

  const studentsQuery = useQuery({
    queryKey: keys.students,
    queryFn: listStudents,
  });

  const responsiblesQuery = useQuery({
    queryKey: keys.responsibles,
    queryFn: listResponsibles,
  });

  const resendMutation = useMutation({
    mutationFn: resendNotification,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.notifications });
      toast.success("Notificação reenviada");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Falha ao reenviar notificação"),
  });

  const statusVariant = (value: string) => (value === "Entregue" ? "ok" : value === "Falhou" ? "alerta" : "atencao");

  const list = useMemo(() => notificationsQuery.data ?? [], [notificationsQuery.data]);

  return (
    <>
      <PageHeader
        title="Notificações"
        subtitle="Histórico de alertas enviados aos responsáveis"
        breadcrumb={[{ label: "Início", href: "/" }, { label: "Notificações" }]}
      />

      <div className="glass-card p-4 mb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <Select value={tipo} onValueChange={setTipo}>
          <SelectTrigger>
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            {["Entrada", "Saída", "Falta", "Atraso"].map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger>
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos status</SelectItem>
            {["Entregue", "Falhou", "Pendente"].map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
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
              {list.map((notification) => {
                const student = studentsQuery.data?.find((item) => item.id === notification.alunoId);
                const responsible = responsiblesQuery.data?.find((item) => item.id === notification.responsavelId);

                if (!student || !responsible) {
                  return null;
                }

                return (
                  <tr key={notification.id} className="border-b border-border hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-3">
                      <StatusBadge variant={notification.tipo === "Entrada" ? "presente" : notification.tipo === "Saída" ? "saiu" : "alerta"}>
                        {notification.tipo}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <img src={student.foto} className="h-7 w-7 rounded-full bg-muted border border-primary/30 object-cover" />
                        {student.nome}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {responsible.nome}
                      <br />
                      <span className="text-[11px] font-mono">{responsible.whatsapp}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-xs">
                        {notification.canal === "WhatsApp" ? (
                          <MessageCircle className="h-3.5 w-3.5 text-secondary" />
                        ) : (
                          <Smartphone className="h-3.5 w-3.5 text-primary" />
                        )}
                        {notification.canal}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono">{notification.horario}</td>
                    <td className="px-4 py-3">
                      <StatusBadge variant={statusVariant(notification.status) as "ok" | "alerta" | "atencao"}>{notification.status}</StatusBadge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {notification.status === "Falhou" && (
                        <Button size="sm" variant="outline" onClick={() => resendMutation.mutate(notification.id)}>
                          <RefreshCw className="h-3.5 w-3.5 mr-1" />
                          Reenviar
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {list.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    <Bell className="h-10 w-10 mx-auto mb-2 opacity-40" />
                    Nenhuma notificação encontrada.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
