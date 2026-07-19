'use client'

import * as React from "react";
const { useState } = React;
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-sm text-muted-foreground">
            Dhivehi Transcription Platform
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!mfaRequired && (
            <>
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium">
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

              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium">
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
            <div className="space-y-2">
              <label htmlFor="mfa" className="text-sm font-medium">
                Authenticator code
              </label>
              <p className="text-xs text-muted-foreground">
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
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Signing in…" : mfaRequired ? "Verify" : "Sign in"}
          </Button>

          {mfaRequired && (
            <button
              type="button"
              className="w-full text-center text-xs text-muted-foreground hover:underline"
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
      </div>
    </div>
  );
}
