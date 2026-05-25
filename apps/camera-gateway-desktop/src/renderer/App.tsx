import React, { useCallback, useEffect, useState } from "react";
import type { GatewayStatus } from "../shared/types";

export function App() {
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [code, setCode] = useState("");
  const [pairing, setPairing] = useState(false);
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const refresh = useCallback(async () => {
    const s = await window.gateway.getStatus();
    setStatus(s);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    const unsubscribe = window.gateway.onStatusChanged(refresh);
    return () => {
      clearInterval(id);
      unsubscribe();
    };
  }, [refresh]);

  async function handlePair() {
    setError("");
    setOkMsg("");
    setPairing(true);
    try {
      const res = await window.gateway.pair(code);
      if (res.ok) {
        setOkMsg(`Pareado com ${res.schoolName ?? res.gatewayName ?? "VigiaEscolar"}!`);
        setCode("");
        await refresh();
      } else {
        setError(res.error);
      }
    } finally {
      setPairing(false);
    }
  }

  async function handleUnpair() {
    if (!confirm("Encerrar pareamento? O gateway vai parar de enviar dados.")) return;
    await window.gateway.unpair();
    setOkMsg("");
    setError("");
    await refresh();
  }

  async function handleDiscover() {
    await window.gateway.discoverNow();
    setOkMsg("Procurando câmeras na rede local...");
    setTimeout(refresh, 4000);
  }

  async function handleCheckUpdates() {
    await window.gateway.checkForUpdates();
    await refresh();
  }

  if (!status) {
    return (
      <div className="app">
        <p>Carregando...</p>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="header">
        <div className="dot" />
        <div>
          <h1>VigiaEscolar Gateway</h1>
          <p className="sub">
            {status.paired
              ? `Conectado ao painel — ${status.schoolName ?? status.gatewayName}`
              : "Aguardando pareamento"}
          </p>
        </div>
      </div>

      {!status.paired ? (
        <div className="card">
          <h2>Parear este computador</h2>
          <p>
            No painel VigiaEscolar (vigiaescolar.com.br) abra <strong>Configurações → Gateways</strong>{" "}
            e clique em <strong>Adicionar gateway</strong>. Digite aqui o código de 6 dígitos que aparecer.
          </p>
          <div className="row">
            <input
              type="text"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              disabled={pairing}
            />
            <button
              className="btn-primary"
              onClick={handlePair}
              disabled={pairing || code.length !== 6}
            >
              {pairing ? "Pareando..." : "Parear"}
            </button>
          </div>
          {error && <p className="error">✗ {error}</p>}
          {okMsg && <p className="success">✓ {okMsg}</p>}
        </div>
      ) : (
        <>
          <div className="card">
            <h2>Status do gateway</h2>
            <div className="kv">
              <div className="k">Escola</div>
              <div className="v">{status.schoolName ?? "(não informada)"}</div>
              <div className="k">ID</div>
              <div className="v">{status.gatewayId}</div>
              <div className="k">Servidor</div>
              <div className="v">{status.apiBaseUrl}</div>
              <div className="k">Última varredura</div>
              <div className="v">
                {status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString("pt-BR") : "—"}
              </div>
            </div>
          </div>

          <div className="card">
            <h2>
              Câmeras detectadas ({status.lastDiscoveredCameras.length}){" "}
              <span className="status-badge online">conectado</span>
            </h2>
            <p>O gateway varre a rede local a cada 5 minutos e transmite vídeo ao vivo continuamente para o servidor.</p>
            <div className="row" style={{ marginBottom: 16 }}>
              <button className="btn-secondary" onClick={handleDiscover}>
                Procurar agora
              </button>
              <button className="btn-danger" onClick={handleUnpair}>
                Desparear
              </button>
            </div>
            {status.lastDiscoveredCameras.length === 0 ? (
              <p style={{ color: "var(--muted)" }}>
                Nenhuma câmera encontrada ainda. Confirme que:
                <br /> 1. As câmeras estão ligadas e conectadas no mesmo Wi-Fi
                <br /> 2. O roteador permite descoberta entre dispositivos (sem "isolamento de clientes")
              </p>
            ) : (
              status.lastDiscoveredCameras.map((cam) => (
                <div key={cam.ip} className="cam-item">
                  <div className="info">
                    <strong>{cam.deviceModel || "Câmera"}</strong>
                    <div className="meta">
                      {cam.ip} · SN: {cam.serialNumber.substring(0, 16) || "—"} · {cam.hardware}
                    </div>
                  </div>
                  <span className={`status-badge ${cam.publishUrl ? "online" : "offline"}`}>
                    {cam.publishUrl ? "transmitindo" : "aguardando servidor"}
                  </span>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {okMsg && status.paired && <p className="success">{okMsg}</p>}

      <div className="card app-meta">
        <div>
          <h2>Aplicativo</h2>
          <p>
            Versão {status.appVersion} · {status.update.message}
          </p>
        </div>
        <button
          className="btn-secondary"
          onClick={handleCheckUpdates}
          disabled={status.update.state === "checking"}
        >
          {status.update.state === "checking" ? "Verificando..." : "Verificar atualização"}
        </button>
      </div>
    </div>
  );
}
