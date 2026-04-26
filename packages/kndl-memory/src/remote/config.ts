// remote/config.ts — ~/.kndl/remotes.json management.
//
// Also reads KNDL_REMOTE_STORES env var for one-shot config without a file:
//   KNDL_REMOTE_STORES="anthropic:store_abc123:personal,anthropic:store_xyz:work"

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { RemoteConfig, RemotesFile } from "./types";

export function remotesPath(): string {
  return join(homedir(), ".kndl", "remotes.json");
}

export function loadRemoteConfigs(): RemoteConfig[] {
  // 1. Environment variable override
  const envVar = process.env.KNDL_REMOTE_STORES;
  if (envVar) {
    return envVar.split(",").map((entry) => {
      const parts = entry.trim().split(":");
      if (parts.length < 3 || parts[0] !== "anthropic") {
        throw new Error(`Bad KNDL_REMOTE_STORES entry: ${entry}. Format: anthropic:<store_id>:<label>`);
      }
      return {
        label:              parts[2],
        provider:           "anthropic" as const,
        store_id:           parts[1],
        default_confidence: 0.85,
        push:               false,
      };
    });
  }

  // 2. File
  const p = remotesPath();
  if (!existsSync(p)) return [];
  try {
    const data = JSON.parse(readFileSync(p, "utf8")) as RemotesFile;
    return data.remotes ?? [];
  } catch (e) {
    process.stderr.write(`[kndl] Warning: could not parse ${p}: ${(e as Error).message}\n`);
    return [];
  }
}

export function saveRemoteConfigs(remotes: RemoteConfig[]): void {
  const p = remotesPath();
  mkdirSync(join(homedir(), ".kndl"), { recursive: true });
  const data: RemotesFile = { remotes };
  writeFileSync(p, JSON.stringify(data, null, 2));
}

export function addRemote(config: RemoteConfig): void {
  const remotes = loadRemoteConfigs();
  const idx = remotes.findIndex((r) => r.label === config.label);
  if (idx >= 0) {
    remotes[idx] = config;
  } else {
    remotes.push(config);
  }
  saveRemoteConfigs(remotes);
}

export function removeRemote(label: string): boolean {
  const remotes = loadRemoteConfigs();
  const filtered = remotes.filter((r) => r.label !== label);
  if (filtered.length === remotes.length) return false;
  saveRemoteConfigs(filtered);
  return true;
}

export function getRemote(label: string): RemoteConfig | undefined {
  return loadRemoteConfigs().find((r) => r.label === label);
}
