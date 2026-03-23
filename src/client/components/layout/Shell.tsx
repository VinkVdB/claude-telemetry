import { Outlet, NavLink } from "react-router-dom";
import { cn } from "../../lib/utils";
import { ToastContainer } from "../Toast";

const navItems = [
  { to: "/", label: "Projects", icon: "M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" },
  { to: "/raw", label: "Raw Explorer", icon: "M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7M9 3h6l2 4H7l2-4z" },
  { to: "/settings", label: "Settings", icon: "M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" },
];

export function Shell() {
  return (
    <div className="min-h-screen flex">
      <ToastContainer />
      <nav className="w-56 bg-surface border-r border-border flex flex-col py-4 px-3 shrink-0">
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
      </nav>
      <main className="flex-1 p-6 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
