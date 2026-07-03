'use client'
import * as React from "react";
const { useState, useEffect } = React;
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, List, Moon, Sun, Loader2 } from "lucide-react";
import { QDRANT_URL } from "@/config";

// Theme Toggle Component
function ThemeToggle() {
  const [theme, setTheme] = useState('light');
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
      className="transition-all duration-300 ease-in-out hover:scale-110"
    >
      {theme === "light" ? (
        <Moon className="h-5 w-5 transition-all duration-300 ease-in-out" />
      ) : (
        <Sun className="h-5 w-5 transition-all duration-300 ease-in-out text-neutral-400" />
      )}
    </Button>
  );
}

// Main Component
export default function TranscriptionApp() {
  const [hoursTranscribed, setHoursTranscribed] = useState(0);
  const [pendingTranscriptions, setPendingTranscriptions] = useState(0);
  const [completedTranscriptions, setCompletedTranscriptions] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState('light');

  // Fetch stats directly from Qdrant
  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true);
        setError(null);



        // Check if collection exists
        const collectionsResponse = await fetch(`${QDRANT_URL}/collections`);

        if (!collectionsResponse.ok) {
          throw new Error(`Cannot connect to Qdrant at ${QDRANT_URL}`);
        }

        const collectionsData = await collectionsResponse.json();
        const collections = collectionsData.result?.collections || [];

        const collectionExists = collections.some((c: any) => c.name === 'file_metadata');

        if (!collectionExists) {
          throw new Error('Collection "file_metadata" not found');
        }

        // Fetch all parent transcripts
        const response = await fetch(`${QDRANT_URL}/collections/file_metadata/points/scroll`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            limit: 1000,
            with_payload: true,
            with_vector: false,
            filter: {
              must: [
                {
                  key: "type",
                  match: {
                    value: "parent"
                  }
                }
              ]
            }
          })
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch data: ${response.status}`);
        }

        const data = await response.json();
        const parentPoints = data.result.points.filter((point: any) => point.payload.type === 'parent');

        // Fetch ALL segments in one query for better performance
        const allSegmentsResponse = await fetch(`${QDRANT_URL}/collections/file_metadata/points/scroll`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            limit: 10000, // Fetch many segments at once
            with_payload: true,
            with_vector: false,
            filter: {
              must: [
                {
                  key: "type",
                  match: {
                    value: "segment"
                  }
                }
              ]
            }
          })
        });

        // Group segments by parent_job_id and find max end_time for each
        const segmentDurations = new Map();

        if (allSegmentsResponse.ok) {
          const allSegmentsData = await allSegmentsResponse.json();

          for (const segment of allSegmentsData.result.points) {
            const parentJobId = segment.payload.parent_job_id;
            const endTime = segment.payload.end_time || 0;

            if (!segmentDurations.has(parentJobId) || segmentDurations.get(parentJobId) < endTime) {
              segmentDurations.set(parentJobId, endTime);
            }
          }
        }

        // Calculate stats using pre-fetched segment durations
        let completed = 0;
        let processing = 0;
        let uploaded = 0;
        let errorCount = 0;
        let totalDuration = 0;

        for (const point of parentPoints) {
          const status = point.payload.status || 'unknown';
          const jobId = point.payload.job_id;

          // Get duration from pre-fetched segments
          const calculatedDuration = segmentDurations.get(jobId) || 0;

          totalDuration += calculatedDuration;

          switch (status) {
            case 'completed':
            case 'transcribed':
              completed++;
              break;
            case 'processing':
              processing++;
              break;
            case 'uploaded':
              uploaded++;
              break;
            case 'error':
              errorCount++;
              break;
          }
        }

        // Update state
        const totalHours = totalDuration / 3600; // Convert seconds to hours

        setHoursTranscribed(totalHours);
        setPendingTranscriptions(processing + uploaded);
        setCompletedTranscriptions(completed);

        console.log('Stats loaded:', {
          totalHours: totalHours.toFixed(2),
          completed,
          pending: processing + uploaded,
          total: parentPoints.length
        });

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
  }, []);

  const handleNavigateToList = () => {
    window.location.href = "/Transcripts/List";
  };

  const handleNavigateToUpload = () => {
    window.location.href = "/Transcripts";
  };

  const isDark = theme === 'dark';

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
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            className="transition-all duration-300 ease-in-out hover:scale-110"
          >
            {theme === "light" ? (
              <Moon className="h-5 w-5 transition-all duration-300 ease-in-out text-stone-700" />
            ) : (
              <Sun className="h-5 w-5 transition-all duration-300 ease-in-out text-neutral-400" />
            )}
          </Button>
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