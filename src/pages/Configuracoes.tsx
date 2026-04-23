import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ShieldCheck, Bell, Database, Cpu } from "lucide-react";
import { toast } from "sonner";

export default function Configuracoes() {
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
            {["Notificar entrada do aluno", "Notificar saída do aluno", "Alerta de atraso", "Alerta de ausência", "Notificações via WhatsApp", "Notificações via Push (PWA)"].map((label, i) => (
              <div key={label} className="flex items-center justify-between p-3 rounded-lg border border-primary/15 bg-background/40">
                <span className="text-sm">{label}</span>
                <Switch defaultChecked={i !== 3} />
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
              <Input type="number" defaultValue={85} />
            </div>
            <div>
              <Label>Frames por segundo da análise</Label>
              <Input type="number" defaultValue={15} />
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg border border-primary/15 bg-background/40">
              <span className="text-sm">Salvar frames de detecção</span>
              <Switch defaultChecked />
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg border border-primary/15 bg-background/40">
              <span className="text-sm">Detectar máscaras faciais</span>
              <Switch />
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
              <Switch defaultChecked />
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg border border-primary/15 bg-background/40">
              <span className="text-sm">Log de auditoria</span>
              <Switch defaultChecked />
            </div>
            <Button variant="outline" className="w-full">Alterar senha do administrador</Button>
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
              <Input type="number" defaultValue={30} />
            </div>
            <div>
              <Label>Retenção de logs (dias)</Label>
              <Input type="number" defaultValue={90} />
            </div>
            <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => toast.success("Configurações salvas com sucesso!")}>
              Salvar Configurações
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
