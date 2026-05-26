import React, { useCallback, useEffect, useRef, useState } from "react";
import type { LogEntry } from "../shared/types";

function formatTs(ts: number) {
  return new Date(ts).toLocaleTimeString("pt-BR", { hour12: false });
}

function levelColor(level: LogEntry["level"]) {
  if (level === "error") return "#fca5a5";
  if (level === "warn") return "#fcd34d";
  return "#94a3b8";
}

export function LogPanel() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const intervalRef = useRef<number | null>(null);

  const fetchLogs = useCallback(async () => {
    const entries = await window.gateway.getLogs();
    setLogs(entries);
  }, []);

  useEffect(() => {
    if (!open) return;
    void fetchLogs();
    intervalRef.current = window.setInterval(fetchLogs, 1500);
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, [open, fetchLogs]);

  useEffect(() => {
    if (autoScroll && open) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll, open]);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }

  function copyAll() {
    const text = logs
      .map((e) => `[${formatTs(e.ts)}] [${e.level.toUpperCase()}] ${e.msg}`)
      .join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="log-panel-wrap">
      <button
        type="button"
        className="log-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="log-toggle-dot" />
        {open ? "▾ Ocultar logs" : "▸ Logs do gateway"}
        {!open && logs.length === 0 && <span className="log-badge">DEV</span>}
      </button>

      {open && (
        <div className="log-panel">
          <div className="log-toolbar">
            <span className="log-count">{logs.length} entradas</span>
            <label className="log-autoscroll">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
              />
              {" "}Auto-scroll
            </label>
            <button type="button" className="log-copy-btn" onClick={copyAll}>
              {copied ? "✓ Copiado!" : "Copiar tudo"}
            </button>
          </div>
          <div
            ref={containerRef}
            className="log-body"
            onScroll={handleScroll}
          >
            {logs.length === 0 && (
              <div className="log-empty">Nenhum log ainda. Aguardando atividade do gateway...</div>
            )}
            {logs.map((entry, i) => (
              <div key={i} className="log-line">
                <span className="log-ts">{formatTs(entry.ts)}</span>
                <span className="log-level" style={{ color: levelColor(entry.level) }}>
                  {entry.level.toUpperCase()}
                </span>
                <span className="log-msg">{entry.msg}</span>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </div>
      )}
    </div>
  );
}
