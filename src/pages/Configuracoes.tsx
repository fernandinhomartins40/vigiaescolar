import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cpu, Database, ShieldCheck, Bell } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTenantResourceKeyFactory } from "@/context/auth-context";
import type { AppSettings } from "@/lib/domain";
import { getSettings, updateSettings } from "@/lib/resources";

const defaultSettings: AppSettings = {
  notifications: {
    entradaAluno: true,
    saidaAluno: true,
    atraso: true,
    ausencia: false,
    whatsapp: true,
    push: true,
  },
  recognition: {
    confidenceThreshold: 85,
    analysisFps: 15,
    saveFrames: true,
    detectMasks: false,
  },
  security: {
    twoFactor: true,
    auditLog: true,
  },
  dataRetentionDays: 30,
  logRetentionDays: 90,
};

export default function Configuracoes() {
  const queryClient = useQueryClient();
  const keys = useTenantResourceKeyFactory();
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);

  const settingsQuery = useQuery({
    queryKey: keys.settings,
    queryFn: getSettings,
  });

  useEffect(() => {
    if (settingsQuery.data) {
      setSettings(settingsQuery.data);
    }
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: async (saved) => {
      await queryClient.setQueryData(keys.settings, saved);
      toast.success("Configurações salvas com sucesso");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Falha ao salvar configurações"),
  });

  return (
    <>
      <PageHeader
        title="Configurações"
        subtitle="Preferências do sistema, notificações e segurança"
        breadcrumb={[{ label: "Início", href: "/" }, { label: "Configurações" }]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Bell className="h-5 w-5 text-primary" />
            <h3 className="font-display font-semibold tracking-wide">NOTIFICAÇÕES</h3>
          </div>
          <div className="space-y-3">
            {[
              ["Notificar entrada do aluno", "entradaAluno"],
              ["Notificar saída do aluno", "saidaAluno"],
              ["Alerta de atraso", "atraso"],
              ["Alerta de ausência", "ausencia"],
              ["Notificações via WhatsApp", "whatsapp"],
              ["Notificações via Push (PWA)", "push"],
            ].map(([label, key]) => (
              <div key={key} className="flex items-center justify-between p-3 rounded-lg border border-primary/15 bg-background/40">
                <span className="text-sm">{label}</span>
                <Switch
                  checked={settings.notifications[key as keyof AppSettings["notifications"]]}
                  onCheckedChange={(checked) =>
                    setSettings({
                      ...settings,
                      notifications: { ...settings.notifications, [key]: checked },
                    })
                  }
                />
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Cpu className="h-5 w-5 text-primary" />
            <h3 className="font-display font-semibold tracking-wide">RECONHECIMENTO FACIAL</h3>
          </div>
          <div className="space-y-3">
            <div>
              <Label>Limiar de confiança (%)</Label>
              <Input
                type="number"
                value={settings.recognition.confidenceThreshold}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    recognition: { ...settings.recognition, confidenceThreshold: Number(event.target.value) },
                  })
                }
              />
            </div>
            <div>
              <Label>Frames por segundo da análise</Label>
              <Input
                type="number"
                value={settings.recognition.analysisFps}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    recognition: { ...settings.recognition, analysisFps: Number(event.target.value) },
                  })
                }
              />
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg border border-primary/15 bg-background/40">
              <span className="text-sm">Salvar frames de detecção</span>
              <Switch
                checked={settings.recognition.saveFrames}
                onCheckedChange={(checked) =>
                  setSettings({
                    ...settings,
                    recognition: { ...settings.recognition, saveFrames: checked },
                  })
                }
              />
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg border border-primary/15 bg-background/40">
              <span className="text-sm">Detectar máscaras faciais</span>
              <Switch
                checked={settings.recognition.detectMasks}
                onCheckedChange={(checked) =>
                  setSettings({
                    ...settings,
                    recognition: { ...settings.recognition, detectMasks: checked },
                  })
                }
              />
            </div>
          </div>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h3 className="font-display font-semibold tracking-wide">SEGURANÇA</h3>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg border border-primary/15 bg-background/40">
              <span className="text-sm">Autenticação em dois fatores</span>
              <Switch
                checked={settings.security.twoFactor}
                onCheckedChange={(checked) =>
                  setSettings({
                    ...settings,
                    security: { ...settings.security, twoFactor: checked },
                  })
                }
              />
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg border border-primary/15 bg-background/40">
              <span className="text-sm">Log de auditoria</span>
              <Switch
                checked={settings.security.auditLog}
                onCheckedChange={(checked) =>
                  setSettings({
                    ...settings,
                    security: { ...settings.security, auditLog: checked },
                  })
                }
              />
            </div>
            <Button variant="outline" className="w-full" disabled title="Fluxo de troca de senha não exposto nesta tela">
              Alterar senha do administrador
            </Button>
          </div>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Database className="h-5 w-5 text-primary" />
            <h3 className="font-display font-semibold tracking-wide">DADOS</h3>
          </div>
          <div className="space-y-3">
            <div>
              <Label>Retenção de gravações (dias)</Label>
              <Input
                type="number"
                value={settings.dataRetentionDays}
                onChange={(event) => setSettings({ ...settings, dataRetentionDays: Number(event.target.value) })}
              />
            </div>
            <div>
              <Label>Retenção de logs (dias)</Label>
              <Input
                type="number"
                value={settings.logRetentionDays}
                onChange={(event) => setSettings({ ...settings, logRetentionDays: Number(event.target.value) })}
              />
            </div>
            <Button
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => saveMutation.mutate(settings)}
              disabled={saveMutation.isPending}
            >
              Salvar Configurações
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
