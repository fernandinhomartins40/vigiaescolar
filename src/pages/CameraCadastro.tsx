import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Camera, Loader2, Laptop, Network, Pencil, Radar, Save, Trash2, Wifi } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTenantResourceKeyFactory } from "@/context/auth-context";
import type { Camera as CameraEntity, CameraDiscoveryCandidate } from "@/lib/domain";
import { createCamera, deleteCamera, discoverCameras, ensureDeviceCameraSource, listCameras, listSchools, updateCamera } from "@/lib/resources";
import { cn } from "@/lib/utils";

type NetworkProfile = "manual" | "xm-h264dvr";

type CameraForm = {
  id?: string;
  nome: string;
  escolaId: string;
  localizacao: string;
  tipo: CameraEntity["tipo"];
  url: string;
  porta: number;
  perfilRede: NetworkProfile;
  canal: number;
  stream: "main" | "sub";
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
  tipo: "USB",
  url: "",
  porta: 554,
  perfilRede: "manual",
  canal: 1,
  stream: "main",
  resolucao: "1080p",
  fps: 30,
  status: "Ativa",
  usuario: "",
  senha: "",
};

const CAMERA_TYPES = [
  {
    value: "USB" as const,
    label: "Webcam / Dispositivo",
    description: "Câmera conectada a este computador ou navegador",
    icon: Laptop,
  },
  {
    value: "IP" as const,
    label: "Câmera IP",
    description: "Câmera de rede com endereço IP local ou externo",
    icon: Wifi,
  },
  {
    value: "RTSP" as const,
    label: "RTSP / NVR",
    description: "Stream RTSP de DVR, NVR ou câmera profissional",
    icon: Network,
  },
];

const NETWORK_PROFILES = [
  {
    value: "manual" as const,
    label: "Manual / generico",
    description: "Use uma URL RTSP ou HTTP informada pelo fabricante",
  },
  {
    value: "xm-h264dvr" as const,
    label: "H264DVR / XM / iCSee",
    description: "Perfil para cameras Wi-Fi com web viewer VideoPlayTool",
  },
];

function stripProtocol(value: string) {
  return value.trim().replace(/^[a-z]+:\/\//i, "").split("/")[0].split("@").pop() ?? "";
}

function buildNetworkUrl(form: CameraForm) {
  const rawUrl = form.url.trim();
  if (form.tipo !== "RTSP" || form.perfilRede !== "xm-h264dvr") {
    return rawUrl;
  }

  const host = stripProtocol(rawUrl).split(":")[0];
  if (!host) {
    return rawUrl;
  }

  const port = Number(form.porta || 554);
  const channel = Number(form.canal || 1);
  const stream = form.stream === "sub" ? 1 : 0;
  return `rtsp://${host}:${port}/user={username}_password={password}_channel=${channel}_stream=${stream}.sdp?real_stream`;
}

function inferNetworkProfile(url: string): Pick<CameraForm, "perfilRede" | "canal" | "stream"> {
  const match = url.match(/_channel=(\d+)_stream=(\d+)/i);
  if (!match) {
    return { perfilRede: "manual", canal: 1, stream: "main" };
  }

  return {
    perfilRede: "xm-h264dvr",
    canal: Number(match[1]) || 1,
    stream: match[2] === "1" ? "sub" : "main",
  };
}

export default function CameraCadastro() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const keys = useTenantResourceKeyFactory();
  const [form, setForm] = useState<CameraForm>(emptyForm);
  const [discoveredCameras, setDiscoveredCameras] = useState<CameraDiscoveryCandidate[]>([]);

  const schoolsQuery = useQuery({ queryKey: keys.schools, queryFn: listSchools });
  const camerasQuery = useQuery({ queryKey: keys.cameras, queryFn: listCameras });

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
      if (!payload.id) throw new Error("Câmera inválida para atualização");
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
      if (!payload.escolaId) throw new Error("Selecione a escola da câmera");
      const deviceCamera = await ensureDeviceCameraSource(payload.escolaId);
      return updateCamera(deviceCamera.id, {
        nome: payload.nome || "Câmera do dispositivo",
        escolaId: payload.escolaId,
        localizacao: "Dispositivo local",
        tipo: "USB",
        url: "device://live",
        resolucao: payload.resolucao,
        fps: 30,
        status: payload.status,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.cameras });
      toast.success("Câmera do dispositivo cadastrada");
      setForm(emptyForm);
      navigate("/cameras");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Falha ao cadastrar câmera"),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCamera,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.cameras });
      toast.success("Câmera removida");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Falha ao remover câmera"),
  });

  const discoverMutation = useMutation({
    mutationFn: discoverCameras,
    onSuccess: (cameras) => {
      setDiscoveredCameras(cameras);
      if (cameras.length === 0) {
        toast.info("Nenhuma camera encontrada na rede local");
        return;
      }

      toast.success(`${cameras.length} dispositivo(s) encontrado(s)`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Falha ao buscar cameras na rede"),
  });

  const activeCameras = useMemo(() => camerasQuery.data ?? [], [camerasQuery.data]);
  const isPending = createMutation.isPending || updateMutation.isPending || ensureDeviceMutation.isPending;
  const isDevice = form.tipo === "USB";
  const isNetwork = form.tipo === "IP" || form.tipo === "RTSP";
  const resolvedStreamUrl = isDevice ? "device://live" : buildNetworkUrl(form);

  const setTipo = (tipo: CameraEntity["tipo"]) => {
    setForm({
      ...emptyForm,
      escolaId: form.escolaId,
      tipo,
      nome: tipo === "USB" ? "Câmera do dispositivo" : "",
      porta: tipo === "RTSP" ? 554 : tipo === "IP" ? 80 : 554,
      perfilRede: tipo === "RTSP" ? "xm-h264dvr" : "manual",
      canal: 1,
      stream: "main",
    });
  };

  const startEdit = (camera: CameraEntity) => {
    const profile = inferNetworkProfile(camera.url);
    setForm({
      id: camera.id,
      nome: camera.nome,
      escolaId: camera.escolaId,
      localizacao: camera.localizacao,
      tipo: camera.tipo,
      url: profile.perfilRede === "xm-h264dvr" ? stripProtocol(camera.url).split(":")[0] : camera.url,
      porta: Number((camera.url.split(":").slice(-1)[0] || "554").split("/")[0]) || 554,
      perfilRede: profile.perfilRede,
      canal: profile.canal,
      stream: profile.stream,
      resolucao: camera.resolucao,
      fps: camera.fps,
      status: camera.status,
      usuario: camera.usuario ?? "",
      senha: camera.senha ?? "",
    });
  };

  const useDiscoveredCamera = (camera: CameraDiscoveryCandidate) => {
    const rtspPort = camera.ports.includes(554) ? 554 : camera.ports.includes(8554) ? 8554 : 554;
    const profile: NetworkProfile = camera.profile === "xm-h264dvr" ? "xm-h264dvr" : "manual";

    setForm({
      ...form,
      tipo: camera.profile === "ip" ? "IP" : "RTSP",
      perfilRede: profile,
      url: camera.ip,
      porta: rtspPort,
      canal: 1,
      stream: "main",
      usuario: form.usuario || (profile === "xm-h264dvr" ? "yura" : ""),
      localizacao: form.localizacao || "Camera encontrada na rede",
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!form.nome.trim() || !form.escolaId) {
      toast.error("Preencha o nome e a escola");
      return;
    }

    if (isNetwork && !resolvedStreamUrl.trim()) {
      toast.error("Informe a URL ou endereço IP da câmera");
      return;
    }

    if (form.perfilRede === "xm-h264dvr" && (!form.usuario.trim() || !form.senha.trim())) {
      toast.error("Informe usuario e senha para cameras H264DVR / XM / iCSee");
      return;
    }

    if (form.id) {
      updateMutation.mutate({
        ...form,
        url: resolvedStreamUrl,
        fps: Number(form.fps || 30),
      });
      return;
    }

    if (isDevice) {
      ensureDeviceMutation.mutate(form);
      return;
    }

    createMutation.mutate({ ...form, url: resolvedStreamUrl, fps: Number(form.fps || 30) });
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
        <form onSubmit={handleSubmit} className="glass-card p-5 lg:col-span-2 space-y-5">

          {/* Passo 1: Tipo de câmera */}
          <div>
            <Label className="text-xs font-display tracking-widest text-muted-foreground mb-3 block">
              TIPO DE CÂMERA
            </Label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {CAMERA_TYPES.map(({ value, label, description, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTipo(value)}
                  className={cn(
                    "flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-all",
                    form.tipo === value
                      ? "border-primary bg-primary/10 shadow-[0_0_0_1px_hsl(var(--primary)/0.4)]"
                      : "border-border bg-background/40 hover:border-primary/40 hover:bg-primary/5",
                  )}
                >
                  <Icon className={cn("h-5 w-5", form.tipo === value ? "text-primary" : "text-muted-foreground")} />
                  <div>
                    <div className={cn("text-sm font-semibold", form.tipo === value ? "text-primary" : "")}>{label}</div>
                    <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">{description}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Passo 2: Campos comuns */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Nome / Identificação *</Label>
              <Input
                placeholder={isDevice ? "Ex: Webcam Recepção" : "Ex: Portão Principal"}
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
              />
            </div>
            <div>
              <Label>Escola vinculada *</Label>
              <Select value={form.escolaId} onValueChange={(v) => setForm({ ...form, escolaId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a escola" />
                </SelectTrigger>
                <SelectContent>
                  {schoolsQuery.data?.map((school) => (
                    <SelectItem key={school.id} value={school.id}>{school.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Resolução — aparece em todos os tipos */}
            <div>
              <Label>Resolução</Label>
              <Select value={form.resolucao} onValueChange={(v) => setForm({ ...form, resolucao: v as CameraEntity["resolucao"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["720p", "1080p", "4K"].map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as CameraEntity["status"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Ativa", "Inativa", "Manutenção"].map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Passo 3: Campos de rede — só para IP e RTSP */}
          {isNetwork && (
            <div className="space-y-4 rounded-lg border border-primary/20 bg-primary/5 p-4">
              <p className="text-xs font-display tracking-widest text-muted-foreground">CONFIGURAÇÃO DE REDE</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => discoverMutation.mutate()}
                  disabled={discoverMutation.isPending}
                >
                  {discoverMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Radar className="h-4 w-4 mr-1" />
                  )}
                  Buscar na rede
                </Button>
              </div>
              {discoveredCameras.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {discoveredCameras.map((camera) => (
                    <button
                      key={camera.ip}
                      type="button"
                      onClick={() => useDiscoveredCamera(camera)}
                      className="rounded-md border border-primary/20 bg-background/70 p-3 text-left hover:border-primary/60 hover:bg-primary/10 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm">{camera.ip}</span>
                        <span className="text-[10px] text-primary">{camera.label}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-1">
                        Portas: {camera.ports.join(", ")}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {form.tipo === "RTSP" && (
                  <div className="md:col-span-2">
                    <Label>Perfil de conexao</Label>
                    <Select
                      value={form.perfilRede}
                      onValueChange={(v) => setForm({ ...form, perfilRede: v as NetworkProfile })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {NETWORK_PROFILES.map((profile) => (
                          <SelectItem key={profile.value} value={profile.value}>{profile.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {NETWORK_PROFILES.find((profile) => profile.value === form.perfilRede)?.description}
                    </p>
                  </div>
                )}
                <div className="md:col-span-2">
                  <Label>{form.perfilRede === "xm-h264dvr" ? "IP da camera *" : form.tipo === "RTSP" ? "URL RTSP *" : "Endereço IP / URL *"}</Label>
                  <Input
                    placeholder={form.perfilRede === "xm-h264dvr" ? "192.168.0.106" : form.tipo === "RTSP" ? "rtsp://192.168.0.10:554/stream" : "192.168.0.10 ou http://192.168.0.10/video"}
                    value={form.url}
                    onChange={(e) => setForm({ ...form, url: e.target.value })}
                  />
                  {form.perfilRede === "xm-h264dvr" && (
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Informe apenas o IP da camera. A URL RTSP sera montada automaticamente.
                    </p>
                  )}
                </div>
                <div>
                  <Label>Porta</Label>
                  <Input
                    type="number"
                    value={form.porta}
                    onChange={(e) => setForm({ ...form, porta: Number(e.target.value) })}
                  />
                </div>
                {form.perfilRede === "xm-h264dvr" && (
                  <>
                    <div>
                      <Label>Canal</Label>
                      <Input
                        type="number"
                        min={1}
                        value={form.canal}
                        onChange={(e) => setForm({ ...form, canal: Number(e.target.value) })}
                      />
                    </div>
                    <div>
                      <Label>Stream</Label>
                      <Select
                        value={form.stream}
                        onValueChange={(v) => setForm({ ...form, stream: v as CameraForm["stream"] })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="main">Principal</SelectItem>
                          <SelectItem value="sub">Substream</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}
                <div>
                  <Label>FPS</Label>
                  <Input
                    type="number"
                    value={form.fps}
                    onChange={(e) => setForm({ ...form, fps: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <Label>Usuário</Label>
                  <Input
                    placeholder="admin"
                    value={form.usuario}
                    onChange={(e) => setForm({ ...form, usuario: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Senha</Label>
                  <Input
                    type="password"
                    placeholder="••••••••"
                    value={form.senha}
                    onChange={(e) => setForm({ ...form, senha: e.target.value })}
                  />
                </div>
                <div className="md:col-span-2">
                  <Label>Localização</Label>
                  <Input
                    placeholder="Ex: Entrada principal lado norte"
                    value={form.localizacao}
                    onChange={(e) => setForm({ ...form, localizacao: e.target.value })}
                  />
                </div>
              </div>
            </div>
          )}

          {isDevice && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-muted-foreground">
              A webcam deste dispositivo será usada como fonte ao vivo para reconhecimento facial no navegador.
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-primary/10">
            <Button variant="outline" type="button" onClick={() => setForm(emptyForm)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              className="bg-primary text-primary-foreground hover:bg-primary/90 glow-primary"
              disabled={isPending}
            >
              <Save className="h-4 w-4 mr-1" />
              {form.id ? "Salvar Alterações" : isDevice ? "Cadastrar Webcam" : "Cadastrar Câmera"}
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
              {resolvedStreamUrl && !isDevice ? `Stream configurado para ${resolvedStreamUrl}` : "O preview aparecerá após salvar e conectar a câmera."}
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
                    <Button variant="ghost" size="icon" onClick={() => startEdit(camera)} title="Editar">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => { if (window.confirm(`Remover ${camera.nome}?`)) deleteMutation.mutate(camera.id); }}
                      title="Remover"
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
