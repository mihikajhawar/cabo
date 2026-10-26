/** Where the game server is. On a LAN, friends open this site at the host's address, so the server is on that same host. */
export function serverUrl(): string {
  if (process.env.NEXT_PUBLIC_SERVER_URL) return process.env.NEXT_PUBLIC_SERVER_URL;
  if (typeof window === 'undefined') return 'http://localhost:3001';
  return `${window.location.protocol}//${window.location.hostname}:3001`;
}
