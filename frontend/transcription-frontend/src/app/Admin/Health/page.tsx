'use client'
import * as React from "react";
const { useState, useEffect, useCallback } = React;
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BACKEND_URL } from "@/config";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch, ApiError } from "@/lib/api";
import { AdminMenu } from "@/components/AdminMenu";
import {
  ArrowLeft,
  Moon,
  Sun,
  Activity,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  RefreshCw,
  Clock,
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

interface HealthCheck {
  name: string;
  status: "up" | "down";
  latency_ms?: number;
  detail?: string;
}

interface PipelineJobSummary {
  id: string;
  filename: string;
  category: string;
  reference_number: string;
  status: string;
  timestamp: string;
  uploaded_by?: string;
}

interface PipelineStats {
  total: number;
  by_status: Record<string, number>;
  oldest_active_age_seconds?: number;
  jobs: PipelineJobSummary[];
}

interface SystemHealth {
  overall_status: "healthy" | "degraded";
  checks: HealthCheck[];
  pipeline?: PipelineStats;
  pipeline_error?: string;
}

const AUTO_REFRESH_MS = 15000;
// Sentinel for "show every job regardless of status" — selected by clicking
// the Total badge, distinct from `null` (no selection, list hidden).
const ALL_JOBS = "__all__";

const INFRA_LABELS: Record<string, string> = {
  postgres: "PostgreSQL",
  redis: "Redis",
  minio: "MinIO",
  qdrant: "Qdrant",
};

const WORKER_LABELS: Record<string, string> = {
  convert: "Convert worker",
  diarization: "Diarization worker",
  transcription: "Transcription worker",
};

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export default function AdminHealthPage() {
  const router = useRouter();
  const { user, isAuthenticated, authFetch, isLoading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SystemHealth | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(ALL_JOBS);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      router.push("/login");
    }
  }, [authLoading, isAuthenticated, router]);

  // Deliberately does NOT pre-check `user.role` before calling the API —
  // the backend's own RBAC middleware is the real enforcement (see
  // middleware.RequirePermission), and it only gets a chance to see (and
  // audit-log) a denied attempt if the frontend actually asks it, instead
  // of quietly redirecting away client-side before any request is sent.
  const loadHealth = useCallback(async (opts: { background?: boolean } = {}) => {
    if (opts.background) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const health = await apiFetch<SystemHealth>(authFetch, `${BACKEND_URL}/system/health`);
      setData(health);
      setLastUpdated(new Date());
      setLoading(false);
      setRefreshing(false);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        router.push(err.status === 401 ? "/login" : "/");
        // On the very first (non-background) load, deliberately leave
        // `loading` stuck at true — the page render is gated on it, so this
        // keeps a non-admin on the spinner instead of flashing real content
        // while the redirect is in flight. A background poll's session dying
        // mid-visit isn't the same risk (the page was already legitimately
        // showing this content), so that path still clears its own spinner.
        if (opts.background) setRefreshing(false);
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to load system health");
      setLoading(false);
      setRefreshing(false);
    }
  }, [authFetch, router]);

  useEffect(() => {
    if (authLoading || !isAuthenticated) return;

    loadHealth();
    const interval = setInterval(() => loadHealth({ background: true }), AUTO_REFRESH_MS);
    return () => clearInterval(interval);
  }, [authLoading, isAuthenticated, loadHealth]);

  // Gates the ENTIRE page, not just the content area — loadHealth() only
  // flips `loading` false on a genuine 200 or a genuine non-auth error; a
  // 401/403 on the initial (non-background) load leaves it stuck at `true`
  // while the redirect it triggered is in flight, so a non-admin never sees
  // so much as the page header/nav flash before being sent away.
  if (authLoading || !isAuthenticated || loading) {
    return (
      <div className="min-h-screen bg-stone-200 dark:bg-neutral-900 flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-stone-600 dark:text-neutral-400" />
      </div>
    );
  }

  const infraChecks = data?.checks.filter(c => c.name in INFRA_LABELS) ?? [];
  const workerChecks = data?.checks.filter(c => c.name in WORKER_LABELS) ?? [];

  return (
    <div className="min-h-screen bg-stone-200 dark:bg-neutral-900 transition-all duration-500 ease-in-out">
      <header className="backdrop-blur-sm shadow-md dark:shadow-lg">
        <div className="max-w-5xl mx-auto pl-2 pr-6 py-4 flex items-center justify-between gap-2">
          <h1
            className="text-2xl font-bold text-neutral-700 dark:text-white cursor-pointer hover:text-neutral-900 dark:hover:text-neutral-200"
            onClick={() => router.push("/Admin")}
          >
            System Health
          </h1>
          <div className="flex items-center gap-1">
            <AdminMenu />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <Button
            onClick={() => router.push("/Admin")}
            variant="ghost"
            className="text-stone-700 dark:text-neutral-300 hover:text-stone-900 dark:hover:text-white"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Admin Dashboard
          </Button>
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-xs text-stone-500 dark:text-neutral-500">
                Updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}
            <Button size="sm" variant="outline" onClick={() => loadHealth({ background: true })} disabled={refreshing}>
              <RefreshCw className={`w-4 h-4 mr-1 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-10 h-10 animate-spin text-stone-500 dark:text-neutral-400" />
          </div>
        ) : error ? (
          <Card className="shadow-lg bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700">
            <CardContent className="p-4 flex items-center gap-3 text-sm text-red-800 dark:text-red-200">
              <AlertCircle className="w-5 h-5 shrink-0" />
              {error}
            </CardContent>
          </Card>
        ) : data ? (
          <>
            <Card className={`shadow-lg border ${data.overall_status === "healthy"
              ? "bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700"
              : "bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700"
              }`}>
              <CardContent className="p-4 flex items-center gap-3">
                <Activity className={`w-6 h-6 ${data.overall_status === "healthy" ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`} />
                <div>
                  <div className={`font-semibold ${data.overall_status === "healthy" ? "text-green-800 dark:text-green-200" : "text-amber-800 dark:text-amber-200"}`}>
                    {data.overall_status === "healthy" ? "All systems operational" : "Degraded — one or more checks failing"}
                  </div>
                  <div className="text-xs text-stone-500 dark:text-neutral-400">Auto-refreshes every {AUTO_REFRESH_MS / 1000}s</div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-xl bg-stone-100 dark:bg-neutral-800 border-stone-200 dark:border-neutral-700">
              <CardHeader>
                <CardTitle className="text-lg text-neutral-900 dark:text-white">Infrastructure</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-2 gap-3">
                  {infraChecks.map(check => (
                    <div key={check.name} className="flex items-center justify-between rounded-lg border border-stone-200 dark:border-neutral-700 p-3">
                      <div className="flex items-center gap-2">
                        {check.status === "up" ? (
                          <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                        ) : (
                          <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                        )}
                        <span className="text-sm font-medium text-stone-900 dark:text-white">
                          {INFRA_LABELS[check.name] ?? check.name}
                        </span>
                      </div>
                      <span className="text-xs text-stone-500 dark:text-neutral-400">
                        {check.status === "up" ? `${check.latency_ms ?? 0}ms` : (check.detail ?? "down")}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-xl bg-stone-100 dark:bg-neutral-800 border-stone-200 dark:border-neutral-700">
              <CardHeader>
                <CardTitle className="text-lg text-neutral-900 dark:text-white">Pipeline Workers</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-2 gap-3">
                  {workerChecks.map(check => (
                    <div key={check.name} className="flex items-center justify-between rounded-lg border border-stone-200 dark:border-neutral-700 p-3">
                      <div className="flex items-center gap-2">
                        {check.status === "up" ? (
                          <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                        ) : (
                          <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                        )}
                        <span className="text-sm font-medium text-stone-900 dark:text-white">
                          {WORKER_LABELS[check.name] ?? check.name}
                        </span>
                      </div>
                      <span className="text-xs text-stone-500 dark:text-neutral-400">
                        {check.detail ?? (check.status === "up" ? "up" : "down")}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-xl bg-stone-100 dark:bg-neutral-800 border-stone-200 dark:border-neutral-700">
              <CardHeader>
                <CardTitle className="text-lg text-neutral-900 dark:text-white">Pipeline Jobs</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.pipeline_error ? (
                  <p className="text-sm text-red-700 dark:text-red-400 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {data.pipeline_error}
                  </p>
                ) : data.pipeline ? (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedStatus(prev => (prev === ALL_JOBS ? null : ALL_JOBS))}
                        title="Show every job regardless of status"
                      >
                        <Badge
                          variant={selectedStatus === ALL_JOBS ? "default" : "secondary"}
                          className="cursor-pointer hover:opacity-80 transition-opacity"
                        >
                          Total: {data.pipeline.total}
                        </Badge>
                      </button>
                      {Object.entries(data.pipeline.by_status).map(([status, count]) => (
                        <button
                          key={status}
                          type="button"
                          onClick={() => setSelectedStatus(prev => (prev === status ? null : status))}
                          title={`Show jobs with status "${status}"`}
                        >
                          <Badge
                            variant={selectedStatus === status ? "default" : "outline"}
                            className="capitalize cursor-pointer hover:opacity-80 transition-opacity"
                          >
                            {status}: {count}
                          </Badge>
                        </button>
                      ))}
                    </div>
                    {typeof data.pipeline.oldest_active_age_seconds === "number" && (
                      <div className="flex items-center gap-2 text-sm text-stone-600 dark:text-neutral-400">
                        <Clock className="w-4 h-4" />
                        Oldest job still in progress: {formatAge(data.pipeline.oldest_active_age_seconds)} ago
                      </div>
                    )}

                    {selectedStatus && (
                      <div className="border border-stone-200 dark:border-neutral-700 rounded-lg overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-2 bg-stone-200/50 dark:bg-neutral-900/50 text-xs font-medium text-stone-600 dark:text-neutral-400">
                          <span className="capitalize">
                            {selectedStatus === ALL_JOBS ? "All jobs" : `Jobs with status "${selectedStatus}"`}
                          </span>
                          <button
                            type="button"
                            onClick={() => setSelectedStatus(null)}
                            className="hover:text-stone-900 dark:hover:text-white"
                          >
                            Clear
                          </button>
                        </div>
                        <div className="max-h-64 overflow-y-auto divide-y divide-stone-200 dark:divide-neutral-700">
                          {data.pipeline.jobs.filter(j => selectedStatus === ALL_JOBS || j.status === selectedStatus).map(job => (
                            <button
                              key={job.id}
                              type="button"
                              onClick={() => router.push(`/Transcripts/Details?job_id=${job.id}`)}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-stone-100 dark:hover:bg-neutral-700/50 transition-colors flex items-center justify-between gap-3"
                            >
                              <span className="truncate text-stone-900 dark:text-white">
                                {job.filename || job.id}
                                {job.reference_number && (
                                  <span className="text-stone-500 dark:text-neutral-400"> · {job.reference_number}</span>
                                )}
                              </span>
                              <span className="text-xs text-stone-500 dark:text-neutral-400 shrink-0">
                                {new Date(job.timestamp).toLocaleString()}
                              </span>
                            </button>
                          ))}
                          {data.pipeline.jobs.filter(j => selectedStatus === ALL_JOBS || j.status === selectedStatus).length === 0 && (
                            <p className="px-3 py-3 text-sm text-stone-500 dark:text-neutral-400">No jobs with this status.</p>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                ) : null}
              </CardContent>
            </Card>
          </>
        ) : null}
      </main>
    </div>
  );
}
