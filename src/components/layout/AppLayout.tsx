import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  School,
  Layers3,
  Users,
  GraduationCap,
  Camera,
  ClipboardCheck,
  Bell,
  Settings,
  ShieldCheck,
  Menu,
  X,
  LogOut,
  ScanFace,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";

const navItems = [
  { to: "/vigia", label: "Vigia ao Vivo", icon: ShieldCheck, highlight: true },
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/escolas", label: "Escolas", icon: School },
  { to: "/turmas", label: "Turmas", icon: Layers3 },
  { to: "/responsaveis", label: "Pais / Responsáveis", icon: Users },
  { to: "/alunos", label: "Alunos", icon: GraduationCap },
  { to: "/cameras", label: "Câmeras & Portões", icon: Camera },
  { to: "/revisao-facial", label: "Revisão Facial", icon: ScanFace },
  { to: "/presenca", label: "Turmas & Presença", icon: ClipboardCheck },
  { to: "/notificacoes", label: "Notificações", icon: Bell },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex h-full flex-col bg-sidebar">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
        <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center shrink-0">
          <ShieldCheck className="h-5 w-5 text-primary-foreground" strokeWidth={2.2} />
        </div>
        <div className="leading-tight min-w-0">
          <div className="font-bold text-base text-sidebar-foreground tracking-wide truncate">VigiaEscolar</div>
          <div className="text-[10px] tracking-widest text-sidebar-foreground/50 uppercase">Segurança Escolar</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent",
                isActive &&
                  "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground font-semibold",
                item.highlight && !isActive && "text-sidebar-foreground font-semibold",
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon className="h-4 w-4 shrink-0" />
                <span className="flex-1 truncate">{item.label}</span>
                {item.highlight && !isActive && (
                  <span className="h-2 w-2 rounded-full bg-destructive pulse-dot text-destructive" />
                )}
                {isActive && <ChevronRight className="h-3.5 w-3.5 opacity-70" />}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <div className="rounded-lg bg-sidebar-accent p-3 text-xs">
          <div className="flex items-center gap-2 text-primary font-semibold">
            <span className="h-2 w-2 rounded-full bg-primary" />
            Conectado
          </div>
          <div className="mt-1 text-sidebar-foreground/60 truncate">
            {user?.tenantNome || user?.nome || "Conta autenticada"}
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-[11px] uppercase tracking-wider text-sidebar-foreground/40">
              {user?.role || "admin"}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 border-sidebar-border bg-sidebar text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground text-xs"
              onClick={async () => {
                try {
                  await signOut();
                } finally {
                  navigate("/login", { replace: true });
                  onNavigate?.();
                }
              }}
            >
              <LogOut className="h-3 w-3 mr-1" />
              Sair
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function pageTitle(pathname: string) {
  const item = navItems.find((i) => (i.end ? pathname === i.to : pathname.startsWith(i.to) && i.to !== "/"));
  return item?.label ?? "Dashboard";
}

export default function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const { user } = useAuth();

  return (
    <div className="min-h-screen w-full flex bg-background">
      {/* Sidebar desktop */}
      <aside className="hidden lg:flex w-60 shrink-0 border-r border-sidebar-border">
        <SidebarContent />
      </aside>

      {/* Sidebar mobile */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 border-r border-sidebar-border">
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="sticky top-0 z-40 flex items-center gap-3 h-14 px-4 lg:px-6 border-b border-border bg-white shadow-sm">
          <button
            type="button"
            className="lg:hidden p-2 -ml-2 rounded-md hover:bg-muted text-foreground"
            onClick={() => setMobileOpen(true)}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          <div className="flex items-center gap-2 text-sm">
            <Link to="/" className="font-semibold text-secondary hover:text-primary transition-colors">
              VigiaEscolar
            </Link>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium text-foreground">
              {pageTitle(location.pathname)}
            </span>
          </div>

          <div className="ml-auto flex items-center gap-4 text-sm">
            <span className="hidden sm:flex items-center gap-1.5 text-success font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-soft" />
              Online
            </span>
            <span className="hidden md:inline text-muted-foreground">
              {user?.tenantNome || user?.nome || ""}
            </span>
            <span className="text-muted-foreground text-xs">
              {new Date().toLocaleDateString("pt-BR")}
            </span>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6 animate-fade-in">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
