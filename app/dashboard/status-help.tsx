"use client";

import { useEffect, useRef, useState } from "react";

const legend = [
  { status: "healthy", label: "Healthy" },
  { status: "warning", label: "Recovered" },
  { status: "critical", label: "Down" },
  { status: "unknown", label: "Unchecked" },
] as const;

export function StatusLegend() {
  return (
    <ul className="status-legend" aria-label="Status colors">
      {legend.map((item) => (
        <li key={item.status}>
          <span aria-hidden="true" className={`status-swatch platform-tile--${item.status}`} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export function StatusInfo() {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const closeOnOutside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("pointerdown", closeOnOutside);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("pointerdown", closeOnOutside);
    };
  }, [open]);

  return (
    <div className="status-info" ref={container}>
      <button
        aria-controls="status-info-popover"
        aria-expanded={open}
        aria-label="How status works"
        className="status-info-button"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        i
      </button>
      {open ? (
        <div className="status-info-popover" id="status-info-popover" role="dialog" aria-label="How status works">
          <p><strong>Healthy:</strong> the latest check succeeded.</p>
          <p><strong>Recovered:</strong> all instances were offline in this window and are now back.</p>
          <p><strong>Down:</strong> all instances are offline.</p>
          <p><strong>Unchecked:</strong> no conclusive health check yet.</p>
          <p>Health checks run every 10 seconds. HTTP 2xx responses are healthy.</p>
          <p>Uptime is the share of checks that succeeded in the last 30 days. Unknown results are not counted.</p>
        </div>
      ) : null}
    </div>
  );
}
