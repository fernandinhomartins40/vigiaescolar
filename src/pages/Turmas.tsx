import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers3, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useTenantResourceKeyFactory } from "@/context/auth-context";
import type { Shift, Turma } from "@/lib/domain";
import { createTurma, deleteTurma, listSchools, listTurmas, updateTurma } from "@/lib/resources";

type TurmaForm = {
  id?: string;
  nome: string;
  escolaId: string;
  turno: Shift;
  ativa: boolean;
};

const emptyForm: TurmaForm = {
  nome: "",
  escolaId: "",
  turno: "Manhã",
  ativa: true,
};

const shiftOptions: Shift[] = ["Manhã", "Tarde", "Integral"];

export default function Turmas() {
  const queryClient = useQueryClient();
  const keys = useTenantResourceKeyFactory();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [schoolFilter, setSchoolFilter] = useState<string>("all");
  const [shiftFilter, setShiftFilter] = useState<string>("all");
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [form, setForm] = useState<TurmaForm>(emptyForm);

  const schoolsQuery = useQuery({
    queryKey: keys.schools,
    queryFn: listSchools,
  });

  const turmasQuery = useQuery({
    queryKey: keys.turmas,
    queryFn: listTurmas,
  });

  const turmasById = useMemo(
    () => new Map((turmasQuery.data ?? []).map((turma) => [turma.id, turma])),
    [turmasQuery.data],
  );

  const filtered = useMemo(() => {
    return (turmasQuery.data ?? []).filter((turma) => {
      const matchesSearch =
        turma.nome.toLowerCase().includes(search.toLowerCase()) ||
        turma.escolaNome.toLowerCase().includes(search.toLowerCase());
      const matchesSchool = schoolFilter === "all" || turma.escolaId === schoolFilter;
      const matchesShift = shiftFilter === "all" || turma.turno === shiftFilter;
      const matchesActive =
        activeFilter === "all" ? true : activeFilter === "true" ? turma.ativa : !turma.ativa;

      return matchesSearch && matchesSchool && matchesShift && matchesActive;
    });
  }, [activeFilter, schoolFilter, search, shiftFilter, turmasQuery.data]);

  const createMutation = useMutation({
    mutationFn: createTurma,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.turmas });
      await queryClient.invalidateQueries({ queryKey: keys.students });
      toast.success("Turma cadastrada com sucesso");
      setOpen(false);
      setForm(emptyForm);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Falha ao cadastrar turma"),
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: TurmaForm) => {
      if (!payload.id) {
        throw new Error("Turma inválida para atualização");
      }
      return updateTurma(payload.id, payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.turmas });
      await queryClient.invalidateQueries({ queryKey: keys.students });
      toast.success("Turma atualizada com sucesso");
      setOpen(false);
      setForm(emptyForm);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Falha ao atualizar turma"),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteTurma,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.turmas });
      await queryClient.invalidateQueries({ queryKey: keys.students });
      toast.success("Turma removida");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Falha ao remover turma"),
  });

  const startEdit = (turma: Turma) => {
    setForm({
      id: turma.id,
      nome: turma.nome,
      escolaId: turma.escolaId,
      turno: turma.turno,
      ativa: turma.ativa,
    });
    setOpen(true);
  };

  const handleSubmit = () => {
    if (!form.nome || !form.escolaId || !form.turno) {
      toast.error("Preencha nome, escola e turno");
      return;
    }

    const payload: Partial<Turma> = {
      nome: form.nome,
      escolaId: form.escolaId,
      turno: form.turno,
      ativa: form.ativa,
    };

    if (form.id) {
      updateMutation.mutate({ ...form, ...payload });
      return;
    }

    createMutation.mutate(payload);
  };

  return (
    <>
      <PageHeader
        title="Turmas"
        subtitle="Cadastre turmas por escola e turno para usar no cadastro dos alunos"
        breadcrumb={[{ label: "Início", href: "/" }, { label: "Turmas" }]}
        actions={
          <Button
            onClick={() => {
              setForm(emptyForm);
              setOpen(true);
            }}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4 mr-1" /> Nova Turma
          </Button>
        }
      />

      <div className="glass-card p-4 mb-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="flex items-center gap-2 md:col-span-2">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            placeholder="Buscar turma ou escola..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="border-0 bg-transparent focus-visible:ring-0"
          />
        </div>
        <Select value={schoolFilter} onValueChange={setSchoolFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Todas as escolas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as escolas</SelectItem>
            {schoolsQuery.data?.map((school) => (
              <SelectItem key={school.id} value={school.id}>
                {school.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={shiftFilter} onValueChange={setShiftFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Todos os turnos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os turnos</SelectItem>
            {shiftOptions.map((shift) => (
              <SelectItem key={shift} value={shift}>
                {shift}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={activeFilter} onValueChange={setActiveFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Todos os status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="true">Ativas</SelectItem>
            <SelectItem value="false">Inativas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-background/40 border-b border-primary/10">
              <tr className="text-left font-display tracking-wider text-xs uppercase text-muted-foreground">
                <th className="px-4 py-3">Turma</th>
                <th className="px-4 py-3">Escola</th>
                <th className="px-4 py-3">Turno</th>
                <th className="px-4 py-3 text-center">Alunos</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {turmasQuery.isLoading && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    Carregando turmas...
                  </td>
                </tr>
              )}

              {filtered.map((turma) => (
                <tr key={turma.id} className="border-b border-primary/5 hover:bg-primary/5 transition">
                  <td className="px-4 py-3">
                    <div className="font-medium">{turma.nome}</div>
                    <div className="text-xs text-muted-foreground">{turma.turno}</div>
                  </td>
                  <td className="px-4 py-3">{turma.escolaNome}</td>
                  <td className="px-4 py-3">{turma.turno}</td>
                  <td className="px-4 py-3 text-center font-display font-bold text-primary">{turma.totalAlunos}</td>
                  <td className="px-4 py-3">
                    <StatusBadge variant={turma.ativa ? "ativo" : "inativo"} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => startEdit(turma)} title="Editar turma">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={turma.totalAlunos > 0 || deleteMutation.isPending}
                        onClick={() => {
                          if (window.confirm(`Remover ${turma.nome}?`)) {
                            deleteMutation.mutate(turma.id);
                          }
                        }}
                        title={turma.totalAlunos > 0 ? "Remova os alunos vinculados antes de excluir" : "Remover turma"}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}

              {filtered.length === 0 && !turmasQuery.isLoading && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    <Layers3 className="h-10 w-10 mx-auto mb-2 opacity-40" />
                    Nenhuma turma encontrada.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) {
            setForm(emptyForm);
          }
        }}
      >
        <DialogContent className="max-w-xl glass-card">
          <DialogHeader>
            <DialogTitle className="font-display tracking-wide text-xl">
              {form.id ? "Editar Turma" : "Nova Turma"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4">
            <div>
              <Label>Nome da Turma *</Label>
              <Input value={form.nome} onChange={(event) => setForm({ ...form, nome: event.target.value })} />
            </div>
            <div>
              <Label>Escola *</Label>
              <Select value={form.escolaId} onValueChange={(value) => setForm({ ...form, escolaId: value })}>
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
            </div>
            <div>
              <Label>Turno *</Label>
              <Select value={form.turno} onValueChange={(value) => setForm({ ...form, turno: value as Shift })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {shiftOptions.map((shift) => (
                    <SelectItem key={shift} value={shift}>
                      {shift}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-primary/15 bg-background/40 p-3">
              <div>
                <div className="text-sm font-medium">Turma ativa</div>
                <div className="text-xs text-muted-foreground">Turmas inativas não aparecem como opção no cadastro de alunos.</div>
              </div>
              <Switch checked={form.ativa} onCheckedChange={(checked) => setForm({ ...form, ativa: checked })} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} className="bg-primary text-primary-foreground hover:bg-primary/90" type="button">
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
