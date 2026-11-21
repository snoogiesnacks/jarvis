/** "1d 2h 3m" style uptime for the readiness panel. */
export function formatUptime(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '0m'
  const m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60)
  return [d && `${d}d`, h && `${h}h`, `${m % 60}m`].filter(Boolean).join(' ')
}
