import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import AppLayout from "@/components/layout/AppLayout";
import { AuthProvider } from "@/context/auth-context";
import { PublicOnlyRoute, RequireAuth } from "@/components/auth/RouteGuards";
import Dashboard from "./pages/Dashboard";
import Escolas from "./pages/Escolas";
import Turmas from "./pages/Turmas";
import Responsaveis from "./pages/Responsaveis";
import Alunos from "./pages/Alunos";
import Cameras from "./pages/Cameras";
import CameraCadastro from "./pages/CameraCadastro";
import Vigia from "./pages/Vigia";
import RevisaoFacial from "./pages/RevisaoFacial";
import Presenca from "./pages/Presenca";
import Notificacoes from "./pages/Notificacoes";
import PWA from "./pages/PWA";
import Configuracoes from "./pages/Configuracoes";
import NotFound from "./pages/NotFound.tsx";
import Login from "./pages/Login";
import Register from "./pages/Register";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000,
    },
    mutations: {
      retry: 0,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route element={<PublicOnlyRoute />}>
              <Route path="/login" element={<Login />} />
              <Route path="/entrar" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/registro" element={<Register />} />
            </Route>

            <Route element={<RequireAuth />}>
              <Route path="pwa" element={<PWA />} />
              <Route path="responsavel" element={<PWA />} />
              <Route path="app-responsavel" element={<PWA />} />
              <Route element={<AppLayout />}>
                <Route index element={<Dashboard />} />
                <Route path="escolas" element={<Escolas />} />
                <Route path="turmas" element={<Turmas />} />
                <Route path="responsaveis" element={<Responsaveis />} />
                <Route path="alunos" element={<Alunos />} />
                <Route path="vigia" element={<Vigia />} />
                <Route path="revisao-facial" element={<RevisaoFacial />} />
                <Route path="cameras" element={<Cameras />} />
                <Route path="cameras/cadastro" element={<CameraCadastro />} />
                <Route path="presenca" element={<Presenca />} />
                <Route path="notificacoes" element={<Notificacoes />} />
                <Route path="configuracoes" element={<Configuracoes />} />
              </Route>
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
