import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  School,
  Users,
  GraduationCap,
  Camera,
  ClipboardCheck,
  Bell,
  Settings,
  Smartphone,
  ShieldCheck,
  Menu,
  X,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/escolas", label: "Escolas", icon: School },
  { to: "/responsaveis", label: "Pais / Responsáveis", icon: Users },
  { to: "/alunos", label: "Alunos", icon: GraduationCap },
  { to: "/cameras", label: "Câmeras & Portões", icon: Camera, highlight: true },
  { to: "/presenca", label: "Turmas & Presença", icon: ClipboardCheck },
  { to: "/notificacoes", label: "Notificações", icon: Bell },
  { to: "/pwa", label: "App Responsável", icon: Smartphone },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col bg-sidebar">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-6 border-b border-[hsl(var(--sidebar-border))]">
        <div className="relative h-11 w-11 rounded-xl bg-gradient-tech border border-primary/30 flex items-center justify-center glow-primary">
          <ShieldCheck className="h-6 w-6 text-primary" strokeWidth={2.2} />
          <Camera className="absolute -bottom-1 -right-1 h-4 w-4 text-secondary bg-sidebar rounded-full p-0.5" />
        </div>
        <div className="leading-tight">
          <div className="font-display font-bold text-lg text-foreground tracking-wider">VIGIAESCOLAR</div>
          <div className="text-[10px] font-display tracking-[0.2em] text-primary/80">SAFEGATE • SECURITY</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                "text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent",
                isActive &&
                  "bg-sidebar-accent text-primary border border-primary/30 shadow-glow-primary",
                item.highlight && "font-semibold",
              )
            }
          >
            <item.icon className="h-4.5 w-4.5 shrink-0" size={18} />
            <span className="font-display tracking-wide">{item.label}</span>
            {item.highlight && (
              <span className="ml-auto h-2 w-2 rounded-full bg-destructive pulse-dot text-destructive" />
            )}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-[hsl(var(--sidebar-border))] p-4">
        <div className="glass-card p-3 text-xs">
          <div className="flex items-center gap-2 text-secondary font-display tracking-wide">
            <span className="h-2 w-2 rounded-full bg-secondary glow-success" />
            SISTEMA ONLINE
          </div>
          <div className="mt-1 text-muted-foreground">4 câmeras ativas • 3 escolas</div>
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

  return (
    <div className="min-h-screen w-full flex bg-background">
      {/* Sidebar desktop */}
      <aside className="hidden lg:flex w-64 shrink-0 border-r border-[hsl(var(--sidebar-border))]">
        <SidebarContent />
      </aside>

      {/* Sidebar mobile */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-72 border-r border-[hsl(var(--sidebar-border))]">
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-40 flex items-center gap-3 h-14 px-4 lg:px-8 border-b border-primary/10 bg-background/80 backdrop-blur-md">
          <button
            type="button"
            className="lg:hidden p-2 -ml-2 rounded-md hover:bg-muted"
            onClick={() => setMobileOpen(true)}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <div className="flex items-center gap-2">
            <Link to="/" className="text-xs font-display tracking-[0.2em] text-muted-foreground hover:text-primary">
              VIGIAESCOLAR
            </Link>
            <span className="text-muted-foreground/50">/</span>
            <h1 className="text-sm font-display font-semibold tracking-wide text-foreground">
              {pageTitle(location.pathname).toUpperCase()}
            </h1>
          </div>
          <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            <span className="hidden sm:flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-secondary animate-pulse-soft" />
              ONLINE
            </span>
            <span className="font-display tracking-wider text-primary">
              {new Date().toLocaleDateString("pt-BR")}
            </span>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-8 animate-fade-in">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
