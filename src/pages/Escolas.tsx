import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTenantResourceKeyFactory } from "@/context/auth-context";
import type { Escola } from "@/lib/domain";
import { createSchool, deleteSchool, listSchools, listStudents, listCameras, updateSchool } from "@/lib/resources";

type SchoolForm = {
  id?: string;
  nome: string;
  cnpj: string;
  telefone: string;
  email: string;
  endereco: string;
  cidade: string;
  estado: string;
  horarioEntrada: string;
  horarioSaida: string;
  toleranciaMin: number;
  ativa: boolean;
  logo?: string;
};

const emptyForm: SchoolForm = {
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
};

const maskCNPJ = (value: string) =>
  value
    .replace(/\D/g, "")
    .slice(0, 14)
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");

export default function Escolas() {
  const queryClient = useQueryClient();
  const keys = useTenantResourceKeyFactory();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<SchoolForm>(emptyForm);

  const schoolsQuery = useQuery({
    queryKey: keys.schools,
    queryFn: listSchools,
  });

  const studentsQuery = useQuery({
    queryKey: keys.students,
    queryFn: listStudents,
  });

  const camerasQuery = useQuery({
    queryKey: keys.cameras,
    queryFn: listCameras,
  });

  const createMutation = useMutation({
    mutationFn: createSchool,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.schools });
      await queryClient.invalidateQueries({ queryKey: keys.students });
      await queryClient.invalidateQueries({ queryKey: keys.cameras });
      toast.success("Escola cadastrada com sucesso");
      setOpen(false);
      setForm(emptyForm);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Falha ao cadastrar escola"),
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: SchoolForm) => {
      if (!payload.id) {
        throw new Error("Escola inválida para atualização");
      }
      return updateSchool(payload.id, payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.schools });
      await queryClient.invalidateQueries({ queryKey: keys.students });
      await queryClient.invalidateQueries({ queryKey: keys.cameras });
      toast.success("Escola atualizada com sucesso");
      setOpen(false);
      setForm(emptyForm);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Falha ao atualizar escola"),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSchool,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.schools });
      await queryClient.invalidateQueries({ queryKey: keys.students });
      await queryClient.invalidateQueries({ queryKey: keys.cameras });
      toast.success("Escola removida");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Falha ao remover escola"),
  });

  const enriched = useMemo(() => {
    const students = studentsQuery.data ?? [];
    const cameras = camerasQuery.data ?? [];
    const totalAlunos = students.reduce<Record<string, number>>((acc, aluno) => {
      acc[aluno.escolaId] = (acc[aluno.escolaId] || 0) + 1;
      return acc;
    }, {});
    const totalCameras = cameras.reduce<Record<string, number>>((acc, camera) => {
      acc[camera.escolaId] = (acc[camera.escolaId] || 0) + 1;
      return acc;
    }, {});

    return (schoolsQuery.data ?? []).map((school) => ({
      ...school,
      totalAlunos: totalAlunos[school.id] ?? school.totalAlunos ?? 0,
      totalCameras: totalCameras[school.id] ?? school.totalCameras ?? 0,
    }));
  }, [camerasQuery.data, schoolsQuery.data, studentsQuery.data]);

  const filtered = enriched.filter((school) => school.nome.toLowerCase().includes(search.toLowerCase()));

  const startEdit = (school: Escola) => {
    setForm({
      id: school.id,
      nome: school.nome,
      cnpj: school.cnpj,
      telefone: school.telefone,
      email: school.email,
      endereco: school.endereco,
      cidade: school.cidade,
      estado: school.estado,
      horarioEntrada: school.horarioEntrada,
      horarioSaida: school.horarioSaida,
      toleranciaMin: school.toleranciaMin,
      ativa: school.ativa,
      logo: school.logo,
    });
    setOpen(true);
  };

  const handleSubmit = () => {
    if (!form.nome || !form.cnpj) {
      toast.error("Preencha nome e CNPJ");
      return;
    }

    const payload: Partial<Escola> = {
      nome: form.nome,
      cnpj: form.cnpj,
      telefone: form.telefone,
      email: form.email,
      endereco: form.endereco,
      cidade: form.cidade,
      estado: form.estado,
      horarioEntrada: form.horarioEntrada,
      horarioSaida: form.horarioSaida,
      toleranciaMin: Number(form.toleranciaMin || 15),
      ativa: form.ativa,
      logo: form.logo,
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
        title="Escolas"
        subtitle="Gerencie as instituições conectadas ao sistema"
        breadcrumb={[{ label: "Início", href: "/" }, { label: "Escolas" }]}
        actions={
          <Button
            onClick={() => {
              setForm(emptyForm);
              setOpen(true);
            }}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4 mr-1" /> Nova Escola
          </Button>
        }
      />

      <div className="glass-card p-4 mb-4 flex items-center gap-3">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar escola..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="border-0 bg-transparent focus-visible:ring-0"
        />
      </div>

      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted border-b border-border">
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">Logo</th>
                <th className="px-4 py-3">Escola</th>
                <th className="px-4 py-3">CNPJ</th>
                <th className="px-4 py-3">Cidade</th>
                <th className="px-4 py-3 text-center">Alunos</th>
                <th className="px-4 py-3 text-center">Câmeras</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {schoolsQuery.isLoading && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                    Carregando escolas...
                  </td>
                </tr>
              )}

              {filtered.map((school) => (
                <tr key={school.id} className="border-b border-border hover:bg-muted/50 transition-colors">
                  <td className="px-4 py-3">
                    <img
                      src={school.logo}
                      alt=""
                      className="h-10 w-10 rounded-lg border border-border bg-muted object-cover"
                      onError={(event) => {
                        const target = event.currentTarget;
                        target.src = `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(school.nome)}`;
                      }}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{school.nome}</div>
                    <div className="text-xs text-muted-foreground">{school.endereco}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{school.cnpj}</td>
                  <td className="px-4 py-3">
                    {school.cidade}/{school.estado}
                  </td>
                  <td className="px-4 py-3 text-center font-display font-bold text-primary">{school.totalAlunos}</td>
                  <td className="px-4 py-3 text-center font-display font-bold text-secondary">{school.totalCameras}</td>
                  <td className="px-4 py-3">
                    <StatusBadge variant={school.ativa ? "ativo" : "inativo"} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => startEdit(school)} title="Editar escola">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (window.confirm(`Remover ${school.nome}?`)) {
                            deleteMutation.mutate(school.id);
                          }
                        }}
                        title="Remover escola"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && !schoolsQuery.isLoading && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                    <Building2 className="h-10 w-10 mx-auto mb-2 opacity-40" />
                    Nenhuma escola encontrada.
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
        <DialogContent className="max-w-2xl glass-card">
          <DialogHeader>
            <DialogTitle className="font-display tracking-wide text-xl">
              {form.id ? "Editar Escola" : "Nova Escola"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Label>Nome da Escola *</Label>
              <Input value={form.nome} onChange={(event) => setForm({ ...form, nome: event.target.value })} />
            </div>
            <div>
              <Label>CNPJ *</Label>
              <Input
                value={form.cnpj}
                onChange={(event) => setForm({ ...form, cnpj: maskCNPJ(event.target.value) })}
                placeholder="00.000.000/0000-00"
              />
            </div>
            <div>
              <Label>Telefone</Label>
              <Input value={form.telefone} onChange={(event) => setForm({ ...form, telefone: event.target.value })} />
            </div>
            <div className="md:col-span-2">
              <Label>E-mail institucional</Label>
              <Input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
            </div>
            <div className="md:col-span-2">
              <Label>Endereço completo</Label>
              <Input value={form.endereco} onChange={(event) => setForm({ ...form, endereco: event.target.value })} />
            </div>
            <div>
              <Label>Cidade</Label>
              <Input value={form.cidade} onChange={(event) => setForm({ ...form, cidade: event.target.value })} />
            </div>
            <div>
              <Label>Estado</Label>
              <Input value={form.estado} onChange={(event) => setForm({ ...form, estado: event.target.value })} maxLength={2} />
            </div>
            <div>
              <Label>Horário de entrada</Label>
              <Input type="time" value={form.horarioEntrada} onChange={(event) => setForm({ ...form, horarioEntrada: event.target.value })} />
            </div>
            <div>
              <Label>Horário de saída</Label>
              <Input type="time" value={form.horarioSaida} onChange={(event) => setForm({ ...form, horarioSaida: event.target.value })} />
            </div>
            <div>
              <Label>Tolerância de atraso (min)</Label>
              <Input
                type="number"
                value={form.toleranciaMin}
                onChange={(event) => setForm({ ...form, toleranciaMin: Number(event.target.value) })}
              />
            </div>
            <div className="flex items-center gap-2 mt-6">
              <Switch checked={form.ativa} onCheckedChange={(value) => setForm({ ...form, ativa: value })} />
              <Label>Escola Ativa</Label>
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
              Salvar Escola
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
