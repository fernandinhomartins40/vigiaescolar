import { ShieldCheck, Users, Camera, Bell, GraduationCap } from "lucide-react";
import type { ReactNode } from "react";

const highlights = [
  { icon: ShieldCheck, label: "Sessão real", description: "Autenticação com credenciais persistidas no backend." },
  { icon: Camera, label: "Eventos ao vivo", description: "Detecções e notificações consumidas em tempo real." },
  { icon: GraduationCap, label: "Multi-tenant", description: "Isolamento por conta e cache separado por tenant." },
  { icon: Bell, label: "Fluxos completos", description: "CRUD e notificações gravadas no banco real." },
];

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-background text-left">
      <div className="mx-auto grid min-h-screen max-w-6xl grid-cols-1 lg:grid-cols-[1.05fr_0.95fr]">
        <aside className="relative overflow-hidden border-r border-primary/10 bg-[radial-gradient(circle_at_top_left,_hsl(190_100%_50%_/_0.14),_transparent_35%),radial-gradient(circle_at_bottom_right,_hsl(160_84%_39%_/_0.12),_transparent_30%)] p-6 lg:p-10">
          <div className="absolute inset-0 tech-grid opacity-50" />
          <div className="relative flex h-full flex-col justify-between">
            <div className="inline-flex w-fit items-center gap-3 rounded-full border border-primary/20 bg-card/70 px-3 py-1.5 text-xs font-display tracking-[0.25em] text-primary">
              <ShieldCheck className="h-4 w-4" />
              VIGIAESCOLAR
            </div>

            <div className="max-w-xl py-10 lg:py-16">
              <p className="mb-3 text-xs font-display tracking-[0.35em] text-secondary">SEGURANÇA ESCOLAR EM PRODUÇÃO</p>
              <h1 className="max-w-lg text-4xl font-bold leading-tight tracking-wide text-foreground lg:text-6xl">
                {title}
              </h1>
              <p className="mt-4 max-w-lg text-sm leading-6 text-muted-foreground lg:text-base">{subtitle}</p>

              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {highlights.map((item) => (
                  <div key={item.label} className="glass-card p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <item.icon className="h-4 w-4 text-primary" />
                      {item.label}
                    </div>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.description}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative glass-card p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-tech border border-primary/30 glow-primary">
                  <Users className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-foreground">Banco real, sessão real</div>
                  <div className="text-xs text-muted-foreground">Sessão, dados e CRUD vindos diretamente da API.</div>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <main className="flex items-center justify-center p-6 lg:p-10">
          <div className="w-full max-w-md">{children}</div>
        </main>
      </div>
    </div>
  );
}
