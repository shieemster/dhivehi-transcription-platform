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

interface PipelineStats {
  total: number;
  by_status: Record<string, number>;
  oldest_active_age_seconds?: number;
}

interface SystemHealth {
  overall_status: "healthy" | "degraded";
  checks: HealthCheck[];
  pipeline?: PipelineStats;
  pipeline_error?: string;
}

const AUTO_REFRESH_MS = 15000;

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

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      router.push("/login");
      return;
    }
    if (user && user.role !== "administrator") {
      router.push("/");
    }
  }, [authLoading, isAuthenticated, user, router]);

  const loadHealth = useCallback(async (opts: { background?: boolean } = {}) => {
    try {
      if (opts.background) setRefreshing(true); else setLoading(true);
      setError(null);
      const health = await apiFetch<SystemHealth>(authFetch, `${BACKEND_URL}/system/health`);
      setData(health);
      setLastUpdated(new Date());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to load system health");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [authFetch, router]);

  useEffect(() => {
    if (authLoading || !isAuthenticated) return;
    if (user && user.role !== "administrator") return;

    loadHealth();
    const interval = setInterval(() => loadHealth({ background: true }), AUTO_REFRESH_MS);
    return () => clearInterval(interval);
  }, [authLoading, isAuthenticated, user, loadHealth]);

  if (authLoading || !isAuthenticated) {
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
            onClick={() => router.push("/")}
          >
            System Health
          </h1>
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <Button
            onClick={() => router.push("/")}
            variant="ghost"
            className="text-stone-700 dark:text-neutral-300 hover:text-stone-900 dark:hover:text-white"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
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
                      <Badge variant="secondary">Total: {data.pipeline.total}</Badge>
                      {Object.entries(data.pipeline.by_status).map(([status, count]) => (
                        <Badge key={status} variant="outline" className="capitalize">
                          {status}: {count}
                        </Badge>
                      ))}
                    </div>
                    {typeof data.pipeline.oldest_active_age_seconds === "number" && (
                      <div className="flex items-center gap-2 text-sm text-stone-600 dark:text-neutral-400">
                        <Clock className="w-4 h-4" />
                        Oldest job still in progress: {formatAge(data.pipeline.oldest_active_age_seconds)} ago
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
