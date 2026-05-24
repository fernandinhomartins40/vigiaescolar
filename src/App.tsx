import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import AppLayout from "@/components/layout/AppLayout";
import { AuthProvider } from "@/context/auth-context";
import { PublicOnlyRoute, RequireAuth } from "@/components/auth/RouteGuards";
import Monitoramento from "./pages/Monitoramento";
import Cadastros from "./pages/Cadastros";
import Cameras from "./pages/Cameras";
import Presenca from "./pages/Presenca";
import Configuracoes from "./pages/Configuracoes";
import Gateways from "./pages/Gateways";
import PWA from "./pages/PWA";
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
                <Route index element={<Monitoramento />} />
                <Route path="cadastros" element={<Cadastros />} />
                <Route path="cameras" element={<Cameras />} />
                <Route path="presenca" element={<Presenca />} />
                <Route path="gateways" element={<Gateways />} />
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
