'use client'
import * as React from "react";
const { useState, useEffect, useRef } = React;
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { BACKEND_URL } from "@/config";
import { useAuth } from "@/contexts/AuthContext";
import {
  Upload,
  Search,
  Clock,
  Users,
  FileAudio,
  Moon,
  Sun,
  Calendar,
  Hash,
  FileText,
  Filter,
  ChevronRight,
  AlertCircle,
  Trash2,
  Loader2
} from "lucide-react";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

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
      className="hover:scale-110"
    >
      {theme === "light" ? (
        <Moon className="h-5 w-5" />
      ) : (
        <Sun className="h-5 w-5" />
      )}
    </Button>
  );
}

interface Transcript {
  id: string;
  filename: string;
  category: string;
  reference_number: string;
  status: string;
  timestamp: string;
  duration: number;
  speakers: number;
  segments: number;
  notes: string;
}

export default function TranscriptList() {
  const router = useRouter();
  const { authFetch, token, isLoading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const fetchingRef = useRef(false);

  useEffect(() => {
    if (!authLoading && !token) {
      router.push("/login");
    }
  }, [authLoading, token, router]);

  useEffect(() => {
    if (token) {
      fetchTranscripts();
    }
  }, [token]);


  const fetchTranscripts = async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;

    try {
      setLoading(true);
      setError(null);

      const response = await authFetch(`${BACKEND_URL}/transcripts`);

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Failed to fetch transcripts: ${response.status}`);
      }

      const data = await response.json();
      const items = data ?? [];

      const transformed: Transcript[] = items.map((t: any) => ({
        id: t.id,
        filename: t.filename || 'Unknown',
        category: t.category || 'Uncategorized',
        reference_number: t.reference_number || 'N/A',
        status: t.status || 'unknown',
        timestamp: t.timestamp || new Date().toISOString(),
        duration: t.duration || 0,
        speakers: Math.floor(t.speakers || 0),
        segments: t.segments || 0,
        notes: t.notes || ''
      }));

      transformed.sort((a: Transcript, b: Transcript) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      setTranscripts(transformed);
    } catch (err) {
      console.error("Failed to fetch transcripts:", err);
      setError(err instanceof Error ? err.message : 'Failed to load transcripts');
    } finally {
      fetchingRef.current = false;
      setLoading(false);
    }
  };

  const handleDeleteTranscript = async (transcriptId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    if (deleteConfirm !== transcriptId) {
      setDeleteConfirm(transcriptId);
      setTimeout(() => setDeleteConfirm(null), 3000);
      return;
    }

    try {
      setDeletingIds(prev => new Set(prev).add(transcriptId));

      const response = await authFetch(`${BACKEND_URL}/transcripts/${transcriptId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Failed to delete transcript: ${response.status}`);
      }

      // Remove from local state
      setTranscripts(prev => prev.filter(t => t.id !== transcriptId));
      setDeleteConfirm(null);

    } catch (err) {
      console.error('Failed to delete transcript:', err);
      alert(`Failed to delete transcript: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setDeletingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(transcriptId);
        return newSet;
      });
    }
  };

  const formatTime = (seconds: number | string) => {
    let s = Number(seconds);

    if (isNaN(s) || s <= 0) return "0:00";

    const hours = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = Math.floor(s % 60);

    if (hours === 0) {
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDate = (timestamp: string) => {
    return new Date(timestamp).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'processing':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'uploaded':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'error':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
    }
  };

  const categories = ['all', ...new Set(transcripts.map(t => t.category))];
  const statuses = ['all', 'transcribed', 'processing', 'uploaded', 'error'];

  const filteredTranscripts = transcripts.filter(transcript => {
    const matchesSearch = transcript.filename.toLowerCase().includes(searchQuery.toLowerCase()) ||
      transcript.reference_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      transcript.notes.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = filterCategory === 'all' || transcript.category === filterCategory;
    const matchesStatus = filterStatus === 'all' || transcript.status === filterStatus;
    return matchesSearch && matchesCategory && matchesStatus;
  });

  const handleTranscriptClick = (transcriptId: string) => {
    router.push(`/Transcripts/Details?job_id=${transcriptId}`);
  };

  const handleNewTranscript = () => {
    router.push('/Transcripts');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-200 dark:bg-neutral-900 animate-pulse">
        <header className="backdrop-blur-sm shadow-md dark:shadow-lg">
          <div className="max-w-8xl mx-auto pl-2 pr-6 py-4 flex items-center justify-between gap-2">
            <div className="h-8 w-48 bg-stone-300 dark:bg-neutral-700 rounded"></div>
            <div className="h-10 w-10 bg-stone-300 dark:bg-neutral-700 rounded"></div>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-6 py-6">
          <div className="h-24 bg-stone-300 dark:bg-neutral-700 rounded-lg mb-6"></div>
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-32 bg-stone-300 dark:bg-neutral-700 rounded-lg"></div>
            ))}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-200 dark:bg-neutral-900">
      <header className="backdrop-blur-sm shadow-md dark:shadow-lg relative z-10">
        <div className="max-w-8xl mx-auto pl-2 pr-6 py-4 flex items-center justify-between gap-2">
          <h1
            className="text-2xl font-bold text-neutral-700 dark:text-white cursor-pointer hover:text-neutral-900 dark:hover:text-neutral-200"
            onClick={() => router.push('/')}
          >
            Transcription App
          </h1>
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-4xl font-bold text-neutral-700 dark:text-white mb-2">
              Transcripts
            </h2>
            <p className="text-stone-600 dark:text-neutral-400">
              Manage and view all your audio transcriptions
            </p>
          </div>
          <Button
            onClick={handleNewTranscript}
            className="bg-stone-600 hover:bg-stone-700 dark:bg-neutral-300 dark:hover:bg-neutral-400 hover:scale-105 hover:shadow-lg"
          >
            <Upload className="w-4 h-4 mr-2" />
            Upload New
          </Button>
        </div>

        {error && (
          <Card className="shadow-xl bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 mb-6">
            <CardContent className="p-4 flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
              <div>
                <p className="text-red-800 dark:text-red-200 font-medium">Failed to load transcripts</p>
                <p className="text-red-600 dark:text-red-300 text-sm">{error}</p>
              </div>
              <Button
                onClick={() => fetchTranscripts()}
                variant="outline"
                size="sm"
                className="ml-auto"
              >
                Retry
              </Button>
            </CardContent>
          </Card>
        )}

        <Card className="shadow-xl bg-stone-100 dark:bg-neutral-800 border-stone-200 dark:border-neutral-700 mb-6">
          <CardContent className="p-6">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-stone-500 dark:text-neutral-400" />
                <Input
                  type="text"
                  placeholder="Search transcripts..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 bg-stone-50 dark:bg-neutral-700/50 border-stone-300 dark:border-neutral-600 text-stone-900 dark:text-white placeholder:text-stone-500 dark:placeholder:text-neutral-400"
                />
              </div>
              <div className="flex gap-2">
                <div className="relative">
                  <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-stone-500 dark:text-neutral-400 pointer-events-none" />
                  <select
                    value={filterCategory}
                    onChange={(e) => setFilterCategory(e.target.value)}
                    className="pl-10 pr-8 py-2 bg-stone-50 dark:bg-neutral-700/50 border border-stone-300 dark:border-neutral-600 rounded-lg text-stone-900 dark:text-white appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-stone-500 dark:focus:ring-neutral-500"
                  >
                    {categories.map(cat => (
                      <option key={cat} value={cat}>
                        {cat === 'all' ? 'All Categories' : cat}
                      </option>
                    ))}
                  </select>
                </div>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="px-4 py-2 bg-stone-50 dark:bg-neutral-700/50 border border-stone-300 dark:border-neutral-600 rounded-lg text-stone-900 dark:text-white appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-stone-500 dark:focus:ring-neutral-500"
                >
                  {statuses.map(status => (
                    <option key={status} value={status}>
                      {status === 'all' ? 'All Status' : status.charAt(0).toUpperCase() + status.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {filteredTranscripts.length === 0 ? (
            <Card className="shadow-xl bg-stone-100 dark:bg-neutral-800 border-stone-200 dark:border-neutral-700">
              <CardContent className="p-12 text-center">
                <FileAudio className="w-16 h-16 mx-auto mb-4 text-stone-400 dark:text-neutral-500" />
                <p className="text-xl text-stone-600 dark:text-neutral-400 mb-2">
                  No transcripts found
                </p>
                <p className="text-sm text-stone-500 dark:text-neutral-500">
                  {transcripts.length === 0 ? 'Upload your first transcript to get started' : 'Try adjusting your search or filters'}
                </p>
              </CardContent>
            </Card>
          ) : (
            filteredTranscripts.map((transcript) => {
              const isDeleting = deletingIds.has(transcript.id);
              const needsConfirm = deleteConfirm === transcript.id;

              return (
                <Card
                  key={transcript.id}
                  className="shadow-xl bg-stone-100 dark:bg-neutral-800 border-stone-200 dark:border-neutral-700 hover:shadow-2xl hover:scale-[1.01] transition-all"
                >
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div
                        className="flex-1 cursor-pointer"
                        onClick={() => handleTranscriptClick(transcript.id)}
                      >
                        <div className="flex items-center gap-3 mb-3">
                          <FileAudio className="w-5 h-5 text-stone-600 dark:text-neutral-400" />
                          <h3 className="text-lg font-semibold text-neutral-900 dark:text-white">
                            {transcript.filename}
                          </h3>
                          <Badge className={`${getStatusColor(transcript.status)} font-medium`}>
                            {transcript.status.toUpperCase()}
                          </Badge>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
                          <div className="flex items-center gap-2">
                            <FileText className="w-4 h-4 text-stone-500 dark:text-neutral-400" />
                            <div>
                              <p className="text-xs text-stone-500 dark:text-neutral-400">Category</p>
                              <p className="text-sm font-medium text-stone-900 dark:text-white">
                                {transcript.category}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <Hash className="w-4 h-4 text-stone-500 dark:text-neutral-400" />
                            <div>
                              <p className="text-xs text-stone-500 dark:text-neutral-400">Reference</p>
                              <p className="text-sm font-medium text-stone-900 dark:text-white">
                                {transcript.reference_number}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <Clock className="w-4 h-4 text-stone-500 dark:text-neutral-400" />
                            <div>
                              <p className="text-xs text-stone-500 dark:text-neutral-400">Duration</p>
                              <p className="text-sm font-medium text-stone-900 dark:text-white">
                                {formatTime(transcript.duration)}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <Users className="w-4 h-4 text-stone-500 dark:text-neutral-400" />
                            <div>
                              <p className="text-xs text-stone-500 dark:text-neutral-400">Speakers</p>
                              <p className="text-sm font-medium text-stone-900 dark:text-white">
                                {transcript.speakers} ({transcript.segments} segments)
                              </p>
                            </div>
                          </div>
                        </div>

                        {transcript.notes && (
                          <p className="text-sm text-stone-600 dark:text-neutral-400 mb-2">
                            {transcript.notes}
                          </p>
                        )}

                        <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-neutral-400">
                          <Calendar className="w-3 h-3" />
                          <span>Uploaded: {formatDate(transcript.timestamp)}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => handleDeleteTranscript(transcript.id, e)}
                          disabled={isDeleting}
                          className={`${needsConfirm
                            ? 'text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20'
                            : 'text-stone-600 hover:text-stone-900 dark:text-neutral-400 dark:hover:text-white'
                            } transition-all hover:scale-110 disabled:opacity-50`}
                          title={needsConfirm ? 'Click again to confirm deletion' : 'Delete transcript'}
                        >
                          {isDeleting ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                          ) : (
                            <Trash2 className="w-5 h-5" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleTranscriptClick(transcript.id)}
                          className="text-stone-600 hover:text-stone-900 dark:text-neutral-400 dark:hover:text-white hover:scale-110"
                        >
                          <ChevronRight className="w-5 h-5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        <div className="mt-6 text-center text-sm text-stone-600 dark:text-neutral-400">
          Showing {filteredTranscripts.length} of {transcripts.length} transcripts
        </div>
      </main>
    </div>
  );
}