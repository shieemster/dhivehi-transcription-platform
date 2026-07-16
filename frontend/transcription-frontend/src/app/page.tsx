'use client'
import * as React from "react";
const { useState, useEffect } = React;
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, List, Moon, Sun, Loader2, LogOut, ShieldCheck, UserCog } from "lucide-react";
import { BACKEND_URL } from "@/config";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "next-themes";

// Main Component
export default function TranscriptionApp() {
  const router = useRouter();
  const { user, token, isLoading: authLoading, logout, authFetch } = useAuth();
  const { setTheme, resolvedTheme } = useTheme();
  const [themeMounted, setThemeMounted] = useState(false);
  useEffect(() => setThemeMounted(true), []);

  useEffect(() => {
    if (!authLoading && !token) {
      router.push("/login");
    }
  }, [authLoading, token, router]);

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
    if (!token) return; // wait for session to be restored before fetching

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
  }, [token, authFetch]);

  const handleNavigateToList = () => {
    window.location.href = "/Transcripts/List";
  };

  const handleNavigateToUpload = () => {
    window.location.href = "/Transcripts";
  };

  // themeMounted guards against a server/client mismatch — next-themes
  // can't know the persisted theme until after hydration, same as every
  // other page's ThemeToggle. Before that, default to light rather than
  // flashing dark then correcting.
  const isDark = themeMounted && resolvedTheme === 'dark';

  return (
    <div className={`min-h-screen transition-colors duration-300 ease-in-out ${isDark ? 'bg-neutral-900' : 'bg-stone-200'
      }`}>
      {/* Header */}
      <header className="backdrop-blur-sm shadow-md dark:shadow-lg transition-all duration-300 ease-in-out">
        <div className="max-w-8xl mx-auto pl-2 pr-6 py-4 flex items-center justify-between gap-2">
          <h1 className={`text-2xl font-bold transition-colors duration-300 ease-in-out ${isDark ? 'text-white' : 'text-neutral-700'
            }`}>
            Transcription App
          </h1>
          <div className="flex items-center gap-3">
            {user && (
              <span className={`text-sm hidden sm:inline ${isDark ? 'text-neutral-300' : 'text-neutral-600'}`}>
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
                <ShieldCheck className={`h-5 w-5 ${isDark ? 'text-neutral-300' : 'text-neutral-700'}`} />
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
                <UserCog className={`h-5 w-5 ${isDark ? 'text-neutral-300' : 'text-neutral-700'}`} />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(isDark ? "light" : "dark")}
              className="transition-all duration-300 ease-in-out hover:scale-110"
            >
              {isDark ? (
                <Sun className="h-5 w-5 transition-all duration-300 ease-in-out text-neutral-400" />
              ) : (
                <Moon className="h-5 w-5 transition-all duration-300 ease-in-out text-stone-700" />
              )}
            </Button>
            {user && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleLogout()}
                title="Log out"
                className="transition-all duration-300 ease-in-out hover:scale-110"
              >
                <LogOut className={`h-5 w-5 ${isDark ? 'text-neutral-300' : 'text-neutral-700'}`} />
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-6 py-6 transition-all duration-300 ease-in-out">
        <div className="text-center mb-12 transition-all duration-300 ease-in-out">
          <h2 className={`text-5xl font-bold mb-4 transition-colors duration-300 ease-in-out ${isDark ? 'text-white' : 'text-neutral-700'
            }`}>
            Welcome to Transcription App
          </h2>
          <p className={`text-xl transition-colors duration-300 ease-in-out ${isDark ? 'text-neutral-300' : 'text-stone-600'
            }`}>
            <span className="font-bold">Generate</span>,{" "}
            <span className="font-bold">Store</span> and{" "}
            <span className="font-bold">Manage</span> your{" "}
            <span className="font-bold">Transcripts</span> easily
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className={`mb-6 p-4 rounded-lg ${isDark ? 'bg-red-900 text-red-200' : 'bg-red-100 text-red-800'
            }`}>
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
            className={`shadow-lg border transition-all duration-300 ease-in-out hover:scale-105 cursor-pointer ${isDark
              ? 'bg-neutral-800 border-neutral-700'
              : 'bg-stone-100 border-stone-200'
              }`}
            onClick={handleNavigateToList}
          >
            <CardHeader>
              <h3 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-stone-900'
                }`}>
                Hours Transcribed
              </h3>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Loader2 className={`w-12 h-12 animate-spin ${isDark ? 'text-neutral-300' : 'text-stone-600'
                  }`} />
              ) : (
                <p className={`text-5xl font-bold ${isDark ? 'text-neutral-300' : 'text-stone-600'
                  }`}>
                  {hoursTranscribed.toFixed(1)}
                </p>
              )}
            </CardContent>
          </Card>

          <Card
            className={`shadow-lg border transition-all duration-300 ease-in-out hover:scale-105 cursor-pointer ${isDark
              ? 'bg-neutral-800 border-neutral-700'
              : 'bg-stone-100 border-stone-200'
              }`}
            onClick={handleNavigateToList}
          >
            <CardHeader>
              <h3 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-stone-900'
                }`}>
                Pending Transcripts
              </h3>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Loader2 className={`w-12 h-12 animate-spin ${isDark ? 'text-neutral-300' : 'text-stone-600'
                  }`} />
              ) : (
                <p className={`text-5xl font-bold ${isDark ? 'text-neutral-300' : 'text-stone-600'
                  }`}>
                  {pendingTranscriptions}
                </p>
              )}
            </CardContent>
          </Card>

          <Card
            className={`shadow-lg border transition-all duration-300 ease-in-out hover:scale-105 cursor-pointer ${isDark
              ? 'bg-neutral-800 border-neutral-700'
              : 'bg-stone-100 border-stone-200'
              }`}
            onClick={handleNavigateToList}
          >
            <CardHeader>
              <h3 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-stone-900'
                }`}>
                Completed Transcriptions
              </h3>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Loader2 className={`w-12 h-12 animate-spin ${isDark ? 'text-neutral-300' : 'text-stone-600'
                  }`} />
              ) : (
                <p className={`text-5xl font-bold ${isDark ? 'text-neutral-300' : 'text-stone-600'
                  }`}>
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
              className={`text-white hover:scale-105 transition-all duration-300 ease-in-out ${isDark
                ? 'bg-neutral-700 hover:bg-neutral-600'
                : 'bg-stone-600 hover:bg-stone-700'
                }`}
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload File
            </Button>

            <Button
              onClick={handleNavigateToList}
              variant="outline"
              className={`border hover:scale-105 transition-all duration-300 ease-in-out ${isDark
                ? 'bg-neutral-800 hover:bg-neutral-700 border-neutral-600 text-neutral-200'
                : 'bg-stone-100 hover:bg-stone-200 border-stone-300 text-stone-700'
                }`}
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