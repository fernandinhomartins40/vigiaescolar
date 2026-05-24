import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Server,
  Download,
  Trash2,
  Copy,
  Plus,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useTenantResourceKeyFactory } from "@/context/auth-context";
import {
  type GatewayDTO,
  createGatewayPairingCode,
  getEscolas,
  listGateways,
  revokeGateway,
} from "@/lib/resources";

const GATEWAY_DOWNLOAD_URL = "https://vigiaescolar.com.br/downloads/gateway/";

export default function Gateways() {
  const keyFor = useTenantResourceKeyFactory();
  const queryClient = useQueryClient();

  const gatewaysQuery = useQuery({
    queryKey: keyFor("gateways"),
    queryFn: listGateways,
  });

  const escolasQuery = useQuery({
    queryKey: keyFor("escolas"),
    queryFn: getEscolas,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("PC da Secretaria");
  const [schoolId, setSchoolId] = useState<string>("");
  const [generatedCode, setGeneratedCode] = useState<{ code: string; expiresAt: string } | null>(
    null,
  );

  const createCode = useMutation({
    mutationFn: createGatewayPairingCode,
    onSuccess: (data) => {
      setGeneratedCode(data);
      toast.success("Código gerado! Use no app desktop em até 10 minutos.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revoke = useMutation({
    mutationFn: revokeGateway,
    onSuccess: () => {
      toast.success("Gateway revogado");
      queryClient.invalidateQueries({ queryKey: keyFor("gateways") });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function handleGenerateCode() {
    createCode.mutate({
      name: name.trim() || "Gateway",
      schoolId: schoolId || undefined,
    });
  }

  function handleCopyCode() {
    if (!generatedCode) return;
    navigator.clipboard.writeText(generatedCode.code);
    toast.success("Código copiado");
  }

  function handleCloseDialog() {
    setDialogOpen(false);
    setGeneratedCode(null);
    queryClient.invalidateQueries({ queryKey: keyFor("gateways") });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gateways"
        description="Computadores instalados nas escolas que fazem a ponte entre as câmeras locais e o servidor VigiaEscolar."
        icon={Server}
      />

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-muted-foreground">
          Cada escola precisa de pelo menos um gateway instalado em um PC com Windows na mesma rede
          Wi-Fi das câmeras.
        </p>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <a href={GATEWAY_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">
              <Download className="mr-2 h-4 w-4" /> Baixar instalador
            </a>
          </Button>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Novo gateway
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Gateways pareados</CardTitle>
          <CardDescription>
            {gatewaysQuery.data?.length ?? 0} gateway(s) cadastrado(s) neste tenant.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {gatewaysQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : !gatewaysQuery.data?.length ? (
            <p className="text-sm text-muted-foreground">
              Nenhum gateway pareado ainda. Clique em <strong>Novo gateway</strong> para começar.
            </p>
          ) : (
            <div className="space-y-3">
              {gatewaysQuery.data.map((g) => (
                <GatewayRow key={g.id} g={g} onRevoke={() => revoke.mutate(g.id)} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(open) => (open ? setDialogOpen(true) : handleCloseDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{generatedCode ? "Código de pareamento" : "Novo gateway"}</DialogTitle>
            <DialogDescription>
              {generatedCode
                ? "Use este código no app desktop instalado no PC da escola. Expira em 10 minutos."
                : "Dê um nome e (opcional) selecione a escola onde este gateway será instalado."}
            </DialogDescription>
          </DialogHeader>

          {!generatedCode ? (
            <div className="space-y-4">
              <div>
                <Label htmlFor="g-name">Nome do gateway</Label>
                <Input
                  id="g-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: PC da Secretaria"
                />
              </div>
              <div>
                <Label htmlFor="g-school">Escola (opcional)</Label>
                <Select value={schoolId} onValueChange={setSchoolId}>
                  <SelectTrigger id="g-school">
                    <SelectValue placeholder="Selecione a escola" />
                  </SelectTrigger>
                  <SelectContent>
                    {escolasQuery.data?.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-md bg-muted p-6 text-center">
                <div className="font-mono text-4xl tracking-[0.5em]">{generatedCode.code}</div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Válido até {new Date(generatedCode.expiresAt).toLocaleTimeString("pt-BR")}
                </p>
              </div>
              <ol className="list-decimal space-y-1 pl-4 text-sm">
                <li>
                  Baixe o app desktop em{" "}
                  <a
                    href={GATEWAY_DOWNLOAD_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline"
                  >
                    {GATEWAY_DOWNLOAD_URL}
                  </a>
                </li>
                <li>Instale no PC da escola (qualquer Windows 10/11)</li>
                <li>Abra o app e digite o código acima</li>
                <li>Pronto! O gateway vai aparecer na lista aqui no painel</li>
              </ol>
            </div>
          )}

          <DialogFooter>
            {!generatedCode ? (
              <>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button onClick={handleGenerateCode} disabled={createCode.isPending}>
                  {createCode.isPending ? "Gerando..." : "Gerar código"}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={handleCopyCode}>
                  <Copy className="mr-2 h-4 w-4" /> Copiar código
                </Button>
                <Button onClick={handleCloseDialog}>Fechar</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GatewayRow({ g, onRevoke }: { g: GatewayDTO; onRevoke: () => void }) {
  const lastSeen = g.lastSeenAt ? new Date(g.lastSeenAt) : null;
  const isOnline = lastSeen && Date.now() - lastSeen.getTime() < 5 * 60 * 1000;

  return (
    <div className="flex items-start justify-between rounded-md border p-4">
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{g.name}</span>
          {g.status === "REVOKED" ? (
            <Badge variant="destructive">Revogado</Badge>
          ) : isOnline ? (
            <Badge className="bg-green-600 hover:bg-green-700">
              <CheckCircle2 className="mr-1 h-3 w-3" /> Online
            </Badge>
          ) : g.status === "ACTIVE" ? (
            <Badge variant="secondary">
              <Clock className="mr-1 h-3 w-3" /> Inativo
            </Badge>
          ) : (
            <Badge variant="outline">
              <Clock className="mr-1 h-3 w-3" /> Aguardando primeiro acesso
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {g.school?.name ? `Escola: ${g.school.name} · ` : ""}
          {g.hostname ? `Host: ${g.hostname} · ` : ""}
          {g.platform ? `${g.platform} · ` : ""}
          {g.appVersion ? `v${g.appVersion}` : ""}
        </p>
        <p className="text-xs text-muted-foreground">
          {lastSeen
            ? `Último contato: ${lastSeen.toLocaleString("pt-BR")}`
            : `Pareado em ${new Date(g.createdAt).toLocaleString("pt-BR")}`}
        </p>
      </div>
      {g.status !== "REVOKED" && (
        <Button variant="ghost" size="sm" onClick={onRevoke}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      )}
    </div>
  );
}
