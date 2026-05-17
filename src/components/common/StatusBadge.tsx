import { cn } from "@/lib/utils";

type Variant = "presente" | "ausente" | "atrasado" | "saiu" | "ativo" | "inativo" | "alerta" | "ok" | "atencao" | "manutencao";

const styles: Record<Variant, string> = {
  presente: "bg-green-50 text-green-700 border-green-200",
  ausente: "bg-red-50 text-red-700 border-red-200",
  atrasado: "bg-amber-50 text-amber-700 border-amber-200",
  saiu: "bg-orange-50 text-orange-700 border-orange-200",
  ativo: "bg-green-50 text-green-700 border-green-200",
  inativo: "bg-slate-50 text-slate-500 border-slate-200",
  alerta: "bg-red-50 text-red-700 border-red-200",
  ok: "bg-green-50 text-green-700 border-green-200",
  atencao: "bg-amber-50 text-amber-700 border-amber-200",
  manutencao: "bg-amber-50 text-amber-700 border-amber-200",
};

const labels: Partial<Record<Variant, string>> = {
  presente: "Presente",
  ausente: "Ausente",
  atrasado: "Atrasado",
  saiu: "Saiu",
  ativo: "Ativa",
  inativo: "Inativa",
  alerta: "Alerta",
  ok: "Normal",
  atencao: "Atenção",
  manutencao: "Manutenção",
};

export function StatusBadge({
  variant,
  children,
  className,
}: {
  variant: Variant;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
        styles[variant],
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {children ?? labels[variant]}
    </span>
  );
}
