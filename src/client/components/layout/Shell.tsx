import { Outlet, NavLink } from "react-router-dom";
import { cn } from "../../lib/utils";
import { ToastContainer } from "../Toast";

const navItems = [
  { to: "/", label: "Projects", icon: "M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" },
  { to: "/raw", label: "Raw Explorer", icon: "M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7M9 3h6l2 4H7l2-4z" },
];

export function Shell() {
  return (
    <div className="min-h-screen flex">
      <ToastContainer />
      <nav className="w-56 bg-surface border-r border-border flex flex-col py-4 px-3 shrink-0">
        <div className="flex items-center gap-2 px-3 mb-8">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <circle cx="14" cy="14" r="13" stroke="#00a2e0" strokeWidth="2" />
            <path d="M9 14l3 3 7-7" stroke="#00a2e0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="font-semibold text-primary-dark text-sm">Claude Telemetry</span>
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
