import { cn } from "@/lib/utils";

type Variant = "presente" | "ausente" | "atrasado" | "saiu" | "ativo" | "inativo" | "alerta" | "ok" | "atencao" | "manutencao";

const styles: Record<Variant, string> = {
  presente: "bg-secondary/15 text-secondary border-secondary/40",
  ausente: "bg-destructive/15 text-destructive border-destructive/40",
  atrasado: "bg-warning/15 text-warning border-warning/40",
  saiu: "bg-orange-500/15 text-orange-400 border-orange-500/40",
  ativo: "bg-secondary/15 text-secondary border-secondary/40",
  inativo: "bg-muted text-muted-foreground border-border",
  alerta: "bg-destructive/15 text-destructive border-destructive/40",
  ok: "bg-secondary/15 text-secondary border-secondary/40",
  atencao: "bg-warning/15 text-warning border-warning/40",
  manutencao: "bg-warning/15 text-warning border-warning/40",
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
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-display font-semibold uppercase tracking-wider",
        styles[variant],
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {children ?? labels[variant]}
    </span>
  );
}
