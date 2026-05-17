import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, Pencil, Phone, Plus, Search, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTenantResourceKeyFactory } from "@/context/auth-context";
import type { Aluno, Responsavel } from "@/lib/domain";
import { createResponsible, deleteResponsible, listResponsibles, listStudents, updateResponsible } from "@/lib/resources";

type ResponsibleForm = {
  id?: string;
  nome: string;
  cpf: string;
  whatsapp: string;
  email: string;
  parentesco: Responsavel["parentesco"];
  password: string;
  ativo: boolean;
};

const emptyForm: ResponsibleForm = {
  nome: "",
  cpf: "",
  whatsapp: "",
  email: "",
  parentesco: "Mãe",
  password: "",
  ativo: true,
};

const maskCPF = (value: string) =>
  value
    .replace(/\D/g, "")
    .slice(0, 11)
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1-$2");

const maskWhats = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 13);
  if (digits.length <= 2) return `+${digits}`;
  if (digits.length <= 4) return `+${digits.slice(0, 2)} (${digits.slice(2)}`;
  if (digits.length <= 9) return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4)}`;
  return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
};

function avatarFallback(name: string) {
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name)}`;
}

export default function Responsaveis() {
  const queryClient = useQueryClient();
  const keys = useTenantResourceKeyFactory();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<ResponsibleForm>(emptyForm);

  const responsiblesQuery = useQuery({
    queryKey: keys.responsibles,
    queryFn: listResponsibles,
  });

  const studentsQuery = useQuery({
    queryKey: keys.students,
    queryFn: listStudents,
  });

  const createMutation = useMutation({
    mutationFn: createResponsible,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.responsibles });
      await queryClient.invalidateQueries({ queryKey: keys.students });
      toast.success("Responsável cadastrado");
      setOpen(false);
      setForm(emptyForm);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Falha ao cadastrar responsável"),
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: ResponsibleForm) => {
      if (!payload.id) {
        throw new Error("Responsável inválido para atualização");
      }
      return updateResponsible(payload.id, payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.responsibles });
      await queryClient.invalidateQueries({ queryKey: keys.students });
      toast.success("Responsável atualizado");
      setOpen(false);
      setForm(emptyForm);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Falha ao atualizar responsável"),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteResponsible,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.responsibles });
      await queryClient.invalidateQueries({ queryKey: keys.students });
      toast.success("Responsável removido");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Falha ao remover responsável"),
  });

  const responsiblesWithChildren = useMemo(() => {
    const students = studentsQuery.data ?? [];
    return (responsiblesQuery.data ?? []).map((responsible) => ({
      ...responsible,
      filhos: students.filter((student) => student.responsaveisIds.includes(responsible.id)),
    }));
  }, [responsiblesQuery.data, studentsQuery.data]);

  const filtered = responsiblesWithChildren.filter((responsible) => responsible.nome.toLowerCase().includes(search.toLowerCase()));

  const startEdit = (responsible: Responsavel) => {
    setForm({
      id: responsible.id,
      nome: responsible.nome,
      cpf: responsible.cpf,
      whatsapp: responsible.whatsapp,
      email: responsible.email,
      parentesco: responsible.parentesco,
      password: "",
      ativo: responsible.ativo,
    });
    setOpen(true);
  };

  const handleSubmit = () => {
    if (!form.nome || !form.cpf || !form.whatsapp || !form.email) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }

    const payload = {
      nome: form.nome,
      cpf: form.cpf,
      whatsapp: form.whatsapp,
      email: form.email,
      parentesco: form.parentesco,
      ativo: form.ativo,
      password: form.password || undefined,
      foto: form.id ? undefined : avatarFallback(form.nome),
      filhosIds: [],
    };

    if (form.id) {
      updateMutation.mutate({ ...form, ...payload });
      return;
    }

    if (!form.password) {
      toast.error("Informe uma senha de acesso");
      return;
    }

    createMutation.mutate(payload);
  };

  return (
    <>
      <PageHeader
        title="Pais & Responsáveis"
        subtitle="Cadastro de responsáveis legais que recebem notificações"
        breadcrumb={[{ label: "Início", href: "/" }, { label: "Responsáveis" }]}
        actions={
          <Button
            onClick={() => {
              setForm(emptyForm);
              setOpen(true);
            }}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4 mr-1" /> Novo Responsável
          </Button>
        }
      />

      <div className="glass-card p-4 mb-4 flex items-center gap-3">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="border-0 bg-transparent focus-visible:ring-0"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {responsiblesQuery.isLoading && (
          <div className="glass-card p-8 text-center text-muted-foreground md:col-span-2 lg:col-span-3">Carregando responsáveis...</div>
        )}

        {filtered.map((responsible) => (
          <div key={responsible.id} className="glass-card p-4 hover:border-primary/40 transition relative">
            <div className="absolute right-3 top-3 flex items-center gap-1">
              <Button variant="ghost" size="icon" onClick={() => startEdit(responsible)} title="Editar responsável">
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  if (window.confirm(`Remover ${responsible.nome}?`)) {
                    deleteMutation.mutate(responsible.id);
                  }
                }}
                title="Remover responsável"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
            <div className="flex items-center gap-3">
              <img
                src={responsible.foto || avatarFallback(responsible.nome)}
                alt=""
                className="h-14 w-14 rounded-full border-2 border-primary/40 bg-muted object-cover"
                onError={(event) => {
                  event.currentTarget.src = avatarFallback(responsible.nome);
                }}
              />
              <div className="min-w-0 flex-1 pr-16">
                <div className="font-display font-semibold truncate">{responsible.nome}</div>
                <div className="text-xs text-muted-foreground">{responsible.parentesco}</div>
              </div>
              <StatusBadge variant={responsible.ativo ? "ativo" : "inativo"}>
                {responsible.ativo ? "Ativo" : "Inativo"}
              </StatusBadge>
            </div>
            <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5 text-secondary" />
                {responsible.whatsapp}
              </div>
              <div className="flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 text-primary" />
                {responsible.email}
              </div>
              <div className="flex items-center gap-2">
                <Users className="h-3.5 w-3.5 text-primary" />
                {responsible.filhos.length} filho(s) vinculado(s)
              </div>
            </div>
            {responsible.filhos.length > 0 && (
              <div className="mt-3 flex -space-x-2">
                {responsible.filhos.slice(0, 4).map((child: Aluno) => (
                  <img
                    key={child.id}
                    src={child.foto}
                    title={child.nome}
                    className="h-7 w-7 rounded-full border-2 border-card bg-muted object-cover"
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {filtered.length === 0 && !responsiblesQuery.isLoading && (
        <div className="glass-card p-12 text-center text-muted-foreground mt-4">
          <Users className="h-10 w-10 mx-auto mb-2 opacity-40" />
          Nenhum responsável encontrado.
        </div>
      )}

      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setForm(emptyForm);
        }}
      >
        <DialogContent className="max-w-2xl glass-card max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display tracking-wide text-xl">
              {form.id ? "Editar Responsável" : "Novo Responsável"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Label>Nome completo *</Label>
              <Input value={form.nome} onChange={(event) => setForm({ ...form, nome: event.target.value })} />
            </div>
            <div>
              <Label>CPF *</Label>
              <Input
                value={form.cpf}
                onChange={(event) => setForm({ ...form, cpf: maskCPF(event.target.value) })}
                placeholder="000.000.000-00"
              />
            </div>
            <div>
              <Label>Grau de parentesco</Label>
              <Select value={form.parentesco} onValueChange={(value) => setForm({ ...form, parentesco: value as Responsavel["parentesco"] })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["Pai", "Mãe", "Avó", "Avô", "Tio", "Tia", "Responsável Legal", "Outro"].map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>WhatsApp *</Label>
              <Input
                value={form.whatsapp}
                onChange={(event) => setForm({ ...form, whatsapp: maskWhats(event.target.value) })}
                placeholder="+55 (00) 00000-0000"
              />
            </div>
            <div>
              <Label>E-mail *</Label>
              <Input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
            </div>
            <div className="md:col-span-2">
              <Label>Senha de acesso ao app *</Label>
              <Input
                type="password"
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
                placeholder="Mínimo 8 caracteres"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleSubmit}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {form.id ? "Salvar Alterações" : "Cadastrar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
