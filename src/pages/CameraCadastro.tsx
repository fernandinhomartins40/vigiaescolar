import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Camera, Pencil, Save, Trash2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTenantResourceKeyFactory } from "@/context/auth-context";
import type { Camera as CameraEntity } from "@/lib/domain";
import { createCamera, deleteCamera, ensureDeviceCameraSource, listCameras, listSchools, updateCamera } from "@/lib/resources";

type CameraForm = {
  id?: string;
  nome: string;
  escolaId: string;
  localizacao: string;
  tipo: CameraEntity["tipo"];
  url: string;
  porta: number;
  resolucao: CameraEntity["resolucao"];
  fps: number;
  status: CameraEntity["status"];
  usuario: string;
  senha: string;
};

const emptyForm: CameraForm = {
  nome: "",
  escolaId: "",
  localizacao: "",
  tipo: "RTSP",
  url: "",
  porta: 554,
  resolucao: "1080p",
  fps: 30,
  status: "Ativa",
  usuario: "",
  senha: "",
};

export default function CameraCadastro() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const keys = useTenantResourceKeyFactory();
  const [form, setForm] = useState<CameraForm>(emptyForm);

  const schoolsQuery = useQuery({
    queryKey: keys.schools,
    queryFn: listSchools,
  });

  const camerasQuery = useQuery({
    queryKey: keys.cameras,
    queryFn: listCameras,
  });

  const createMutation = useMutation({
    mutationFn: createCamera,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.cameras });
      toast.success("Câmera cadastrada com sucesso");
      setForm(emptyForm);
      navigate("/cameras");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Falha ao cadastrar câmera"),
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: CameraForm) => {
      if (!payload.id) {
        throw new Error("Câmera inválida para atualização");
      }
      return updateCamera(payload.id, payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.cameras });
      toast.success("Câmera atualizada");
      setForm(emptyForm);
      navigate("/cameras");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Falha ao atualizar câmera"),
  });

  const ensureDeviceMutation = useMutation({
    mutationFn: async (payload: CameraForm) => {
      const schoolId = payload.escolaId;
      if (!schoolId) {
        throw new Error("Selecione a escola da câmera do dispositivo");
      }

      const deviceCamera = await ensureDeviceCameraSource(schoolId);
      return updateCamera(deviceCamera.id, {
        nome: payload.nome || "Câmera do dispositivo",
        escolaId: schoolId,
        localizacao: payload.localizacao || "Dispositivo local",
        tipo: "USB",
        url: "device://live",
        resolucao: payload.resolucao,
        fps: Number(payload.fps || 30),
        status: payload.status,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.cameras });
      toast.success("Câmera do dispositivo cadastrada");
      setForm(emptyForm);
      navigate("/cameras");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Falha ao cadastrar câmera do dispositivo"),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCamera,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.cameras });
      toast.success("Câmera removida");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Falha ao remover câmera"),
  });

  const activeCameras = useMemo(() => camerasQuery.data ?? [], [camerasQuery.data]);

  const startEdit = (camera: CameraEntity) => {
    setForm({
      id: camera.id,
      nome: camera.nome,
      escolaId: camera.escolaId,
      localizacao: camera.localizacao,
      tipo: camera.tipo,
      url: camera.url,
      porta: Number((camera.url.split(":").slice(-1)[0] || "554").split("/")[0]) || 554,
      resolucao: camera.resolucao,
      fps: camera.fps,
      status: camera.status,
      usuario: camera.usuario ?? "",
      senha: camera.senha ?? "",
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!form.nome || !form.escolaId || (form.tipo !== "USB" && !form.url)) {
      toast.error("Preencha os campos obrigatórios");
      return;
    }

    const payload: CameraForm = {
      ...form,
      url: form.tipo === "USB" ? "device://live" : form.url,
      localizacao: form.tipo === "USB" ? form.localizacao || "Dispositivo local" : form.localizacao,
      fps: Number(form.fps || 30),
    };

    if (form.id) {
      updateMutation.mutate(payload);
      return;
    }

    if (form.tipo === "USB") {
      ensureDeviceMutation.mutate(payload);
      return;
    }

    createMutation.mutate(payload);
  };

  return (
    <>
      <PageHeader
        title="Cadastrar Câmera"
        subtitle="Adicione uma nova câmera de reconhecimento facial"
        breadcrumb={[{ label: "Início", href: "/" }, { label: "Câmeras", href: "/cameras" }, { label: "Cadastrar" }]}
        actions={
          <Link to="/cameras">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Voltar
            </Button>
          </Link>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <form onSubmit={handleSubmit} className="glass-card p-5 lg:col-span-2 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Nome / Identificação *</Label>
              <Input
                placeholder="Ex: Portão Principal"
                value={form.nome}
                onChange={(event) => setForm({ ...form, nome: event.target.value })}
              />
            </div>
            <div>
              <Label>Escola vinculada *</Label>
              <Select value={form.escolaId} onValueChange={(value) => setForm({ ...form, escolaId: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
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
            <div className="md:col-span-2">
              <Label>Localização</Label>
              <Input
                placeholder="Ex: Entrada principal lado norte"
                value={form.localizacao}
                onChange={(event) => setForm({ ...form, localizacao: event.target.value })}
              />
            </div>
            <div>
              <Label>Tipo</Label>
              <Select
                value={form.tipo}
                onValueChange={(value) =>
                  setForm({
                    ...form,
                    tipo: value as CameraEntity["tipo"],
                    nome:
                      value === "USB" && !form.nome
                        ? "Câmera do dispositivo"
                        : form.nome,
                    localizacao:
                      value === "USB" && !form.localizacao
                        ? "Dispositivo local"
                        : form.localizacao,
                    url: value === "USB" ? "device://live" : form.url === "device://live" ? "" : form.url,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    { value: "IP", label: "IP" },
                    { value: "USB", label: "Câmera do dispositivo" },
                    { value: "RTSP", label: "RTSP" },
                  ].map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Resolução</Label>
              <Select
                value={form.resolucao}
                onValueChange={(value) => setForm({ ...form, resolucao: value as CameraEntity["resolucao"] })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["720p", "1080p", "4K"].map((resolution) => (
                    <SelectItem key={resolution} value={resolution}>
                      {resolution}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label>{form.tipo === "USB" ? "Fonte de vídeo" : "URL Stream / IP *"}</Label>
              <Input
                placeholder={form.tipo === "USB" ? "device://live" : "rtsp://192.168.0.10:554/stream"}
                value={form.tipo === "USB" ? "device://live" : form.url}
                onChange={(event) => setForm({ ...form, url: event.target.value })}
                disabled={form.tipo === "USB"}
              />
            </div>
            <div>
              <Label>Porta</Label>
              <Input
                type="number"
                value={form.porta}
                onChange={(event) => setForm({ ...form, porta: Number(event.target.value) })}
                disabled={form.tipo === "USB"}
              />
            </div>
            <div>
              <Label>FPS</Label>
              <Input type="number" value={form.fps} onChange={(event) => setForm({ ...form, fps: Number(event.target.value) })} />
            </div>
            <div>
              <Label>Usuário</Label>
              <Input
                value={form.usuario}
                onChange={(event) => setForm({ ...form, usuario: event.target.value })}
                disabled={form.tipo === "USB"}
              />
            </div>
            <div>
              <Label>Senha</Label>
              <Input
                type="password"
                value={form.senha}
                onChange={(event) => setForm({ ...form, senha: event.target.value })}
                disabled={form.tipo === "USB"}
              />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value as CameraEntity["status"] })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["Ativa", "Inativa", "Manutenção"].map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {form.tipo === "USB" ? (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-muted-foreground">
              A câmera do dispositivo será cadastrada para a escola selecionada e usará a webcam do navegador como fonte ao vivo.
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-2 border-t border-primary/10">
            <Button variant="outline" type="button" onClick={() => setForm(emptyForm)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              className="bg-primary text-primary-foreground hover:bg-primary/90 glow-primary"
              disabled={createMutation.isPending || updateMutation.isPending || ensureDeviceMutation.isPending}
            >
              <Save className="h-4 w-4 mr-1" />
              {form.id ? "Salvar Alterações" : form.tipo === "USB" ? "Salvar Câmera do Dispositivo" : "Salvar Câmera"}
            </Button>
          </div>
        </form>

        <div className="space-y-4">
          <div className="glass-card p-4">
            <h4 className="font-display font-semibold tracking-wide mb-3">PREVIEW</h4>
            <div className="aspect-video bg-background border border-primary/30 rounded-lg tech-grid scanline flex items-center justify-center">
              <Camera className="h-12 w-12 text-primary/40" />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {form.url ? `Stream configurado para ${form.url}` : "O preview aparecerá após salvar e conectar a câmera."}
            </p>
          </div>

          <div className="glass-card p-4">
            <h4 className="font-display font-semibold tracking-wide mb-3">CÂMERAS ATIVAS</h4>
            <ul className="space-y-2">
              {activeCameras.map((camera) => (
                <li key={camera.id} className="flex items-center justify-between gap-2 text-sm border border-primary/10 rounded-md p-2 bg-background/40">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{camera.nome}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{camera.localizacao}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <StatusBadge variant={camera.status === "Ativa" ? "ok" : camera.status === "Manutenção" ? "manutencao" : "inativo"}>
                      {camera.status}
                    </StatusBadge>
                    <Button variant="ghost" size="icon" onClick={() => startEdit(camera)} title="Editar câmera">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        if (window.confirm(`Remover ${camera.nome}?`)) {
                          deleteMutation.mutate(camera.id);
                        }
                      }}
                      title="Remover câmera"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
