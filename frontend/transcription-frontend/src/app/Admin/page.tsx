'use client'
import * as React from "react";
const { useState, useEffect, useCallback } = React;
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BACKEND_URL } from "@/config";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch, ApiError } from "@/lib/api";
import { AdminMenu } from "@/components/AdminMenu";
import {
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
  UserCog,
  LogOut,
  ChevronRight,
  Upload,
  List,
} from "lucide-react";
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

interface SecuritySummary {
  audit: AuditSummary;
  roles: RoleCount[];
  encryption_at_rest_configured: boolean;
}

interface SystemHealthSummary {
  overall_status: "healthy" | "degraded";
}

interface TranscriptStats {
  total_hours?: number;
  processing?: number;
  uploaded?: number;
  completed?: number;
}

const AUTO_REFRESH_MS = 30000;

export default function AdminDashboard() {
  const router = useRouter();
  const { user, isAuthenticated, authFetch, isLoading: authLoading, logout } = useAuth();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [security, setSecurity] = useState<SecuritySummary | null>(null);
  const [health, setHealth] = useState<SystemHealthSummary | null>(null);
  const [stats, setStats] = useState<TranscriptStats | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      router.push("/login");
    }
  }, [authLoading, isAuthenticated, router]);

  // Deliberately does NOT pre-check `user.role` before calling the API —
  // security_dashboard:view is enforced server-side, and that middleware
  // only gets a chance to see (and audit-log) a denied attempt if the
  // frontend actually asks it, instead of quietly redirecting away
  // client-side before any request is sent. A non-administrator landing
  // here (e.g. via a stale bookmark) gets bounced to "/" on the resulting 403.
  const loadDashboard = useCallback(async (opts: { background?: boolean } = {}) => {
    if (opts.background) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const [securitySummary, systemHealth, transcriptStats] = await Promise.all([
        apiFetch<SecuritySummary>(authFetch, `${BACKEND_URL}/security/dashboard`),
        apiFetch<SystemHealthSummary>(authFetch, `${BACKEND_URL}/system/health`),
        apiFetch<TranscriptStats>(authFetch, `${BACKEND_URL}/transcripts/stats`),
      ]);
      setSecurity(securitySummary);
      setHealth(systemHealth);
      setStats(transcriptStats);
      setLastUpdated(new Date());
      setLoading(false);
      setRefreshing(false);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        router.push(err.status === 401 ? "/login" : "/");
        if (opts.background) setRefreshing(false);
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to load admin dashboard");
      setLoading(false);
      setRefreshing(false);
    }
  }, [authFetch, router]);

  useEffect(() => {
    if (authLoading || !isAuthenticated) return;
    loadDashboard();
    const interval = setInterval(() => loadDashboard({ background: true }), AUTO_REFRESH_MS);
    return () => clearInterval(interval);
  }, [authLoading, isAuthenticated, loadDashboard]);

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  if (authLoading || (loading && !security && !error)) {
    return (
      <div className="min-h-screen bg-stone-200 dark:bg-neutral-900 flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-stone-600 dark:text-neutral-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-200 dark:bg-neutral-900 transition-all duration-500 ease-in-out">
      <header className="backdrop-blur-sm shadow-md dark:shadow-lg">
        <div className="max-w-6xl mx-auto pl-2 pr-6 py-4 flex items-center justify-between gap-2">
          <h1 className="text-2xl font-bold text-neutral-700 dark:text-white">
            Admin Dashboard
          </h1>
          <div className="flex items-center gap-3">
            {user && (
              <span className="text-sm hidden sm:inline text-neutral-600 dark:text-neutral-300">
                {user.display_name} · <span className="capitalize">{user.role}</span>
              </span>
            )}
            {lastUpdated && (
              <span className="text-xs text-stone-500 dark:text-neutral-400 hidden md:inline">
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
            <AdminMenu />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push("/Account")}
              title="Account Settings"
              className="hover:scale-110 transition-all duration-300 ease-in-out"
            >
              <UserCog className="h-5 w-5 text-neutral-700 dark:text-neutral-300" />
            </Button>
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              title="Log out"
              className="hover:scale-110 transition-all duration-300 ease-in-out"
            >
              <LogOut className="h-5 w-5 text-neutral-700 dark:text-neutral-300" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6">
        {error && (
          <Card className="shadow-xl bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 mb-6">
            <CardContent className="p-6 flex items-center gap-3">
              <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400 shrink-0" />
              <p className="text-red-800 dark:text-red-200">{error}</p>
            </CardContent>
          </Card>
        )}

        {security && (
          <>
            {/* Top-line security status cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              <StatCard
                icon={Activity}
                label="System Status"
                value={health?.overall_status === "healthy" ? "Operational" : "Degraded"}
                tone={health?.overall_status === "healthy" ? "good" : "bad"}
                onClick={() => router.push("/Admin/Health")}
                sub="Click for details"
              />
              <StatCard
                icon={security.audit.chain_valid ? ShieldCheck : ShieldAlert}
                label="Audit Chain Integrity"
                value={security.audit.chain_valid ? "Intact" : `Broken at #${security.audit.broken_at_id}`}
                tone={security.audit.chain_valid ? "good" : "bad"}
                onClick={() => router.push("/Security")}
              />
              <StatCard
                icon={security.encryption_at_rest_configured ? Lock : LockOpen}
                label="Encryption at Rest"
                value={security.encryption_at_rest_configured ? "Configured" : "Not configured"}
                tone={security.encryption_at_rest_configured ? "good" : "bad"}
                onClick={() => router.push("/Security")}
              />
              <StatCard
                icon={UserX}
                label="Failed Logins (24h)"
                value={String(security.audit.failed_logins_last_24h)}
                tone={security.audit.failed_logins_last_24h > 0 ? "warn" : "neutral"}
                onClick={() => router.push("/Security?action=login_failed")}
                sub="Click to view logs"
              />
              <StatCard
                icon={AlertTriangle}
                label="Access Denied (24h)"
                value={String(security.audit.access_denied_last_24h)}
                tone={security.audit.access_denied_last_24h > 0 ? "warn" : "neutral"}
                onClick={() => router.push("/Security?action=access_denied")}
                sub="Click to view logs"
              />
              <StatCard
                icon={Users}
                label="Roles in Use"
                value={String(security.roles.filter((r) => r.user_count > 0).length)}
                tone="neutral"
                sub={`${security.roles.length} roles defined — click to view`}
                onClick={() => router.push("/Admin/Users")}
              />
            </div>

            {/* RBAC breakdown */}
            <Card className="shadow-xl bg-stone-100 dark:bg-neutral-800 border-stone-200 dark:border-neutral-700 mb-6">
              <CardHeader>
                <CardTitle className="text-xl text-neutral-900 dark:text-white flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Roles &amp; User Counts
                </CardTitle>
                <p className="text-xs text-stone-500 dark:text-neutral-400">
                  Click a role to view its audit activity.
                </p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {security.roles.map((r) => (
                    <button
                      key={r.role_name}
                      type="button"
                      onClick={() => router.push(`/Security?role=${encodeURIComponent(r.role_name)}`)}
                      className="p-4 bg-stone-50 dark:bg-neutral-700/50 hover:bg-stone-200 dark:hover:bg-neutral-700 rounded-lg text-center transition-colors"
                    >
                      <p className="text-xs uppercase tracking-wide text-stone-500 dark:text-neutral-400 mb-1">
                        {r.role_name}
                      </p>
                      <p className="text-3xl font-bold text-stone-900 dark:text-white">
                        {r.user_count}
                      </p>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Quick actions */}
            <Card className="shadow-xl bg-stone-100 dark:bg-neutral-800 border-stone-200 dark:border-neutral-700 mb-6">
              <CardHeader>
                <CardTitle className="text-xl text-neutral-900 dark:text-white">
                  Quick Actions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <QuickActionCard
                    icon={ShieldCheck}
                    label="Security Dashboard"
                    description="Audit log, chain integrity, filters"
                    onClick={() => router.push("/Security")}
                  />
                  <QuickActionCard
                    icon={Users}
                    label="User Management"
                    description="Create, deactivate, change roles"
                    onClick={() => router.push("/Admin/Users")}
                  />
                  <QuickActionCard
                    icon={Activity}
                    label="System Health"
                    description="Infra checks, pipeline workers, jobs"
                    onClick={() => router.push("/Admin/Health")}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Transcript workspace */}
            <Card className="shadow-xl bg-stone-100 dark:bg-neutral-800 border-stone-200 dark:border-neutral-700">
              <CardHeader>
                <CardTitle className="text-xl text-neutral-900 dark:text-white">
                  Transcript Workspace
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4 mb-4 text-center">
                  <div>
                    <p className="text-2xl font-bold text-stone-900 dark:text-white">
                      {(stats?.total_hours ?? 0).toFixed(1)}
                    </p>
                    <p className="text-xs text-stone-500 dark:text-neutral-400">Hours Transcribed</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-stone-900 dark:text-white">
                      {(stats?.processing ?? 0) + (stats?.uploaded ?? 0)}
                    </p>
                    <p className="text-xs text-stone-500 dark:text-neutral-400">Pending</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-stone-900 dark:text-white">
                      {stats?.completed ?? 0}
                    </p>
                    <p className="text-xs text-stone-500 dark:text-neutral-400">Completed</p>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <Button
                    onClick={() => router.push("/Transcripts")}
                    className="text-white bg-stone-600 hover:bg-stone-700 dark:bg-neutral-700 dark:hover:bg-neutral-600"
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    Upload File
                  </Button>
                  <Button
                    onClick={() => router.push("/Transcripts/List")}
                    variant="outline"
                    className="border bg-stone-100 hover:bg-stone-200 border-stone-300 text-stone-700 dark:bg-neutral-800 dark:hover:bg-neutral-700 dark:border-neutral-600 dark:text-neutral-200"
                  >
                    <List className="w-4 h-4 mr-2" />
                    View All Transcripts
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  tone: "good" | "bad" | "warn" | "neutral";
  onClick?: () => void;
}) {
  const toneClasses = {
    good: "text-green-600 dark:text-green-400",
    bad: "text-red-600 dark:text-red-400",
    warn: "text-amber-600 dark:text-amber-400",
    neutral: "text-stone-600 dark:text-neutral-400",
  }[tone];

  return (
    <Card
      onClick={onClick}
      className={`shadow-lg bg-stone-100 dark:bg-neutral-800 border-stone-200 dark:border-neutral-700 ${
        onClick ? "cursor-pointer hover:shadow-xl transition-shadow" : ""
      }`}
    >
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

function QuickActionCard({
  icon: Icon,
  label,
  description,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 p-4 rounded-lg border border-stone-200 dark:border-neutral-700 bg-stone-50 dark:bg-neutral-700/50 hover:bg-stone-200 dark:hover:bg-neutral-700 transition-colors text-left"
    >
      <Icon className="w-6 h-6 shrink-0 text-stone-600 dark:text-neutral-300" />
      <div className="flex-1">
        <p className="text-sm font-semibold text-stone-900 dark:text-white">{label}</p>
        <p className="text-xs text-stone-500 dark:text-neutral-400">{description}</p>
      </div>
      <ChevronRight className="w-4 h-4 text-stone-400 dark:text-neutral-500 shrink-0" />
    </button>
  );
}
