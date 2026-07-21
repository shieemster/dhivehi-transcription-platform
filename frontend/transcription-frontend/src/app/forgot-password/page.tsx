'use client'

import * as React from "react";
const { useState } = React;
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KeyRound, Moon, Sun, AlertCircle, Check, ArrowLeft } from "lucide-react";
import { useTheme } from "next-themes";
import { BACKEND_URL } from "@/config";
import { apiFetch } from "@/lib/api";

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  React.useEffect(() => setMounted(true), []);

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

// Neither /auth/forgot-password nor /auth/reset-password require a session
// (the whole point is recovering an account the caller is locked out of),
// so this page talks to the backend with plain fetch rather than the
// AuthContext's authFetch.
export default function ForgotPasswordPage() {
  const router = useRouter();

  const [step, setStep] = useState<"request" | "reset">("request");

  const [email, setEmail] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [requestMessage, setRequestMessage] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetDone, setResetDone] = useState(false);

  async function handleRequestCode(e: React.FormEvent) {
    e.preventDefault();
    setRequestError(null);
    try {
      setRequesting(true);
      const data = await apiFetch<{ message: string }>(fetch, `${BACKEND_URL}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      // The backend deliberately gives the same response whether or not
      // this email is registered — move to the code-entry step regardless,
      // rather than trying to branch on the result.
      setRequestMessage(data.message);
      setStep("reset");
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : "Failed to request a reset code");
    } finally {
      setRequesting(false);
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setResetError(null);

    if (newPassword !== confirmPassword) {
      setResetError("New password and confirmation don't match.");
      return;
    }

    try {
      setResetting(true);
      await apiFetch(fetch, `${BACKEND_URL}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, new_password: newPassword }),
      });
      setResetDone(true);
      setTimeout(() => router.push("/login"), 1800);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Failed to reset password");
    } finally {
      setResetting(false);
    }
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
              <KeyRound className="w-5 h-5" />
              Reset your password
            </CardTitle>
            <p className="text-sm text-stone-600 dark:text-neutral-400">
              {step === "request"
                ? "Enter your account email and we'll send a reset code."
                : "Enter the code we sent and choose a new password."}
            </p>
          </CardHeader>
          <CardContent>
            {step === "request" ? (
              <form onSubmit={handleRequestCode} className="space-y-4">
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

                {requestError && (
                  <p className="text-sm text-red-700 dark:text-red-400 flex items-center gap-2" role="alert">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {requestError}
                  </p>
                )}

                <Button
                  type="submit"
                  disabled={requesting}
                  className="w-full text-white bg-stone-600 hover:bg-stone-700 dark:bg-neutral-700 dark:hover:bg-neutral-600 hover:scale-105 transition-all duration-300 ease-in-out"
                >
                  {requesting ? "Sending…" : "Send reset code"}
                </Button>

                <button
                  type="button"
                  className="w-full text-center text-xs text-stone-500 dark:text-neutral-500 hover:underline"
                  onClick={() => router.push("/login")}
                >
                  Back to sign in
                </button>
              </form>
            ) : resetDone ? (
              <p className="text-green-700 dark:text-green-400 flex items-center gap-2 justify-center">
                <Check className="w-4 h-4" />
                Password reset. Redirecting to sign in…
              </p>
            ) : (
              <form onSubmit={handleResetPassword} className="space-y-4">
                {requestMessage && (
                  <p className="text-sm text-stone-600 dark:text-neutral-400">{requestMessage}</p>
                )}

                <div className="space-y-1">
                  <label htmlFor="code" className="text-sm text-stone-600 dark:text-neutral-400">
                    Reset code
                  </label>
                  <Input
                    id="code"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                    autoFocus
                  />
                  <p className="text-xs text-stone-500 dark:text-neutral-500">
                    Expires 15 minutes after being sent.
                  </p>
                </div>

                <div className="space-y-1">
                  <label htmlFor="new-password" className="text-sm text-stone-600 dark:text-neutral-400">
                    New password
                  </label>
                  <Input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="confirm-password" className="text-sm text-stone-600 dark:text-neutral-400">
                    Confirm new password
                  </label>
                  <Input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>

                {resetError && (
                  <p className="text-sm text-red-700 dark:text-red-400 flex items-center gap-2" role="alert">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {resetError}
                  </p>
                )}

                <Button
                  type="submit"
                  disabled={resetting}
                  className="w-full text-white bg-stone-600 hover:bg-stone-700 dark:bg-neutral-700 dark:hover:bg-neutral-600 hover:scale-105 transition-all duration-300 ease-in-out"
                >
                  {resetting ? "Resetting…" : "Reset password"}
                </Button>

                <button
                  type="button"
                  className="w-full text-center text-xs text-stone-500 dark:text-neutral-500 hover:underline flex items-center justify-center gap-1"
                  onClick={() => {
                    setStep("request");
                    setCode("");
                    setNewPassword("");
                    setConfirmPassword("");
                    setResetError(null);
                  }}
                >
                  <ArrowLeft className="w-3 h-3" />
                  Use a different email
                </button>
              </form>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
