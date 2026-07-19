'use client'
import * as React from "react";
const { useState, useEffect } = React;
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, List, Moon, Sun, Loader2, LogOut, ShieldCheck, UserCog, Users, Activity } from "lucide-react";
import { BACKEND_URL } from "@/config";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "next-themes";

// Reads the resolved theme only for the toggle button's own icon/label —
// guarded by `mounted` (like every other page's ThemeToggle) so it doesn't
// render the wrong icon before hydration. Everything else on this page uses
// Tailwind's `dark:` variant classes instead of JS-computed colors, which is
// what avoids a light-mode flash: next-themes stamps the `dark` class onto
// <html> before hydration, so `dark:` classes are correct on the very first
// paint with no JS involved. Colors that depend on `themeMounted` gate the
// WHOLE page behind a post-mount flag, which is what caused the flash.
function ThemeToggleButton() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" disabled className="transition-all duration-300 ease-in-out">
        <Moon className="h-5 w-5 text-stone-700" />
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className="transition-all duration-300 ease-in-out hover:scale-110"
    >
      {theme === "dark" ? (
        <Sun className="h-5 w-5 text-neutral-400" />
      ) : (
        <Moon className="h-5 w-5 text-stone-700" />
      )}
    </Button>
  );
}

// Main Component
export default function TranscriptionApp() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading, logout, authFetch } = useAuth();

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push("/login");
    }
  }, [authLoading, isAuthenticated, router]);

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  const [hoursTranscribed, setHoursTranscribed] = useState(0);
  const [pendingTranscriptions, setPendingTranscriptions] = useState(0);
  const [completedTranscriptions, setCompletedTranscriptions] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch stats through the backend (authenticated) — this used to call
  // Qdrant directly from the browser with no login required at all,
  // meaning stats (and the underlying data) were reachable by anyone who
  // could reach the Qdrant port, entirely bypassing RBAC.
  useEffect(() => {
    if (!isAuthenticated) return; // wait for session to be restored before fetching

    const fetchStats = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await authFetch(`${BACKEND_URL}/transcripts/stats`);

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || `Failed to fetch stats: ${response.status}`);
        }

        const stats = await response.json();

        setHoursTranscribed(stats.total_hours ?? 0);
        setPendingTranscriptions((stats.processing ?? 0) + (stats.uploaded ?? 0));
        setCompletedTranscriptions(stats.completed ?? 0);
      } catch (err) {
        console.error('Error fetching stats:', err);
        const errorMessage = err instanceof Error ? err.message : 'Failed to fetch stats';
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();

    // Refresh stats every 30 seconds
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [isAuthenticated, authFetch]);

  const handleNavigateToList = () => {
    window.location.href = "/Transcripts/List";
  };

  const handleNavigateToUpload = () => {
    window.location.href = "/Transcripts";
  };

  return (
    <div className="min-h-screen bg-stone-200 dark:bg-neutral-900 transition-colors duration-300 ease-in-out">
      {/* Header */}
      <header className="backdrop-blur-sm shadow-md dark:shadow-lg transition-all duration-300 ease-in-out">
        <div className="max-w-8xl mx-auto pl-2 pr-6 py-4 flex items-center justify-between gap-2">
          <h1 className="text-2xl font-bold text-neutral-700 dark:text-white transition-colors duration-300 ease-in-out">
            Transcription App
          </h1>
          <div className="flex items-center gap-3">
            {user && (
              <span className="text-sm hidden sm:inline text-neutral-600 dark:text-neutral-300">
                {user.display_name} · <span className="capitalize">{user.role}</span>
              </span>
            )}
            {user?.role === 'administrator' && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => (window.location.href = "/Security")}
                title="Security Dashboard"
                className="transition-all duration-300 ease-in-out hover:scale-110"
              >
                <ShieldCheck className="h-5 w-5 text-neutral-700 dark:text-neutral-300" />
              </Button>
            )}
            {user?.role === 'administrator' && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => (window.location.href = "/Admin/Users")}
                title="User Management"
                className="transition-all duration-300 ease-in-out hover:scale-110"
              >
                <Users className="h-5 w-5 text-neutral-700 dark:text-neutral-300" />
              </Button>
            )}
            {user?.role === 'administrator' && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => (window.location.href = "/Admin/Health")}
                title="System Health"
                className="transition-all duration-300 ease-in-out hover:scale-110"
              >
                <Activity className="h-5 w-5 text-neutral-700 dark:text-neutral-300" />
              </Button>
            )}
            {user && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => (window.location.href = "/Account")}
                title="Account Settings"
                className="transition-all duration-300 ease-in-out hover:scale-110"
              >
                <UserCog className="h-5 w-5 text-neutral-700 dark:text-neutral-300" />
              </Button>
            )}
            <ThemeToggleButton />
            {user && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleLogout()}
                title="Log out"
                className="transition-all duration-300 ease-in-out hover:scale-110"
              >
                <LogOut className="h-5 w-5 text-neutral-700 dark:text-neutral-300" />
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-6 py-6 transition-all duration-300 ease-in-out">
        <div className="text-center mb-12 transition-all duration-300 ease-in-out">
          <h2 className="text-5xl font-bold mb-4 text-neutral-700 dark:text-white transition-colors duration-300 ease-in-out">
            Welcome to Transcription App
          </h2>
          <p className="text-xl text-stone-600 dark:text-neutral-300 transition-colors duration-300 ease-in-out">
            <span className="font-bold">Generate</span>,{" "}
            <span className="font-bold">Store</span> and{" "}
            <span className="font-bold">Manage</span> your{" "}
            <span className="font-bold">Transcripts</span> easily
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
            <p className="font-semibold">Error loading stats:</p>
            <p className="text-sm">{error}</p>
            <Button
              onClick={() => window.location.reload()}
              variant="outline"
              size="sm"
              className="mt-2"
            >
              Retry
            </Button>
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid md:grid-cols-3 gap-6 transition-all duration-300 ease-in-out">
          <Card
            className="shadow-lg border bg-stone-100 border-stone-200 dark:bg-neutral-800 dark:border-neutral-700 transition-all duration-300 ease-in-out hover:scale-105 cursor-pointer"
            onClick={handleNavigateToList}
          >
            <CardHeader>
              <h3 className="text-lg font-semibold text-stone-900 dark:text-white">
                Hours Transcribed
              </h3>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Loader2 className="w-12 h-12 animate-spin text-stone-600 dark:text-neutral-300" />
              ) : (
                <p className="text-5xl font-bold text-stone-600 dark:text-neutral-300">
                  {hoursTranscribed.toFixed(1)}
                </p>
              )}
            </CardContent>
          </Card>

          <Card
            className="shadow-lg border bg-stone-100 border-stone-200 dark:bg-neutral-800 dark:border-neutral-700 transition-all duration-300 ease-in-out hover:scale-105 cursor-pointer"
            onClick={handleNavigateToList}
          >
            <CardHeader>
              <h3 className="text-lg font-semibold text-stone-900 dark:text-white">
                Pending Transcripts
              </h3>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Loader2 className="w-12 h-12 animate-spin text-stone-600 dark:text-neutral-300" />
              ) : (
                <p className="text-5xl font-bold text-stone-600 dark:text-neutral-300">
                  {pendingTranscriptions}
                </p>
              )}
            </CardContent>
          </Card>

          <Card
            className="shadow-lg border bg-stone-100 border-stone-200 dark:bg-neutral-800 dark:border-neutral-700 transition-all duration-300 ease-in-out hover:scale-105 cursor-pointer"
            onClick={handleNavigateToList}
          >
            <CardHeader>
              <h3 className="text-lg font-semibold text-stone-900 dark:text-white">
                Completed Transcriptions
              </h3>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Loader2 className="w-12 h-12 animate-spin text-stone-600 dark:text-neutral-300" />
              ) : (
                <p className="text-5xl font-bold text-stone-600 dark:text-neutral-300">
                  {completedTranscriptions}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Action Buttons */}
        <div className="text-center mt-10">
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button
              onClick={handleNavigateToUpload}
              className="text-white bg-stone-600 hover:bg-stone-700 dark:bg-neutral-700 dark:hover:bg-neutral-600 hover:scale-105 transition-all duration-300 ease-in-out"
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload File
            </Button>

            <Button
              onClick={handleNavigateToList}
              variant="outline"
              className="border bg-stone-100 hover:bg-stone-200 border-stone-300 text-stone-700 dark:bg-neutral-800 dark:hover:bg-neutral-700 dark:border-neutral-600 dark:text-neutral-200 hover:scale-105 transition-all duration-300 ease-in-out"
            >
              <List className="w-4 h-4 mr-2" />
              View All Transcripts
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
