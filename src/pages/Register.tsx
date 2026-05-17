import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Loader2, UserPlus, ShieldCheck, Mail, Lock, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { useAuth } from "@/context/auth-context";
import { toast } from "sonner";

const schema = z
  .object({
    tenantName: z.string().min(3, "Informe o nome da organização"),
    nome: z.string().min(3, "Informe seu nome"),
    email: z.string().email("Informe um e-mail válido"),
    password: z.string().min(8, "A senha precisa ter ao menos 8 caracteres"),
    confirmPassword: z.string().min(8, "Confirme sua senha"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não coincidem",
    path: ["confirmPassword"],
  });

type RegisterForm = z.infer<typeof schema>;

export default function Register() {
  const navigate = useNavigate();
  const { register: signUp, isAuthenticated } = useAuth();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      tenantName: "",
      nome: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  useEffect(() => {
    document.title = "VigiaEscolar | Registro";
  }, []);

  const onSubmit = async ({ confirmPassword: _confirmPassword, ...values }: RegisterForm) => {
    try {
      await signUp({
        tenantName: values.tenantName,
        nome: values.nome,
        email: values.email,
        password: values.password,
      });
      toast.success("Conta criada com sucesso");
      navigate("/", { replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível registrar";
      toast.error(message);
    }
  };

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return (
    <AuthLayout
      title="Crie um espaço isolado para sua operação"
      subtitle="O cadastro inicial configura uma nova conta SaaS com autenticação real, tenant próprio e persistência integral em banco."
    >
      <div className="glass-card p-6">
        <div className="mb-6">
          <div className="text-xs font-semibold tracking-widest text-primary uppercase">Registro</div>
          <h2 className="mt-2 text-2xl font-bold text-foreground">Abrir nova conta</h2>
          <p className="mt-1 text-sm text-muted-foreground">Comece com uma organização e um administrador real.</p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-2">
            <Label htmlFor="tenantName">Nome da organização</Label>
            <div className="relative">
              <Building2 className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input id="tenantName" className="pl-9" placeholder="VigiaEscolar - Unidade Central" {...register("tenantName")} />
            </div>
            {errors.tenantName && <p className="text-xs text-destructive">{errors.tenantName.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="nome">Seu nome</Label>
            <div className="relative">
              <ShieldCheck className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input id="nome" className="pl-9" placeholder="Nome do administrador" {...register("nome")} />
            </div>
            {errors.nome && <p className="text-xs text-destructive">{errors.nome.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input id="email" type="email" className="pl-9" placeholder="admin@empresa.com" {...register("email")} />
            </div>
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input id="password" type="password" className="pl-9" placeholder="********" {...register("password")} />
              </div>
              {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirmar</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input id="confirmPassword" type="password" className="pl-9" placeholder="********" {...register("confirmPassword")} />
              </div>
              {errors.confirmPassword && <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>}
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Criar conta
          </Button>
        </form>

        <div className="mt-5 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Já tem conta?</span>
          <Link to="/login" className="inline-flex items-center gap-1 text-primary hover:underline">
            Entrar
          </Link>
        </div>
      </div>
    </AuthLayout>
  );
}
