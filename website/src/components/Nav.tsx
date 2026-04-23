import { NavLink, useLocation } from "react-router";
import styles from "./Nav.module.css";

const LINKS = [
  { to: "/",         label: "Home" },
  { to: "/spec",     label: "Spec" },
  { to: "/workflow", label: "Workflow" },
  { to: "/explorer", label: "Explorer" },
  { to: "/mcp",      label: "MCP" },
];

export default function Nav() {
  const { pathname } = useLocation();
  const isHome = pathname === "/";

  return (
    <nav className={`${styles.nav} ${isHome ? styles.home : ""}`}>
      <NavLink to="/" className={styles.logo}>KNDL</NavLink>
      <div className={styles.links}>
        {LINKS.filter(l => l.to !== "/").map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `${styles.link} ${isActive ? styles.active : ""}`
            }
          >
            {label}
          </NavLink>
        ))}
        <a
          href="https://github.com/artdaw/kndl"
          target="_blank"
          rel="noreferrer"
          className={styles.link}
        >
          GitHub ↗
        </a>
      </div>
    </nav>
  );
}
