export interface AuthBridge {
  getAccessToken: () => Promise<string | null>;
  refreshAccessToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
}

let bridge: AuthBridge | null = null;

export function setAuthBridge(next: AuthBridge): void {
  bridge = next;
}

export function getAuthBridge(): AuthBridge {
  if (!bridge) {
    throw new Error('Authentication is not ready.');
  }
  return bridge;
}
