import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Camera,
  ClipboardCheck,
  GraduationCap,
  Menu,
  LogOut,
  Settings,
  ShieldCheck,
  ChevronRight,
  X,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/auth-context";

const navItems = [
  { to: "/", label: "Monitoramento", icon: ShieldCheck, end: true },
  { to: "/cadastros", label: "Cadastros", icon: GraduationCap },
  { to: "/cameras", label: "Câmeras", icon: Camera },
  { to: "/presenca", label: "Presença", icon: ClipboardCheck },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="sidebar-root flex h-full flex-col">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-white/10">
        <div className="sidebar-logo-icon">
          <ShieldCheck className="h-5 w-5 text-white" strokeWidth={2.2} />
        </div>
        <div className="leading-tight min-w-0">
          <div className="font-bold text-[15px] text-white tracking-wide truncate">VigiaEscolar</div>
          <div className="text-[9px] tracking-widest text-white/40 uppercase">Segurança Escolar</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all duration-150",
                isActive
                  ? "sidebar-nav-active text-white shadow-md"
                  : "text-white/60 hover:text-white hover:bg-white/[0.08]",
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon className={cn("h-4 w-4 shrink-0 transition-transform", isActive && "scale-110")} />
                <span className="flex-1 truncate">{item.label}</span>
                {isActive && <ChevronRight className="h-3.5 w-3.5 opacity-60" />}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-white/10 p-3">
        <div className="rounded-lg bg-white/[0.08] p-3 text-xs space-y-2">
          <div className="flex items-center gap-2 text-emerald-400 font-semibold">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            Conectado
          </div>
          <div className="text-white/50 truncate text-[11px]">
            {user?.tenantNome || user?.nome || "Conta autenticada"}
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-[10px] uppercase tracking-wider text-white/30">
              {user?.role || "admin"}
            </span>
            <button
              type="button"
              onClick={async () => {
                try { await signOut(); } finally {
                  navigate("/login", { replace: true });
                  onNavigate?.();
                }
              }}
              className="flex items-center gap-1 text-[11px] text-white/40 hover:text-white/80 transition-colors"
            >
              <LogOut className="h-3 w-3" />
              Sair
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function pageTitle(pathname: string) {
  const item = navItems.find((i) => (i.end ? pathname === i.to : pathname.startsWith(i.to) && i.to !== "/"));
  return item?.label ?? "Monitoramento";
}

function pageIcon(pathname: string) {
  const item = navItems.find((i) => (i.end ? pathname === i.to : pathname.startsWith(i.to) && i.to !== "/"));
  return item?.icon ?? ShieldCheck;
}

export default function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const { user } = useAuth();
  const PageIcon = pageIcon(location.pathname);

  return (
    <div className="min-h-screen w-full flex bg-background">
      {/* Sidebar desktop */}
      <aside className="hidden lg:flex w-56 shrink-0 sidebar-desktop">
        <div className="w-full">
          <SidebarContent />
        </div>
      </aside>

      {/* Sidebar mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-56 sidebar-mobile">
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="sticky top-0 z-40 flex items-center gap-3 h-13 px-4 lg:px-5 border-b border-border/60 bg-white/95 backdrop-blur-sm shadow-sm">
          <button
            type="button"
            className="lg:hidden p-1.5 -ml-1 rounded-md hover:bg-muted text-foreground"
            onClick={() => setMobileOpen(true)}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          <div className="flex items-center gap-2 text-sm min-w-0">
            <Link to="/" className="font-semibold text-secondary hover:text-primary transition-colors shrink-0">
              VigiaEscolar
            </Link>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
            <div className="flex items-center gap-1.5 text-foreground font-semibold truncate">
              <PageIcon className="h-3.5 w-3.5 text-primary shrink-0" />
              {pageTitle(location.pathname)}
            </div>
          </div>

          <div className="ml-auto flex items-center gap-3 text-sm shrink-0">
            <span className="hidden sm:flex items-center gap-1.5 font-medium text-emerald-600 text-xs">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Online
            </span>
            <div className="hidden md:flex items-center gap-2 pl-3 border-l border-border/60">
              <div className="header-avatar">
                {(user?.tenantNome || user?.nome || "U").charAt(0).toUpperCase()}
              </div>
              <div className="leading-tight">
                <div className="text-[12px] font-semibold text-foreground truncate max-w-[120px]">
                  {user?.tenantNome || user?.nome || ""}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {new Date().toLocaleDateString("pt-BR")}
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-5 animate-fade-in">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
