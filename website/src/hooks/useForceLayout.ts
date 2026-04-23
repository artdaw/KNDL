import { useState, useEffect, useRef } from "react";

export interface Position { x: number; y: number }
interface Velocity { x: number; y: number }

export interface ForceLayoutResult {
  positions: Record<string, Position>;
  posRef: React.MutableRefObject<Record<string, Position>>;
}

interface NodeInput { id: string }
interface EdgeInput { source: string; target: string }

const REPEL = 3800;
const ATTRACT = 0.018;
const DAMP = 0.78;
const IDEAL = 160;
const MAX_ITER = 220;

export function useForceLayout(
  nodes: NodeInput[],
  edges: EdgeInput[],
  width: number,
  height: number,
): ForceLayoutResult {
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const posRef = useRef<Record<string, Position>>({});
  const velRef = useRef<Record<string, Velocity>>({});
  const frameRef = useRef<number | null>(null);
  const iterRef = useRef(0);

  // Stable key that changes whenever the set of node IDs changes (not just count)
  const nodeKey = nodes.map(n => n.id).sort().join("|");

  useEffect(() => {
    if (!nodes.length) { setPositions({}); return; }
    if (!width || !height) return;

    const cx = width / 2;
    const cy = height / 2;
    const r = Math.min(width, height) * 0.32;
    const ids = nodes.map(n => n.id);
    const idSet = new Set(ids);

    // Remove stale entries for nodes that no longer exist
    for (const key of Object.keys(posRef.current)) {
      if (!idSet.has(key)) {
        delete posRef.current[key];
        delete velRef.current[key];
      }
    }

    // Initialise positions in a circle, preserving positions of known nodes
    ids.forEach((id, idx) => {
      if (!posRef.current[id]) {
        const angle = (idx / ids.length) * Math.PI * 2;
        posRef.current[id] = {
          x: cx + r * Math.cos(angle) + (Math.random() - 0.5) * 40,
          y: cy + r * Math.sin(angle) + (Math.random() - 0.5) * 40,
        };
      }
      velRef.current[id] ??= { x: 0, y: 0 };
    });

    iterRef.current = 0;

    function tick() {
      const pos = posRef.current;
      const vel = velRef.current;

      // repulsion between all pairs
      for (let a = 0; a < ids.length; a++) {
        for (let b = a + 1; b < ids.length; b++) {
          const ia = ids[a], ib = ids[b];
          const dx = pos[ia].x - pos[ib].x;
          const dy = pos[ia].y - pos[ib].y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const f = REPEL / (dist * dist);
          vel[ia].x += (dx / dist) * f;
          vel[ia].y += (dy / dist) * f;
          vel[ib].x -= (dx / dist) * f;
          vel[ib].y -= (dy / dist) * f;
        }
      }

      // spring attraction along edges
      for (const e of edges) {
        if (!pos[e.source] || !pos[e.target]) continue;
        const dx = pos[e.target].x - pos[e.source].x;
        const dy = pos[e.target].y - pos[e.source].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (dist - IDEAL) * ATTRACT;
        vel[e.source].x += (dx / dist) * f;
        vel[e.source].y += (dy / dist) * f;
        vel[e.target].x -= (dx / dist) * f;
        vel[e.target].y -= (dy / dist) * f;
      }

      // weak gravity toward center
      for (const id of ids) {
        vel[id].x += (cx - pos[id].x) * 0.003;
        vel[id].y += (cy - pos[id].y) * 0.003;
      }

      // integrate
      for (const id of ids) {
        vel[id].x *= DAMP;
        vel[id].y *= DAMP;
        pos[id].x = Math.max(60, Math.min(width - 60, pos[id].x + vel[id].x));
        pos[id].y = Math.max(60, Math.min(height - 60, pos[id].y + vel[id].y));
      }

      setPositions({ ...pos });
      iterRef.current++;
      if (iterRef.current < MAX_ITER) {
        frameRef.current = requestAnimationFrame(tick);
      }
    }

    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeKey, edges.length, width, height]);

  return { positions, posRef };
}
