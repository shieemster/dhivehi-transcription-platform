'use client'
import * as React from "react";
const { useState, useEffect } = React;
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { BACKEND_URL } from "@/config";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch, ApiError } from "@/lib/api";
import {
  ArrowLeft,
  Moon,
  Sun,
  KeyRound,
  ShieldCheck,
  ShieldOff,
  LogOutIcon,
  Loader2,
  Check,
  AlertCircle,
} from "lucide-react";
import { useTheme } from "next-themes";

export function ThemeToggle() {
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

export default function AccountPage() {
  const router = useRouter();
  const { user, token, authFetch, logout, isLoading: authLoading } = useAuth();

  useEffect(() => {
    if (!authLoading && !token) {
      router.push("/login");
    }
  }, [authLoading, token, router]);

  // --- Change password ---
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);

    if (newPassword !== confirmPassword) {
      setPasswordError("New password and confirmation don't match.");
      return;
    }

    try {
      setPasswordSaving(true);
      await apiFetch(authFetch, `${BACKEND_URL}/auth/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });
      setPasswordChanged(true);
      // The backend just invalidated every session for this account,
      // including this one — clear local state and send the user back to
      // log in with the new password.
      setTimeout(async () => {
        await logout();
        router.push("/login");
      }, 1500);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setPasswordSaving(false);
    }
  }

  // --- MFA enrollment ---
  const [mfaEnabled, setMfaEnabled] = useState(user?.mfa_enabled ?? false);
  const [enrolling, setEnrolling] = useState(false);
  const [provisioningUri, setProvisioningUri] = useState<string | null>(null);
  const [mfaSecret, setMfaSecret] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaSubmitting, setMfaSubmitting] = useState(false);
  const [mfaConfirmed, setMfaConfirmed] = useState(false);

  useEffect(() => {
    setMfaEnabled(user?.mfa_enabled ?? false);
  }, [user]);

  async function startMfaEnrollment() {
    setMfaError(null);
    try {
      setEnrolling(true);
      const data = await apiFetch<{ secret: string; provisioning_uri: string }>(
        authFetch,
        `${BACKEND_URL}/auth/mfa/enroll/start`,
        { method: "POST" }
      );
      setMfaSecret(data.secret);
      setProvisioningUri(data.provisioning_uri);
      // Rendered entirely client-side from the provisioning URI — the TOTP
      // secret never leaves the browser (no third-party QR service call,
      // which would otherwise leak the secret to that third party).
      const dataUrl = await QRCode.toDataURL(data.provisioning_uri, { width: 220, margin: 1 });
      setQrDataUrl(dataUrl);
    } catch (err) {
      setMfaError(err instanceof Error ? err.message : "Failed to start MFA enrollment");
      setEnrolling(false);
    }
  }

  async function handleConfirmMfa(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaSecret) return;
    setMfaError(null);

    try {
      setMfaSubmitting(true);
      await apiFetch(authFetch, `${BACKEND_URL}/auth/mfa/enroll/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: mfaSecret, code: mfaCode }),
      });
      setMfaConfirmed(true);
      setMfaEnabled(true);
      setEnrolling(false);
      setProvisioningUri(null);
      setQrDataUrl(null);
      setMfaSecret(null);
      setMfaCode("");
    } catch (err) {
      setMfaError(err instanceof Error ? err.message : "Invalid code — check your authenticator app and try again");
    } finally {
      setMfaSubmitting(false);
    }
  }

  // --- Log out everywhere ---
  const [loggingOutAll, setLoggingOutAll] = useState(false);
  const [logoutAllError, setLogoutAllError] = useState<string | null>(null);

  async function handleLogoutAll() {
    setLogoutAllError(null);
    try {
      setLoggingOutAll(true);
      await apiFetch(authFetch, `${BACKEND_URL}/auth/logout-all`, { method: "POST" });
      await logout();
      router.push("/login");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Already invalidated this session too — just finish the redirect.
        await logout();
        router.push("/login");
        return;
      }
      setLogoutAllError(err instanceof Error ? err.message : "Failed to log out all sessions");
      setLoggingOutAll(false);
    }
  }

  if (authLoading || !token) {
    return (
      <div className="min-h-screen bg-stone-200 dark:bg-neutral-900 flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-stone-600 dark:text-neutral-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-200 dark:bg-neutral-900 transition-all duration-500 ease-in-out">
      <header className="backdrop-blur-sm shadow-md dark:shadow-lg">
        <div className="max-w-8xl mx-auto pl-2 pr-6 py-4 flex items-center justify-between gap-2">
          <h1
            className="text-2xl font-bold text-neutral-700 dark:text-white cursor-pointer hover:text-neutral-900 dark:hover:text-neutral-200"
            onClick={() => router.push("/")}
          >
            Account Settings
          </h1>
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-6 space-y-6">
        <Button
          onClick={() => router.push("/")}
          variant="ghost"
          className="text-stone-700 dark:text-neutral-300 hover:text-stone-900 dark:hover:text-white"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Home
        </Button>

        {user && (
          <Card className="shadow-lg bg-stone-100 dark:bg-neutral-800 border-stone-200 dark:border-neutral-700">
            <CardContent className="p-4 text-sm text-stone-600 dark:text-neutral-400">
              Signed in as <span className="font-semibold text-stone-900 dark:text-white">{user.email}</span>{" "}
              (<span className="capitalize">{user.role}</span>)
            </CardContent>
          </Card>
        )}

        {/* Change password */}
        <Card className="shadow-xl bg-stone-100 dark:bg-neutral-800 border-stone-200 dark:border-neutral-700">
          <CardHeader>
            <CardTitle className="text-lg text-neutral-900 dark:text-white flex items-center gap-2">
              <KeyRound className="w-5 h-5" />
              Change Password
            </CardTitle>
          </CardHeader>
          <CardContent>
            {passwordChanged ? (
              <p className="text-green-700 dark:text-green-400 flex items-center gap-2">
                <Check className="w-4 h-4" />
                Password changed. Redirecting to sign in again…
              </p>
            ) : (
              <form onSubmit={handleChangePassword} className="space-y-3">
                <div className="space-y-1">
                  <label className="text-sm text-stone-600 dark:text-neutral-400">Current password</label>
                  <Input
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm text-stone-600 dark:text-neutral-400">New password</label>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm text-stone-600 dark:text-neutral-400">Confirm new password</label>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>
                <p className="text-xs text-stone-500 dark:text-neutral-500">
                  At least 8 characters. Changing your password signs you out everywhere, including this device.
                </p>
                {passwordError && (
                  <p className="text-sm text-red-700 dark:text-red-400 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {passwordError}
                  </p>
                )}
                <Button type="submit" disabled={passwordSaving}>
                  {passwordSaving ? "Changing…" : "Change Password"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        {/* MFA */}
        <Card className="shadow-xl bg-stone-100 dark:bg-neutral-800 border-stone-200 dark:border-neutral-700">
          <CardHeader>
            <CardTitle className="text-lg text-neutral-900 dark:text-white flex items-center gap-2">
              {mfaEnabled ? <ShieldCheck className="w-5 h-5 text-green-600 dark:text-green-400" /> : <ShieldOff className="w-5 h-5" />}
              Two-Factor Authentication
              {mfaEnabled && (
                <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Enabled</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {mfaConfirmed ? (
              <p className="text-green-700 dark:text-green-400 flex items-center gap-2">
                <Check className="w-4 h-4" />
                MFA is now enabled on your account.
              </p>
            ) : mfaEnabled ? (
              <p className="text-sm text-stone-600 dark:text-neutral-400">
                Two-factor authentication is already enabled for this account.
              </p>
            ) : !enrolling ? (
              <div className="space-y-3">
                <p className="text-sm text-stone-600 dark:text-neutral-400">
                  Add an authenticator app (Google Authenticator, Authy, 1Password, etc.) as a second factor at login.
                </p>
                <Button onClick={startMfaEnrollment}>Enable MFA</Button>
              </div>
            ) : (
              <div className="space-y-4">
                {qrDataUrl && (
                  <div className="flex flex-col items-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qrDataUrl} alt="MFA QR code" className="rounded-lg bg-white p-2" />
                    <p className="text-xs text-stone-500 dark:text-neutral-500">
                      Scan with your authenticator app, or enter this key manually:
                    </p>
                    <code className="text-xs bg-stone-200 dark:bg-neutral-700 px-2 py-1 rounded select-all">
                      {mfaSecret}
                    </code>
                  </div>
                )}
                <form onSubmit={handleConfirmMfa} className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-sm text-stone-600 dark:text-neutral-400">
                      Enter the 6-digit code from your app
                    </label>
                    <Input
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
                  {mfaError && (
                    <p className="text-sm text-red-700 dark:text-red-400 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      {mfaError}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button type="submit" disabled={mfaSubmitting}>
                      {mfaSubmitting ? "Verifying…" : "Confirm & Enable"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setEnrolling(false);
                        setProvisioningUri(null);
                        setQrDataUrl(null);
                        setMfaSecret(null);
                        setMfaCode("");
                        setMfaError(null);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Sessions */}
        <Card className="shadow-xl bg-stone-100 dark:bg-neutral-800 border-stone-200 dark:border-neutral-700">
          <CardHeader>
            <CardTitle className="text-lg text-neutral-900 dark:text-white flex items-center gap-2">
              <LogOutIcon className="w-5 h-5" />
              Sessions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-stone-600 dark:text-neutral-400">
              If you think your account may be compromised on another device, sign out of every active session
              (including this one) at once.
            </p>
            {logoutAllError && (
              <p className="text-sm text-red-700 dark:text-red-400 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {logoutAllError}
              </p>
            )}
            <Button variant="outline" onClick={handleLogoutAll} disabled={loggingOutAll}>
              {loggingOutAll ? "Signing out…" : "Log Out of All Sessions"}
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
