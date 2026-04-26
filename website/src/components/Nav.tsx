import { useState } from "react";
import { NavLink, useLocation } from "react-router";
import styles from "./Nav.module.css";

const LINKS = [
  { to: "/protocol",  label: "Protocol" },
  { to: "/examples",  label: "Examples" },
  { to: "/explorer",  label: "Explorer" },
  { to: "/mcp",       label: "MCP" },
  { to: "/skill",     label: "Skill" },
  { to: "/eval",      label: "Eval" },
];

export default function Nav() {
  const { pathname } = useLocation();
  const isHome = pathname === "/";
  const [open, setOpen] = useState(false);

  return (
    <nav className={`${styles.nav} ${isHome ? styles.home : ""}`}>
      <NavLink to="/" className={styles.logo} onClick={() => setOpen(false)}>KNDL</NavLink>

      {/* Desktop links */}
      <div className={styles.links}>
        {LINKS.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ""}`}
          >
            {label}
          </NavLink>
        ))}
        <a href="https://github.com/artdaw/kndl" target="_blank" rel="noreferrer" className={styles.link}>
          GitHub ↗
        </a>
      </div>

      {/* Hamburger button — mobile only */}
      <button
        className={styles.burger}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <span className={`${styles.burgerBar} ${open ? styles.burgerOpen1 : ""}`} />
        <span className={`${styles.burgerBar} ${open ? styles.burgerOpen2 : ""}`} />
        <span className={`${styles.burgerBar} ${open ? styles.burgerOpen3 : ""}`} />
      </button>

      {/* Mobile drawer */}
      {open && (
        <div className={styles.drawer}>
          {LINKS.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `${styles.drawerLink} ${isActive ? styles.drawerActive : ""}`}
              onClick={() => setOpen(false)}
            >
              {label}
            </NavLink>
          ))}
          <a
            href="https://github.com/artdaw/kndl"
            target="_blank"
            rel="noreferrer"
            className={styles.drawerLink}
            onClick={() => setOpen(false)}
          >
            GitHub ↗
          </a>
        </div>
      )}
    </nav>
  );
}
