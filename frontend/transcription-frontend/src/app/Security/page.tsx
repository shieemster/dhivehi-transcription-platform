'use client'
import * as React from "react";
const { useState, useEffect } = React;
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { BACKEND_URL } from "@/config";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch, ApiError } from "@/lib/api";
import { AdminMenu } from "@/components/AdminMenu";
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
  Search,
  X,
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

interface ManagedUser {
  email: string;
  role_name: string;
}

const FLAGGED_ACTIONS = new Set(["login_failed", "access_denied"]);
const RECENT_LOG_ROWS = 25;
const AUTO_REFRESH_MS = 30000;

export default function SecurityDashboard() {
  const router = useRouter();
  const { user, isAuthenticated, authFetch, isLoading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [roleByEmail, setRoleByEmail] = useState<Record<string, string>>({});

  // Audit log filters
  const [actionFilter, setActionFilter] = useState("");
  const [resourceFilter, setResourceFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [ipSearch, setIpSearch] = useState("");
  const [showAllLogs, setShowAllLogs] = useState(false);
  const auditLogRef = React.useRef<HTMLDivElement>(null);
  const rolesSectionRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      router.push("/login");
    }
  }, [authLoading, isAuthenticated, router]);

  // Lets the Admin Dashboard deep-link straight into a filtered view (e.g.
  // /Security?action=login_failed) instead of landing on the unfiltered
  // log. Read directly off window.location rather than useSearchParams to
  // avoid that hook's mandatory Suspense-boundary requirement for a
  // one-time read on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const action = params.get("action");
    const role = params.get("role");
    if (action) setActionFilter(action);
    if (role) setRoleFilter(role);
  }, []);

  // Deliberately does NOT pre-check `user.role` before calling the API —
  // security_dashboard:view is enforced server-side (middleware
  // .RequirePermission), and that middleware only gets a chance to see (and
  // audit-log) a denied attempt if the frontend actually asks it, instead
  // of quietly redirecting away client-side before any request is sent.
  const loadDashboard = React.useCallback(async (opts: { background?: boolean } = {}) => {
    if (opts.background) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const [dashboard, auditLogs] = await Promise.all([
        apiFetch<DashboardData>(authFetch, `${BACKEND_URL}/security/dashboard`),
        apiFetch<AuditEntry[]>(authFetch, `${BACKEND_URL}/audit-logs`),
      ]);
      setData(dashboard);
      setLogs(auditLogs ?? []);
      setLastUpdated(new Date());
      setLoading(false);
      setRefreshing(false);

      // Supplementary only — used to let "roles in use" filter the audit
      // log by role. Fetched best-effort so a hiccup here never blocks the
      // dashboard itself from loading.
      apiFetch<ManagedUser[]>(authFetch, `${BACKEND_URL}/users`)
        .then((users) => {
          const map: Record<string, string> = {};
          (users ?? []).forEach((u) => { map[u.email] = u.role_name; });
          setRoleByEmail(map);
        })
        .catch(() => {});
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        router.push(err.status === 401 ? "/login" : "/");
        // On the very first (non-background) load, deliberately leave
        // `loading` stuck at true — the page render is gated on it (see
        // `loading && !data && !error` below), so this keeps a non-admin on
        // the spinner instead of flashing real content while the redirect
        // is in flight. A background poll's session dying mid-visit isn't
        // the same risk (the page was already legitimately showing this
        // content), so that path still clears its own spinner.
        if (opts.background) setRefreshing(false);
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to load security dashboard");
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

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  const actionOptions = React.useMemo(
    () => Array.from(new Set(logs.map((e) => e.action))).sort(),
    [logs]
  );
  const resourceOptions = React.useMemo(
    () => Array.from(new Set(logs.map((e) => e.resource_type).filter(Boolean))).sort(),
    [logs]
  );

  const filteredLogs = React.useMemo(() => {
    const userQuery = userSearch.trim().toLowerCase();
    const ipQuery = ipSearch.trim().toLowerCase();
    return logs.filter((e) => {
      if (actionFilter && e.action !== actionFilter) return false;
      if (resourceFilter && e.resource_type !== resourceFilter) return false;
      if (roleFilter && roleByEmail[e.user_email] !== roleFilter) return false;
      if (userQuery && !e.user_email.toLowerCase().includes(userQuery)) return false;
      if (ipQuery && !e.ip_address.toLowerCase().includes(ipQuery)) return false;
      return true;
    });
  }, [logs, actionFilter, resourceFilter, roleFilter, userSearch, ipSearch, roleByEmail]);

  const filtersActive = Boolean(actionFilter || resourceFilter || roleFilter || userSearch || ipSearch);
  const visibleLogs = showAllLogs ? filteredLogs : filteredLogs.slice(0, RECENT_LOG_ROWS);

  useEffect(() => {
    setShowAllLogs(false);
  }, [actionFilter, resourceFilter, roleFilter, userSearch, ipSearch]);

  const clearFilters = () => {
    setActionFilter("");
    setResourceFilter("");
    setRoleFilter("");
    setUserSearch("");
    setIpSearch("");
  };

  const scrollToAuditLog = () => {
    auditLogRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const filterByAction = (action: string) => {
    setActionFilter((prev) => (prev === action ? "" : action));
    setResourceFilter("");
    setRoleFilter("");
    scrollToAuditLog();
  };

  const filterByRole = (role: string) => {
    setRoleFilter((prev) => (prev === role ? "" : role));
    setActionFilter("");
    setResourceFilter("");
    scrollToAuditLog();
  };

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
            onClick={() => router.push("/Admin")}
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
            <AdminMenu />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6">
        <Button
          onClick={() => router.push("/Admin")}
          variant="ghost"
          className="mb-6 text-stone-700 dark:text-neutral-300 hover:text-stone-900 dark:hover:text-white"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Admin Dashboard
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
                onClick={() => filterByAction("login_failed")}
                active={actionFilter === "login_failed"}
                sub="Click to view logs"
              />
              <StatusCard
                icon={AlertTriangle}
                label="Access Denied (24h)"
                value={String(data.audit.access_denied_last_24h)}
                tone={data.audit.access_denied_last_24h > 0 ? "warn" : "neutral"}
                onClick={() => filterByAction("access_denied")}
                active={actionFilter === "access_denied"}
                sub="Click to view logs"
              />
              <StatusCard
                icon={Users}
                label="Roles in Use"
                value={String(data.roles.filter((r) => r.user_count > 0).length)}
                tone="neutral"
                sub={`${data.roles.length} roles defined — click to view`}
                onClick={() => rolesSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              />
            </div>

            {/* RBAC breakdown */}
            <Card
              ref={rolesSectionRef}
              className="shadow-xl bg-stone-100 dark:bg-neutral-800 border-stone-200 dark:border-neutral-700 mb-6 scroll-mt-4"
            >
              <CardHeader>
                <CardTitle className="text-xl text-neutral-900 dark:text-white flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Roles &amp; User Counts
                </CardTitle>
                <p className="text-xs text-stone-500 dark:text-neutral-400">
                  Click a role to filter the audit log below to that role&apos;s users.
                </p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {data.roles.map((r) => (
                    <button
                      key={r.role_name}
                      type="button"
                      onClick={() => filterByRole(r.role_name)}
                      className={`p-4 rounded-lg text-center transition-colors ${
                        roleFilter === r.role_name
                          ? "bg-blue-100 dark:bg-blue-900/40 ring-2 ring-blue-500"
                          : "bg-stone-50 dark:bg-neutral-700/50 hover:bg-stone-200 dark:hover:bg-neutral-700"
                      }`}
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

            {/* Recent audit log */}
            <Card
              ref={auditLogRef}
              className="shadow-xl bg-stone-100 dark:bg-neutral-800 border-stone-200 dark:border-neutral-700 scroll-mt-4"
            >
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-xl text-neutral-900 dark:text-white flex items-center gap-2">
                    <Activity className="w-5 h-5" />
                    Audit Log
                  </CardTitle>
                  <span className="text-xs text-stone-500 dark:text-neutral-400">
                    Showing {visibleLogs.length} of {filteredLogs.length}
                    {filtersActive ? ` (filtered from ${logs.length})` : ""}
                  </span>
                </div>

                {/* Filter toolbar */}
                <div className="flex flex-wrap items-center gap-2 pt-3">
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 dark:text-neutral-500" />
                    <Input
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      placeholder="Search user"
                      className="h-8 pl-8 w-40 text-sm"
                    />
                  </div>
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 dark:text-neutral-500" />
                    <Input
                      value={ipSearch}
                      onChange={(e) => setIpSearch(e.target.value)}
                      placeholder="Search IP"
                      className="h-8 pl-8 w-36 text-sm"
                    />
                  </div>
                  <select
                    value={actionFilter}
                    onChange={(e) => setActionFilter(e.target.value)}
                    className="h-8 rounded-md border border-stone-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-2 text-sm text-stone-900 dark:text-white"
                  >
                    <option value="">All actions</option>
                    {actionOptions.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                  <select
                    value={resourceFilter}
                    onChange={(e) => setResourceFilter(e.target.value)}
                    className="h-8 rounded-md border border-stone-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-2 text-sm text-stone-900 dark:text-white"
                  >
                    <option value="">All resources</option>
                    {resourceOptions.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  {roleFilter && (
                    <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 gap-1">
                      role: {roleFilter}
                    </Badge>
                  )}
                  {filtersActive && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearFilters}
                      className="h-8 text-stone-600 dark:text-neutral-400"
                    >
                      <X className="w-3.5 h-3.5 mr-1" />
                      Clear filters
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {logs.length === 0 ? (
                  <p className="text-stone-600 dark:text-neutral-400 text-center py-8">
                    No audit entries yet.
                  </p>
                ) : filteredLogs.length === 0 ? (
                  <p className="text-stone-600 dark:text-neutral-400 text-center py-8">
                    No audit entries match your filters.
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
                        {visibleLogs.map((entry) => (
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
                    {!showAllLogs && filteredLogs.length > RECENT_LOG_ROWS && (
                      <div className="flex justify-center pt-4">
                        <Button variant="outline" size="sm" onClick={() => setShowAllLogs(true)}>
                          Show all {filteredLogs.length} entries
                        </Button>
                      </div>
                    )}
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
  onClick,
  active,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  tone: "good" | "bad" | "warn" | "neutral";
  onClick?: () => void;
  active?: boolean;
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
      } ${active ? "ring-2 ring-blue-500" : ""}`}
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
