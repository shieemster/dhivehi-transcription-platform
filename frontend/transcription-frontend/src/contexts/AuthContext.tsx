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
  email_verified?: boolean;
}

interface LoginResult {
  ok: boolean;
  mfaRequired?: boolean;
  mfaEnrollmentRequired?: boolean;
  error?: string;
}

interface AuthContextValue {
  // The real session lives in an httpOnly cookie the browser manages and
  // JS can never read — this is just a client-side mirror of "do we
  // currently believe we're logged in," derived from the last known user
  // profile. It's optimistic: if the cookie has expired or been revoked
  // server-side, the next authFetch call gets a 401 and this clears itself.
  isAuthenticated: boolean;
  user: AuthUser | null;
  isLoading: boolean; // true while reading the persisted profile on first mount
  login: (email: string, password: string, mfaCode?: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  authFetch: (input: string, init?: RequestInit) => Promise<Response>;
  // Reflects the now-enabled MFA flag locally after enrollment — the
  // backend has already swapped in a fresh full-access session cookie via
  // Set-Cookie on that response, so there's no token for the client to handle.
  completeMfaEnrollment: () => void;
  // Reflects a successful POST /auth/verify-email locally, same idea as
  // completeMfaEnrollment above — no new cookie is involved, just the flag.
  completeEmailVerification: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const STORAGE_KEY = "transcript_user"; // { user } — non-secret profile only; the real session is an httpOnly cookie

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const persist = useCallback((nextUser: AuthUser | null) => {
    setUser(nextUser);
    if (nextUser) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ user: nextUser }));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  // Restore the last-known profile on first load for instant UI, then
  // positively confirm it against the backend via GET /auth/me. The
  // localStorage copy can't know the httpOnly cookie expired naturally, was
  // revoked by a password change, or was invalidated by an admin
  // deactivating/changing the account from somewhere else entirely — without
  // this check, a page loaded fresh (not just navigated to within the SPA)
  // would trust a stale "logged in" profile until some later authFetch call
  // happened to 401, instead of redirecting to /login right away.
  useEffect(() => {
    let cancelled = false;

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setUser(parsed.user ?? null);
      }
    } catch {
      // corrupted storage — ignore, user just has to log in again
    }

    fetch(`${BACKEND_URL}/auth/me`, { credentials: "include" })
      .then(async res => {
        if (cancelled) return;
        if (!res.ok) {
          persist(null);
          return;
        }
        const data = await res.json().catch(() => null);
        persist(data?.user ?? null);
      })
      .catch(() => {
        // Backend unreachable — keep the optimistic local profile rather
        // than forcing a logout over a transient network hiccup.
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (email: string, password: string, mfaCode?: string): Promise<LoginResult> => {
    try {
      const res = await fetch(`${BACKEND_URL}/auth/login`, {
        method: "POST",
        credentials: "include",
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
      if (data.mfa_enrollment_required) {
        // The backend already set a restricted, httpOnly session cookie
        // (scoped to the MFA enroll endpoints only, see
        // middleware.RequireFullSession) — just remember the profile so the
        // enrollment screen can render.
        persist(data.user);
        return { ok: false, mfaEnrollmentRequired: true };
      }

      persist(data.user);
      return { ok: true };
    } catch {
      return { ok: false, error: "Could not reach the server" };
    }
  }, [persist]);

  const completeMfaEnrollment = useCallback(() => {
    setUser(prev => {
      if (!prev) return prev;
      const next = { ...prev, mfa_enabled: true };
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ user: next }));
      return next;
    });
  }, []);

  const completeEmailVerification = useCallback(() => {
    setUser(prev => {
      if (!prev) return prev;
      const next = { ...prev, email_verified: true };
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ user: next }));
      return next;
    });
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch(`${BACKEND_URL}/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // best-effort — clear the local profile regardless of whether the
      // server-side revocation call succeeded
    }
    persist(null);
  }, [persist]);

  // Wrapper around fetch that sends the httpOnly session cookie. Every
  // authenticated request in the app should go through this instead of
  // calling fetch() directly. A 401 means the cookie is gone, expired, or
  // revoked server-side, so the local profile is cleared to match — pages
  // gating on isAuthenticated will bounce to /login on the next render.
  const authFetch = useCallback(async (input: string, init: RequestInit = {}) => {
    const res = await fetch(input, { ...init, credentials: "include" });
    if (res.status === 401) {
      persist(null);
    }
    return res;
  }, [persist]);

  return (
    <AuthContext.Provider value={{ isAuthenticated: user !== null, user, isLoading, login, logout, authFetch, completeMfaEnrollment, completeEmailVerification }}>
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
