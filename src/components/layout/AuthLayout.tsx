import { ShieldCheck, Users, Camera, Bell, GraduationCap, CheckCircle } from "lucide-react";
import type { ReactNode } from "react";

const highlights = [
  { icon: ShieldCheck, label: "Sessão real", description: "Autenticação com credenciais persistidas no backend." },
  { icon: Camera, label: "Eventos ao vivo", description: "Detecções e notificações consumidas em tempo real." },
  { icon: GraduationCap, label: "Multi-tenant", description: "Isolamento por conta e cache separado por tenant." },
  { icon: Bell, label: "Fluxos completos", description: "CRUD e notificações gravadas no banco real." },
];

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-background">
      <div className="mx-auto grid min-h-screen max-w-6xl grid-cols-1 lg:grid-cols-[1.1fr_0.9fr]">
        {/* Painel esquerdo — identidade institucional */}
        <aside className="relative overflow-hidden bg-secondary flex flex-col">
          {/* Faixa verde no topo */}
          <div className="h-1.5 bg-primary w-full" />

          <div className="flex flex-col justify-between flex-1 p-8 lg:p-12">
            {/* Logotipo */}
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
                <ShieldCheck className="h-5 w-5 text-white" strokeWidth={2.2} />
              </div>
              <div>
                <div className="font-bold text-white text-lg leading-tight">VigiaEscolar</div>
                <div className="text-white/50 text-[10px] uppercase tracking-widest">Segurança Escolar</div>
              </div>
            </div>

            {/* Headline */}
            <div className="max-w-md py-10 lg:py-16">
              <div className="inline-flex items-center gap-2 rounded-full bg-primary/20 border border-primary/30 px-3 py-1 mb-5">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                <span className="text-xs font-semibold text-primary uppercase tracking-wider">Segurança Escolar em Produção</span>
              </div>
              <h1 className="text-3xl font-bold leading-snug text-white lg:text-4xl">
                {title}
              </h1>
              <p className="mt-4 text-sm leading-relaxed text-white/60 lg:text-base">{subtitle}</p>

              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {highlights.map((item) => (
                  <div key={item.label} className="rounded-lg border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-white">
                      <item.icon className="h-4 w-4 text-primary" />
                      {item.label}
                    </div>
                    <p className="mt-2 text-xs leading-5 text-white/50">{item.description}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Rodapé */}
            <div className="rounded-lg border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
                  <Users className="h-5 w-5 text-white" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-white flex items-center gap-1.5">
                    <CheckCircle className="h-3.5 w-3.5 text-primary" />
                    Banco real, sessão real
                  </div>
                  <div className="text-xs text-white/50 mt-0.5">Sessão, dados e CRUD vindos diretamente da API.</div>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* Painel direito — formulário */}
        <main className="flex items-center justify-center p-6 lg:p-10 bg-white">
          <div className="w-full max-w-md">{children}</div>
        </main>
      </div>
    </div>
  );
}
