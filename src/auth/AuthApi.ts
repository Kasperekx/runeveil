import type { AuthCharacter, AuthSession } from "./types";

const DEFAULT_API_URL = "http://localhost:2567";

interface ErrorPayload {
  error?: string;
}

interface SessionPayload {
  authenticated: boolean;
  account?: AuthSession["account"];
  characters?: AuthSession["characters"];
}

export class AuthApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "AuthApiError";
  }
}

export class AuthApi {
  private readonly baseUrl: string;

  constructor(baseUrl = import.meta.env.VITE_API_URL ?? DEFAULT_API_URL) {
    this.baseUrl = baseUrl.replace(/\/$/u, "");
  }

  async session(): Promise<AuthSession | null> {
    const payload = await this.request<SessionPayload>("/api/auth/session");
    if (!payload.authenticated || !payload.account || !payload.characters) {
      return null;
    }
    return {
      authenticated: true,
      account: payload.account,
      characters: payload.characters,
    };
  }

  login(email: string, password: string): Promise<AuthSession> {
    return this.request<AuthSession>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }

  register(email: string, password: string): Promise<AuthSession> {
    return this.request<AuthSession>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }

  logout(): Promise<void> {
    return this.request<void>("/api/auth/logout", { method: "POST" });
  }

  async createCharacter(name: string, classId: string): Promise<AuthCharacter> {
    const result = await this.request<{ character: AuthCharacter }>(
      "/api/characters",
      {
        method: "POST",
        body: JSON.stringify({ name, classId }),
      },
    );
    return result.character;
  }

  deleteCharacter(
    characterId: string,
    confirmationName: string,
  ): Promise<void> {
    return this.request<void>(
      `/api/characters/${encodeURIComponent(characterId)}`,
      {
        method: "DELETE",
        body: JSON.stringify({ confirmationName }),
      },
    );
  }

  async gameTicket(characterId: string): Promise<string> {
    const result = await this.request<{ ticket: string }>(
      "/api/auth/game-ticket",
      {
        method: "POST",
        body: JSON.stringify({ characterId }),
      },
    );
    return result.ticket;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        credentials: "include",
        headers: {
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
      });
    } catch {
      throw new AuthApiError("NETWORK_ERROR", 0);
    }

    if (!response.ok) {
      const payload = (await response
        .json()
        .catch(() => ({}) as ErrorPayload)) as ErrorPayload;
      throw new AuthApiError(
        payload.error ?? "REQUEST_FAILED",
        response.status,
      );
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}
