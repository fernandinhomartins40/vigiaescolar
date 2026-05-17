import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Building2, GraduationCap, Layers3, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import Escolas from "./Escolas";
import Turmas from "./Turmas";
import Responsaveis from "./Responsaveis";
import Alunos from "./Alunos";

type CadastroTab = "escolas" | "turmas" | "responsaveis" | "alunos";

const tabs: { id: CadastroTab; label: string; icon: React.ComponentType<{ className?: string }>; hint: string }[] = [
  { id: "escolas", label: "Escolas", icon: Building2, hint: "Instituições cadastradas" },
  { id: "turmas", label: "Turmas", icon: Layers3, hint: "Turmas e turnos" },
  { id: "responsaveis", label: "Responsáveis", icon: Users, hint: "Pais e responsáveis" },
  { id: "alunos", label: "Alunos", icon: GraduationCap, hint: "Alunos e biometria" },
];

export default function Cadastros() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("aba") as CadastroTab | null;
  const [active, setActive] = useState<CadastroTab>(
    tabs.some((t) => t.id === tabParam) ? (tabParam as CadastroTab) : "escolas",
  );

  useEffect(() => {
    if (tabParam && tabs.some((t) => t.id === tabParam)) {
      setActive(tabParam as CadastroTab);
    }
  }, [tabParam]);

  function goTo(id: CadastroTab) {
    setActive(id);
    setSearchParams({ aba: id }, { replace: true });
  }

  return (
    <div className="space-y-0">
      {/* Header da seção */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Cadastros</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure escolas, turmas, responsáveis e alunos na ordem correta.
        </p>
      </div>

      {/* Stepper / Abas */}
      <div className="mb-6">
        {/* Desktop: stepper horizontal */}
        <div className="hidden sm:flex items-center gap-0">
          {tabs.map((tab, index) => {
            const isActive = active === tab.id;
            const isDone = tabs.findIndex((t) => t.id === active) > index;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => goTo(tab.id)}
                className="flex items-center gap-0 flex-1 min-w-0"
              >
                <div
                  className={cn(
                    "flex flex-1 items-center gap-3 px-4 py-3 border-b-2 transition-colors text-left",
                    isActive
                      ? "border-primary bg-primary/5 text-primary"
                      : isDone
                      ? "border-primary/40 text-primary/60 hover:bg-muted/50"
                      : "border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <div
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold border-2",
                      isActive
                        ? "bg-primary border-primary text-white"
                        : isDone
                        ? "bg-primary/20 border-primary/40 text-primary"
                        : "bg-white border-border text-muted-foreground",
                    )}
                  >
                    {isDone ? "✓" : index + 1}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{tab.label}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{tab.hint}</div>
                  </div>
                </div>
                {index < tabs.length - 1 && (
                  <div className={cn("w-px h-10 shrink-0", isDone ? "bg-primary/30" : "bg-border")} />
                )}
              </button>
            );
          })}
        </div>

        {/* Mobile: tabs simples */}
        <div className="sm:hidden flex gap-1 overflow-x-auto pb-1">
          {tabs.map((tab) => {
            const isActive = active === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => goTo(tab.id)}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium border transition-colors",
                  isActive
                    ? "bg-primary text-white border-primary"
                    : "bg-white border-border text-muted-foreground hover:text-foreground",
                )}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Conteúdo da aba ativa */}
      <div>
        {active === "escolas" && <Escolas />}
        {active === "turmas" && <Turmas />}
        {active === "responsaveis" && <Responsaveis />}
        {active === "alunos" && <Alunos />}
      </div>
    </div>
  );
}
