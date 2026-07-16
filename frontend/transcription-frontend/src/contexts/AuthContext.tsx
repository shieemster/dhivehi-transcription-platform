'use client'

import * as React from "react";
const { createContext, useContext, useState, useEffect, useCallback } = React;
import { BACKEND_URL } from "@/config";

export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
  role: string;
  mfa_enabled?: boolean;
}

interface LoginResult {
  ok: boolean;
  mfaRequired?: boolean;
  error?: string;
}

interface AuthContextValue {
  token: string | null;
  user: AuthUser | null;
  isLoading: boolean; // true while reading persisted session on first mount
  login: (email: string, password: string, mfaCode?: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  authFetch: (input: string, init?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const STORAGE_KEY = "transcript_auth"; // { token, user }

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore session on first load
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setToken(parsed.token ?? null);
        setUser(parsed.user ?? null);
      }
    } catch {
      // corrupted storage — ignore, user just has to log in again
    } finally {
      setIsLoading(false);
    }
  }, []);

  const persist = useCallback((nextToken: string | null, nextUser: AuthUser | null) => {
    setToken(nextToken);
    setUser(nextUser);
    if (nextToken && nextUser) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: nextToken, user: nextUser }));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const login = useCallback(async (email: string, password: string, mfaCode?: string): Promise<LoginResult> => {
    try {
      const res = await fetch(`${BACKEND_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, mfa_code: mfaCode || undefined }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        return { ok: false, error: data.error || "Login failed" };
      }
      if (data.mfa_required) {
        return { ok: false, mfaRequired: true };
      }

      persist(data.token, data.user);
      return { ok: true };
    } catch {
      return { ok: false, error: "Could not reach the server" };
    }
  }, [persist]);

  const logout = useCallback(async () => {
    if (token) {
      try {
        await fetch(`${BACKEND_URL}/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // best-effort — clear local session regardless of whether the
        // server-side revocation call succeeded
      }
    }
    persist(null, null);
  }, [token, persist]);

  // Wrapper around fetch that automatically attaches the Bearer token.
  // Every authenticated request in the app should go through this instead
  // of calling fetch() directly, so nothing forgets the header.
  const authFetch = useCallback((input: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    return fetch(input, { ...init, headers });
  }, [token]);

  return (
    <AuthContext.Provider value={{ token, user, isLoading, login, logout, authFetch }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
