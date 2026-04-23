import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import AppLayout from "@/components/layout/AppLayout";
import Dashboard from "./pages/Dashboard";
import Escolas from "./pages/Escolas";
import Responsaveis from "./pages/Responsaveis";
import Alunos from "./pages/Alunos";
import Cameras from "./pages/Cameras";
import CameraCadastro from "./pages/CameraCadastro";
import Presenca from "./pages/Presenca";
import Notificacoes from "./pages/Notificacoes";
import PWA from "./pages/PWA";
import Configuracoes from "./pages/Configuracoes";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/escolas" element={<Escolas />} />
            <Route path="/responsaveis" element={<Responsaveis />} />
            <Route path="/alunos" element={<Alunos />} />
            <Route path="/cameras" element={<Cameras />} />
            <Route path="/cameras/cadastro" element={<CameraCadastro />} />
            <Route path="/presenca" element={<Presenca />} />
            <Route path="/notificacoes" element={<Notificacoes />} />
            <Route path="/pwa" element={<PWA />} />
            <Route path="/configuracoes" element={<Configuracoes />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
