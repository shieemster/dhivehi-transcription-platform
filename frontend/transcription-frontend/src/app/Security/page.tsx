'use client'
import * as React from "react";
const { useState, useEffect } = React;
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BACKEND_URL } from "@/config";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch, ApiError } from "@/lib/api";
import {
  ArrowLeft,
  Moon,
  Sun,
  ShieldCheck,
  ShieldAlert,
  Lock,
  LockOpen,
  Users,
  Activity,
  AlertTriangle,
  UserX,
  Loader2,
  AlertCircle,
  RefreshCw,
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

interface AuditSummary {
  total_entries: number;
  entries_last_24h: number;
  failed_logins_last_24h: number;
  access_denied_last_24h: number;
  chain_valid: boolean;
  broken_at_id: number | null;
}

interface RoleCount {
  role_name: string;
  user_count: number;
}

interface DashboardData {
  audit: AuditSummary;
  roles: RoleCount[];
  encryption_at_rest_configured: boolean;
}

interface AuditEntry {
  id: number;
  occurred_at: string;
  user_email: string;
  action: string;
  resource_type: string;
  resource_id: string;
  ip_address: string;
  details: Record<string, unknown>;
}

const FLAGGED_ACTIONS = new Set(["login_failed", "access_denied"]);
const RECENT_LOG_ROWS = 25;
const AUTO_REFRESH_MS = 30000;

export default function SecurityDashboard() {
  const router = useRouter();
  const { user, token, authFetch, isLoading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!token) {
      router.push("/login");
      return;
    }
    // security_dashboard:view is administrator-only server-side — this is
    // just a UI-level shortcut so non-admins don't even see a page that's
    // guaranteed to 403; the backend enforces the real RBAC check either way.
    if (user && user.role !== "administrator") {
      router.push("/");
      return;
    }
  }, [authLoading, token, user, router]);

  const loadDashboard = React.useCallback(async (opts: { background?: boolean } = {}) => {
    try {
      if (opts.background) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      const [dashboard, auditLogs] = await Promise.all([
        apiFetch<DashboardData>(authFetch, `${BACKEND_URL}/security/dashboard`),
        apiFetch<AuditEntry[]>(authFetch, `${BACKEND_URL}/audit-logs`),
      ]);
      setData(dashboard);
      setLogs((auditLogs ?? []).slice(0, RECENT_LOG_ROWS));
      setLastUpdated(new Date());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to load security dashboard");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [authFetch, router]);

  useEffect(() => {
    if (authLoading || !token) return;
    if (user && user.role !== "administrator") return;

    loadDashboard();
    const interval = setInterval(() => loadDashboard({ background: true }), AUTO_REFRESH_MS);
    return () => clearInterval(interval);
  }, [authLoading, token, user, loadDashboard]);

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  if (authLoading || (loading && !data && !error)) {
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
            Security Dashboard
          </h1>
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-xs text-stone-500 dark:text-neutral-400 hidden sm:inline">
                Updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => loadDashboard({ background: true })}
              disabled={refreshing}
              title="Refresh now"
              className="hover:scale-110 transition-all duration-300 ease-in-out"
            >
              <RefreshCw className={`h-5 w-5 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6">
        <Button
          onClick={() => router.push("/")}
          variant="ghost"
          className="mb-6 text-stone-700 dark:text-neutral-300 hover:text-stone-900 dark:hover:text-white"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Home
        </Button>

        {error && (
          <Card className="shadow-xl bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 mb-6">
            <CardContent className="p-6 flex items-center gap-3">
              <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400 shrink-0" />
              <p className="text-red-800 dark:text-red-200">{error}</p>
            </CardContent>
          </Card>
        )}

        {data && (
          <>
            {/* Top-line status cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              <StatusCard
                icon={data.audit.chain_valid ? ShieldCheck : ShieldAlert}
                label="Audit Chain Integrity"
                value={data.audit.chain_valid ? "Intact" : `Broken at #${data.audit.broken_at_id}`}
                tone={data.audit.chain_valid ? "good" : "bad"}
              />
              <StatusCard
                icon={data.encryption_at_rest_configured ? Lock : LockOpen}
                label="Encryption at Rest"
                value={data.encryption_at_rest_configured ? "Configured" : "Not configured"}
                tone={data.encryption_at_rest_configured ? "good" : "bad"}
              />
              <StatusCard
                icon={Activity}
                label="Audit Entries (24h)"
                value={String(data.audit.entries_last_24h)}
                tone="neutral"
                sub={`${data.audit.total_entries} total`}
              />
              <StatusCard
                icon={UserX}
                label="Failed Logins (24h)"
                value={String(data.audit.failed_logins_last_24h)}
                tone={data.audit.failed_logins_last_24h > 0 ? "warn" : "neutral"}
              />
              <StatusCard
                icon={AlertTriangle}
                label="Access Denied (24h)"
                value={String(data.audit.access_denied_last_24h)}
                tone={data.audit.access_denied_last_24h > 0 ? "warn" : "neutral"}
              />
              <StatusCard
                icon={Users}
                label="Roles in Use"
                value={String(data.roles.filter((r) => r.user_count > 0).length)}
                tone="neutral"
                sub={`${data.roles.length} roles defined`}
              />
            </div>

            {/* RBAC breakdown */}
            <Card className="shadow-xl bg-stone-100 dark:bg-neutral-800 border-stone-200 dark:border-neutral-700 mb-6">
              <CardHeader>
                <CardTitle className="text-xl text-neutral-900 dark:text-white flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Roles &amp; User Counts
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {data.roles.map((r) => (
                    <div
                      key={r.role_name}
                      className="p-4 bg-stone-50 dark:bg-neutral-700/50 rounded-lg text-center"
                    >
                      <p className="text-xs uppercase tracking-wide text-stone-500 dark:text-neutral-400 mb-1">
                        {r.role_name}
                      </p>
                      <p className="text-3xl font-bold text-stone-900 dark:text-white">
                        {r.user_count}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Recent audit log */}
            <Card className="shadow-xl bg-stone-100 dark:bg-neutral-800 border-stone-200 dark:border-neutral-700">
              <CardHeader>
                <CardTitle className="text-xl text-neutral-900 dark:text-white flex items-center gap-2">
                  <Activity className="w-5 h-5" />
                  Recent Audit Log
                </CardTitle>
              </CardHeader>
              <CardContent>
                {logs.length === 0 ? (
                  <p className="text-stone-600 dark:text-neutral-400 text-center py-8">
                    No audit entries yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-stone-500 dark:text-neutral-400 border-b border-stone-300 dark:border-neutral-600">
                          <th className="py-2 pr-4">Time</th>
                          <th className="py-2 pr-4">User</th>
                          <th className="py-2 pr-4">Action</th>
                          <th className="py-2 pr-4">Resource</th>
                          <th className="py-2 pr-4">IP</th>
                        </tr>
                      </thead>
                      <tbody>
                        {logs.map((entry) => (
                          <tr
                            key={entry.id}
                            className={`border-b border-stone-200 dark:border-neutral-700 last:border-0 ${
                              FLAGGED_ACTIONS.has(entry.action)
                                ? "bg-red-50 dark:bg-red-900/10"
                                : ""
                            }`}
                          >
                            <td className="py-2 pr-4 whitespace-nowrap text-stone-600 dark:text-neutral-400">
                              {formatTime(entry.occurred_at)}
                            </td>
                            <td className="py-2 pr-4 text-stone-900 dark:text-white">
                              {entry.user_email}
                            </td>
                            <td className="py-2 pr-4">
                              <Badge
                                className={
                                  FLAGGED_ACTIONS.has(entry.action)
                                    ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                                    : "bg-stone-200 text-stone-800 dark:bg-neutral-700 dark:text-neutral-200"
                                }
                              >
                                {entry.action}
                              </Badge>
                            </td>
                            <td className="py-2 pr-4 text-stone-600 dark:text-neutral-400 font-mono text-xs">
                              {entry.resource_type}
                              {entry.resource_id ? `:${entry.resource_id}` : ""}
                            </td>
                            <td className="py-2 pr-4 text-stone-600 dark:text-neutral-400">
                              {entry.ip_address}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}

function StatusCard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  tone: "good" | "bad" | "warn" | "neutral";
}) {
  const toneClasses = {
    good: "text-green-600 dark:text-green-400",
    bad: "text-red-600 dark:text-red-400",
    warn: "text-amber-600 dark:text-amber-400",
    neutral: "text-stone-600 dark:text-neutral-400",
  }[tone];

  return (
    <Card className="shadow-lg bg-stone-100 dark:bg-neutral-800 border-stone-200 dark:border-neutral-700">
      <CardContent className="p-4 flex items-center gap-3">
        <Icon className={`w-8 h-8 shrink-0 ${toneClasses}`} />
        <div>
          <p className="text-xs text-stone-500 dark:text-neutral-400">{label}</p>
          <p className={`text-xl font-bold ${toneClasses}`}>{value}</p>
          {sub && <p className="text-xs text-stone-400 dark:text-neutral-500">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
