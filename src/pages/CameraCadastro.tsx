import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cameras, escolas } from "@/data/mock";
import { Camera, ArrowLeft, Save } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

export default function CameraCadastro() {
  return (
    <>
      <PageHeader
        title="Cadastrar Câmera"
        subtitle="Adicione uma nova câmera de reconhecimento facial"
        breadcrumb={[{ label: "Início", href: "/" }, { label: "Câmeras", href: "/cameras" }, { label: "Cadastrar" }]}
        actions={
          <Link to="/cameras"><Button variant="outline"><ArrowLeft className="h-4 w-4 mr-1" />Voltar</Button></Link>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <form
          onSubmit={(e) => { e.preventDefault(); toast.success("Câmera cadastrada com sucesso!"); }}
          className="glass-card p-5 lg:col-span-2 space-y-4"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><Label>Nome / Identificação *</Label><Input placeholder="Ex: Portão Principal" required /></div>
            <div>
              <Label>Escola vinculada *</Label>
              <Select required><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{escolas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2"><Label>Localização</Label><Input placeholder="Ex: Entrada principal lado norte" /></div>
            <div>
              <Label>Tipo</Label>
              <Select defaultValue="RTSP"><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["IP", "USB", "RTSP"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Resolução</Label>
              <Select defaultValue="1080p"><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["720p", "1080p", "4K"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2"><Label>URL Stream / IP *</Label><Input placeholder="rtsp://192.168.0.10:554/stream" required /></div>
            <div><Label>Porta</Label><Input type="number" defaultValue={554} /></div>
            <div><Label>FPS</Label><Input type="number" defaultValue={30} /></div>
            <div><Label>Usuário</Label><Input /></div>
            <div><Label>Senha</Label><Input type="password" /></div>
            <div><Label>Início reconhecimento</Label><Input type="time" defaultValue="06:00" /></div>
            <div><Label>Fim reconhecimento</Label><Input type="time" defaultValue="13:00" /></div>
            <div>
              <Label>Status</Label>
              <Select defaultValue="Ativa"><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["Ativa", "Inativa", "Manutenção"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-primary/10">
            <Button variant="outline" type="button">Cancelar</Button>
            <Button type="submit" className="bg-primary text-primary-foreground hover:bg-primary/90 glow-primary"><Save className="h-4 w-4 mr-1" />Salvar Câmera</Button>
          </div>
        </form>

        <div className="space-y-4">
          <div className="glass-card p-4">
            <h4 className="font-display font-semibold tracking-wide mb-3">PREVIEW</h4>
            <div className="aspect-video bg-background border border-primary/30 rounded-lg tech-grid scanline flex items-center justify-center">
              <Camera className="h-12 w-12 text-primary/40" />
            </div>
            <p className="text-xs text-muted-foreground mt-2">O preview aparecerá após salvar e conectar a câmera.</p>
          </div>
          <div className="glass-card p-4">
            <h4 className="font-display font-semibold tracking-wide mb-3">CÂMERAS ATIVAS</h4>
            <ul className="space-y-2">
              {cameras.map((c) => (
                <li key={c.id} className="flex items-center justify-between text-sm border border-primary/10 rounded-md p-2 bg-background/40">
                  <div>
                    <div className="font-medium">{c.nome}</div>
                    <div className="text-[11px] text-muted-foreground">{c.localizacao}</div>
                  </div>
                  <StatusBadge variant={c.status === "Ativa" ? "ok" : c.status === "Manutenção" ? "manutencao" : "inativo"}>
                    {c.status}
                  </StatusBadge>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
