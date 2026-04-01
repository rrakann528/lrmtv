import { db, bannedIpsTable } from "@workspace/db";

let _bannedIps = new Set<string>();

export async function refreshBannedIps(): Promise<void> {
  try {
    const ips = await db.select({ ip: bannedIpsTable.ip }).from(bannedIpsTable);
    _bannedIps = new Set(ips.map(r => r.ip));
  } catch { /* DB not ready yet */ }
}

export function isBannedIp(ip: string): boolean {
  return _bannedIps.has(ip);
}

refreshBannedIps();
// Banned IPs change only when an admin bans someone — 5 min polling is enough.
// Admin routes call refreshBannedIps() directly for instant effect.
setInterval(refreshBannedIps, 5 * 60_000);
