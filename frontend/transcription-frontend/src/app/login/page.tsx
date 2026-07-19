'use client'

import * as React from "react";
const { useState, useEffect } = React;
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LogIn, Moon, Sun, AlertCircle } from "lucide-react";
import { useTheme } from "next-themes";

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" disabled>
        <Sun className="h-5 w-5" />
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === "light" ? "dark" : "light")}
      className="hover:scale-110 transition-all duration-300 ease-in-out"
    >
      {theme === "light" ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
    </Button>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const result = await login(email, password, mfaRequired ? mfaCode : undefined);

    setIsSubmitting(false);

    if (result.ok) {
      router.push("/");
      return;
    }
    if (result.mfaRequired) {
      setMfaRequired(true);
      return;
    }
    if (result.mfaEnrollmentRequired) {
      // This role requires MFA and the account hasn't enrolled yet — the
      // restricted token from login only works against the enroll
      // endpoints, so send them straight there instead of home.
      router.push("/Account?mandatoryMfa=1");
      return;
    }
    setError(result.error ?? "Login failed");
  }

  return (
    <div className="min-h-screen bg-stone-200 dark:bg-neutral-900 transition-all duration-500 ease-in-out">
      <header className="backdrop-blur-sm shadow-md dark:shadow-lg">
        <div className="max-w-8xl mx-auto pl-2 pr-6 py-4 flex items-center justify-between gap-2">
          <h1 className="text-2xl font-bold text-neutral-700 dark:text-white">
            Transcription App
          </h1>
          <ThemeToggle />
        </div>
      </header>

      <main className="flex items-center justify-center px-6 py-16">
        <Card className="w-full max-w-sm shadow-xl bg-stone-100 dark:bg-neutral-800 border-stone-200 dark:border-neutral-700">
          <CardHeader className="text-center space-y-1">
            <CardTitle className="text-2xl text-neutral-900 dark:text-white flex items-center justify-center gap-2">
              <LogIn className="w-5 h-5" />
              Sign in
            </CardTitle>
            <p className="text-sm text-stone-600 dark:text-neutral-400">
              Dhivehi Transcription Platform
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {!mfaRequired && (
                <>
                  <div className="space-y-1">
                    <label htmlFor="email" className="text-sm text-stone-600 dark:text-neutral-400">
                      Email
                    </label>
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoFocus
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="password" className="text-sm text-stone-600 dark:text-neutral-400">
                      Password
                    </label>
                    <Input
                      id="password"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>
                </>
              )}

              {mfaRequired && (
                <div className="space-y-1">
                  <label htmlFor="mfa" className="text-sm text-stone-600 dark:text-neutral-400">
                    Authenticator code
                  </label>
                  <p className="text-xs text-stone-500 dark:text-neutral-500">
                    Enter the 6-digit code from your authenticator app.
                  </p>
                  <Input
                    id="mfa"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    autoComplete="one-time-code"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
              )}

              {error && (
                <p className="text-sm text-red-700 dark:text-red-400 flex items-center gap-2" role="alert">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </p>
              )}

              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full text-white bg-stone-600 hover:bg-stone-700 dark:bg-neutral-700 dark:hover:bg-neutral-600 hover:scale-105 transition-all duration-300 ease-in-out"
              >
                {isSubmitting ? "Signing in…" : mfaRequired ? "Verify" : "Sign in"}
              </Button>

              {mfaRequired && (
                <button
                  type="button"
                  className="w-full text-center text-xs text-stone-500 dark:text-neutral-500 hover:underline"
                  onClick={() => {
                    setMfaRequired(false);
                    setMfaCode("");
                    setError(null);
                  }}
                >
                  Back
                </button>
              )}
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
