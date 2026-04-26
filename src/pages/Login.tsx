import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Loader2, LogIn, Mail, Lock, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { useAuth } from "@/context/auth-context";
import { toast } from "sonner";

const schema = z.object({
  email: z.string().email("Informe um e-mail válido"),
  password: z.string().min(8, "A senha precisa ter ao menos 8 caracteres"),
});

type LoginForm = z.infer<typeof schema>;

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login: signIn, isAuthenticated } = useAuth();

  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || "/";

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  useEffect(() => {
    document.title = "VigiaEscolar | Login";
  }, []);

  const onSubmit = async (values: LoginForm) => {
    try {
      await signIn(values);
      toast.success("Sessão iniciada com sucesso");
      navigate(from, { replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível entrar";
      toast.error(message);
    }
  };

  if (isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  return (
    <AuthLayout
      title="Acesso seguro ao painel"
      subtitle="Entre com uma conta real para acessar escolas, alunos, câmeras, presença e notificações vindos do backend."
    >
      <div className="glass-card p-6 shadow-glow-primary">
        <div className="mb-6">
          <div className="text-xs font-display tracking-[0.35em] text-secondary">LOGIN</div>
          <h2 className="mt-2 text-2xl font-display font-bold">Entrar na plataforma</h2>
          <p className="mt-1 text-sm text-muted-foreground">Use sua credencial real para continuar.</p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input id="email" type="email" placeholder="voce@empresa.com" className="pl-9" {...register("email")} />
            </div>
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Senha</Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input id="password" type="password" placeholder="********" className="pl-9" {...register("password")} />
            </div>
            {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
          </div>

          <Button type="submit" className="w-full bg-primary text-primary-foreground hover:bg-primary/90 glow-primary" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            Entrar
          </Button>
        </form>

        <div className="mt-5 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Ainda não tem conta?</span>
          <Link to="/register" className="inline-flex items-center gap-1 text-primary hover:underline">
            <UserPlus className="h-4 w-4" />
            Registrar
          </Link>
        </div>
      </div>
    </AuthLayout>
  );
}
