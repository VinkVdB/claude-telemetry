import { useEffect, useState } from "react";
import { Outlet, NavLink } from "react-router-dom";
import { cn } from "../../lib/utils";
import { ToastContainer } from "../Toast";
import { useSettings } from "../../contexts/SettingsContext";

const navItems = [
  { to: "/", label: "Projects", icon: "M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" },
  { to: "/raw", label: "Raw Explorer", icon: "M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7M9 3h6l2 4H7l2-4z" },
  { to: "/settings", label: "Settings", icon: "M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" },
];

function readDarkFromStorage(): boolean {
  try { return localStorage.getItem("ct-dark-mode") === "true"; } catch { return false; }
}

function applyDark(enabled: boolean) {
  document.documentElement.classList.toggle("dark", enabled);
  try { localStorage.setItem("ct-dark-mode", String(enabled)); } catch {}
}

function DarkModeIcon({ dark }: { dark: boolean }) {
  const t = "transition: opacity 0.35s ease, transform 0.45s ease";
  return (
    <svg width="20" height="20" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <defs>
        <radialGradient id="dm-sun" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffe066" />
          <stop offset="100%" stopColor="#ffaa00" />
        </radialGradient>
        <radialGradient id="dm-moon" cx="40%" cy="35%" r="60%">
          <stop offset="0%" stopColor="#c8d8f8" />
          <stop offset="100%" stopColor="#a0b4e8" />
        </radialGradient>
        <filter id="dm-glow">
          <feGaussianBlur stdDeviation="1.8" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="dm-rays">
          <feGaussianBlur stdDeviation="0.8" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Sky background */}
      <circle
        cx="22" cy="22" r="20"
        style={{
          fill: dark ? "#bfdbfe" : "#0f172a",
          transition: "fill 0.5s ease",
        }}
      />

      {/* Stars — visible in dark/moon mode */}
      {([
        [10, 9, 0.9], [33, 7, 0.7], [36, 16, 0.5], [8, 18, 0.6], [30, 32, 0.8], [14, 33, 0.5],
      ] as [number, number, number][]).map(([cx, cy, r], i) => (
        <circle
          key={i} cx={cx} cy={cy} r={r} fill="white"
          style={{
            opacity: dark ? 0 : 0.85,
            transition: `opacity 0.3s ease ${i * 40}ms`,
          }}
        />
      ))}

      {/* Sun rays — visible in light/sun mode */}
      <g
        transform="translate(22,22)"
        style={{
          opacity: dark ? 1 : 0,
          transform: `translate(22px,22px) rotate(${dark ? 0 : -45}deg)`,
          transition: "opacity 0.35s ease 0.1s, transform 0.45s ease",
          filter: "url(#dm-rays)",
        }}
      >
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => {
          const rad = (angle * Math.PI) / 180;
          return (
            <line
              key={angle}
              x1={Math.cos(rad) * 13} y1={Math.sin(rad) * 13}
              x2={Math.cos(rad) * 16.5} y2={Math.sin(rad) * 16.5}
              stroke="#ffcc00" strokeWidth="2" strokeLinecap="round"
              opacity={angle % 90 === 0 ? 0.9 : 0.65}
            />
          );
        })}
      </g>

      {/* Moon crescent */}
      <g style={{
        opacity: dark ? 0 : 1,
        transform: dark ? "translate(3px, -3px) scale(0.85)" : "translate(0,0) scale(1)",
        transition: "opacity 0.3s ease, transform 0.45s ease",
        transformOrigin: "22px 22px",
      }}>
        <circle cx="22" cy="22" r="9" fill="url(#dm-moon)" filter="url(#dm-glow)" />
        <circle
          cx="26" cy="19" r="7.5"
          style={{
            fill: dark ? "#bfdbfe" : "#0f172a",
            transition: "fill 0.5s ease",
          }}
        />
        <circle cx="18" cy="24" r="1.2" fill="#c8d8f8" opacity="0.5" />
        <circle cx="21" cy="19" r="0.8" fill="#c8d8f8" opacity="0.4" />
        <circle cx="16" cy="20" r="0.6" fill="#c8d8f8" opacity="0.35" />
      </g>

      {/* Sun disc */}
      <circle
        cx="22" cy="22" r="8.5"
        fill="url(#dm-sun)"
        style={{
          opacity: dark ? 1 : 0,
          transform: dark ? "scale(1)" : "scale(0.6)",
          transition: "opacity 0.35s ease 0.1s, transform 0.45s ease 0.1s",
          transformOrigin: "22px 22px",
          filter: "url(#dm-glow)",
        }}
      />

      {/* Cloud — floats in when switching to light/sun mode */}
      <g style={{
        opacity: dark ? 0.85 : 0,
        transform: dark ? "translateX(0)" : "translateX(7px)",
        transition: "opacity 0.5s ease 0.25s, transform 0.55s ease 0.25s",
      }}>
        <ellipse cx="30" cy="34" rx="5.5" ry="3.2" fill="white" opacity="0.92" />
        <ellipse cx="27.5" cy="35.5" rx="3.5" ry="2.3" fill="white" opacity="0.92" />
        <ellipse cx="33" cy="35.5" rx="3.2" ry="2" fill="white" opacity="0.88" />
        <ellipse cx="30" cy="36.5" rx="5" ry="1.8" fill="white" opacity="0.95" />
      </g>
    </svg>
  );
}

export function Shell() {
  const { settings, updateSettings, isLoading } = useSettings();
  const [dark, setDark] = useState(readDarkFromStorage);

  // Sync from server settings once loaded
  useEffect(() => {
    if (!isLoading) {
      const serverDark = !!(settings["display.darkMode"] ?? false);
      setDark(serverDark);
      applyDark(serverDark);
    }
  }, [isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    applyDark(next);
    updateSettings({ "display.darkMode": next });
  };

  return (
    <div className="min-h-screen flex">
      <ToastContainer />

      {/* Sticky sidebar — always viewport-height regardless of page content */}
      <nav className="w-56 bg-surface border-r border-border flex flex-col py-4 px-3 shrink-0 sticky top-0 h-screen overflow-y-auto">
        <div className="flex items-center gap-2.5 px-3 mb-8">
          <svg width="30" height="30" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="sb-bg" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
                <stop stopColor="#004d96"/>
                <stop offset="1" stopColor="#001628"/>
              </linearGradient>
              <linearGradient id="sb-wave" x1="12" y1="0" x2="88" y2="0" gradientUnits="userSpaceOnUse">
                <stop stopColor="#00a2e0" stopOpacity="0"/>
                <stop offset="0.22" stopColor="#00a2e0" stopOpacity="0.55"/>
                <stop offset="0.65" stopColor="#00a2e0"/>
                <stop offset="1"    stopColor="#22d4f5"/>
              </linearGradient>
              <filter id="sb-gw" x="-15%" y="-120%" width="130%" height="340%">
                <feGaussianBlur stdDeviation="1.8" result="b"/>
                <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
              <filter id="sb-gp" x="-80%" y="-80%" width="260%" height="260%">
                <feGaussianBlur stdDeviation="4" result="b"/>
                <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
            </defs>
            <rect width="100" height="100" rx="22" fill="url(#sb-bg)"/>
            <rect x="2" y="2" width="96" height="44" rx="20" fill="white" fillOpacity="0.05"/>
            <rect x="0.75" y="0.75" width="98.5" height="98.5" rx="21.25"
                  stroke="white" strokeOpacity="0.13" strokeWidth="1.5" fill="none"/>
            <line x1="11" y1="53" x2="89" y2="53" stroke="white" strokeOpacity="0.07" strokeWidth="0.75"/>
            <path d="M12,53 L31,53 L38,53 L44,18 L52,79 L58,53 L88,53"
                  stroke="url(#sb-wave)" strokeWidth="5.5"
                  strokeLinecap="round" strokeLinejoin="round"
                  fill="none" filter="url(#sb-gw)"/>
            <circle cx="44" cy="18" r="10" fill="#bdd72d" fillOpacity="0.28" filter="url(#sb-gp)"/>
            <circle cx="44" cy="18" r="4.5" fill="#d0e84a"/>
            <circle cx="88" cy="53" r="5" fill="#22d4f5" fillOpacity="0.22"/>
            <circle cx="88" cy="53" r="3.5" fill="#22d4f5"/>
          </svg>
          <span className="font-semibold text-primary-dark text-sm tracking-tight">Claude Telemetry</span>
        </div>

        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors mb-1",
                isActive ? "bg-primary/10 text-primary" : "text-muted hover:bg-primary/5 hover:text-primary-dark"
              )
            }
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d={item.icon} />
            </svg>
            {item.label}
          </NavLink>
        ))}

        <div className="flex-1" />

        <button
          onClick={toggleDark}
          title={dark ? "Switch to light mode" : "Switch to dark mode"}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-muted hover:bg-primary/5 hover:text-primary-dark w-full"
        >
          <DarkModeIcon dark={dark} />
          <span>{dark ? "Light mode" : "Dark mode"}</span>
        </button>
      </nav>

      <main className="flex-1 p-6 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
