export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

type AuthListener = () => void;
const authListeners = new Set<AuthListener>();
export const onUnauthorized = (fn: AuthListener) => {
  authListeners.add(fn);
  return () => authListeners.delete(fn);
};

export async function api<T = any>(path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      headers: body instanceof FormData || body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      ...init,
    });
  } catch {
    throw new ApiError("You're offline (or the server is unreachable).", 0);
  }
  if (res.status === 401) authListeners.forEach((fn) => fn());
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json.error ?? `Request failed (${res.status})`, res.status);
  return json as T;
}

export interface ServerConfig {
  authed: boolean;
  passwordRequired: boolean;
  ai: boolean;
  mockAi: boolean;
  model: string;
  sttServer: boolean;
}

let cachedConfig: ServerConfig | null = null;
export async function serverConfig(force = false): Promise<ServerConfig | null> {
  if (cachedConfig && !force) return cachedConfig;
  try {
    cachedConfig = await api<ServerConfig>("/api/config");
    localStorage.setItem("parla.config", JSON.stringify(cachedConfig));
  } catch {
    const saved = localStorage.getItem("parla.config");
    cachedConfig = saved ? JSON.parse(saved) : null;
  }
  return cachedConfig;
}
export const lastServerConfig = (): ServerConfig | null => {
  if (cachedConfig) return cachedConfig;
  try {
    return JSON.parse(localStorage.getItem("parla.config") ?? "null");
  } catch {
    return null;
  }
};
