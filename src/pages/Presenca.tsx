import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Download, MessageCircle, Save, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTenantResourceKeyFactory } from "@/context/auth-context";
import type { StudentPresence } from "@/lib/domain";
import { formatWhatsAppLink } from "@/lib/whatsapp";
import { listPresence, listResponsibles, listSchools, updatePresence } from "@/lib/resources";

export default function Presenca() {
  const queryClient = useQueryClient();
  const keys = useTenantResourceKeyFactory();
  const [escolaId, setEscolaId] = useState("");
  const [turma, setTurma] = useState<string>("all");
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));

  const schoolsQuery = useQuery({
    queryKey: keys.schools,
    queryFn: listSchools,
  });

  useEffect(() => {
    if (!escolaId && schoolsQuery.data?.[0]?.id) {
      setEscolaId(schoolsQuery.data[0].id);
    }
  }, [escolaId, schoolsQuery.data]);

  const presenceQuery = useQuery({
    queryKey: [...keys.students, escolaId, turma, data] as const,
    queryFn: () => listPresence({ schoolId: escolaId, date: data, turma: turma === "all" ? undefined : turma }),
    enabled: Boolean(escolaId),
  });

  const responsiblesQuery = useQuery({
    queryKey: keys.responsibles,
    queryFn: listResponsibles,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ studentId, status }: { studentId: string; status: StudentPresence }) =>
      updatePresence(studentId, { presencaHoje: status }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.students });
      await queryClient.invalidateQueries({ queryKey: keys.cameraEvents });
      await queryClient.invalidateQueries({ queryKey: [...keys.students, escolaId, turma, data] });
      toast.success("Presença atualizada");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Falha ao atualizar presença"),
  });

  const turmas = useMemo(
    () => Array.from(new Set((presenceQuery.data ?? []).map((student) => student.turma))),
    [presenceQuery.data],
  );

  const list = presenceQuery.data ?? [];
  const presentes = list.filter((student) => student.presencaHoje === "presente").length;
  const atrasados = list.filter((student) => student.presencaHoje === "atrasado").length;
  const ausentes = list.filter((student) => student.presencaHoje === "ausente").length;

  return (
    <>
      <PageHeader
        title="Turmas & Presença"
        subtitle="Controle diário de entradas, saídas e ausências"
        breadcrumb={[{ label: "Início", href: "/" }, { label: "Presença" }]}
        actions={
          <Button variant="outline" disabled title="Endpoint de relatórios ainda não exposto pela API">
            <Download className="h-4 w-4 mr-1" />
            Exportar PDF
          </Button>
        }
      />

      <div className="glass-card p-4 mb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <Select value={escolaId} onValueChange={setEscolaId}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione a escola" />
          </SelectTrigger>
          <SelectContent>
            {schoolsQuery.data?.map((school) => (
              <SelectItem key={school.id} value={school.id}>
                {school.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={turma} onValueChange={setTurma}>
          <SelectTrigger>
            <SelectValue placeholder="Turma" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as turmas</SelectItem>
            {turmas.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input type="date" value={data} onChange={(event) => setData(event.target.value)} />
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="glass-card p-4 text-center">
          <div className="text-xs font-display tracking-widest text-muted-foreground">PRESENTES</div>
          <div className="font-display text-3xl font-bold text-secondary">{presentes}</div>
        </div>
        <div className="glass-card p-4 text-center">
          <div className="text-xs font-display tracking-widest text-muted-foreground">ATRASADOS</div>
          <div className="font-display text-3xl font-bold text-warning">{atrasados}</div>
        </div>
        <div className="glass-card p-4 text-center">
          <div className="text-xs font-display tracking-widest text-muted-foreground">AUSENTES</div>
          <div className="font-display text-3xl font-bold text-destructive">{ausentes}</div>
        </div>
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
                <th className="px-4 py-3">Alterar status</th>
                <th className="px-4 py-3 text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {list.map((student) => {
                const responsible = responsiblesQuery.data?.find((item) => item.id === student.responsavelPrincipalId);
                const link = responsible
                  ? formatWhatsAppLink(responsible.whatsapp, `Atualização sobre ${student.nome.split(" ")[0]}: status ${student.presencaHoje}.`)
                  : undefined;
                const notificado = student.presencaHoje !== "ausente";

                return (
                  <tr key={student.id} className="border-b border-primary/5 hover:bg-primary/5">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <img src={student.foto} className="h-8 w-8 rounded-full bg-muted border border-primary/30 object-cover" />
                        <span className="font-medium">{student.nome}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{student.turma}</td>
                    <td className="px-4 py-3 font-mono">{student.horarioEntrada || "—"}</td>
                    <td className="px-4 py-3 font-mono">{student.horarioSaida || "—"}</td>
                    <td className="px-4 py-3">
                      <StatusBadge variant={student.presencaHoje as StudentPresence} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      {notificado ? <Check className="h-4 w-4 text-secondary inline" /> : <X className="h-4 w-4 text-destructive inline" />}
                    </td>
                    <td className="px-4 py-3">
                      <Select
                        value={student.presencaHoje}
                        onValueChange={(value) => updateMutation.mutate({ studentId: student.id, status: value as StudentPresence })}
                      >
                        <SelectTrigger className="w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["presente", "atrasado", "ausente", "saiu"].map((value) => (
                            <SelectItem key={value} value={value}>
                              {value}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {link && (
                        <a
                          href={link}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-secondary border border-secondary/40 bg-secondary/10 hover:bg-secondary/20 rounded-md px-2 py-1"
                        >
                          <MessageCircle className="h-3 w-3" />
                          WhatsApp
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
              {list.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                    Nenhum aluno encontrado para essa seleção.
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
