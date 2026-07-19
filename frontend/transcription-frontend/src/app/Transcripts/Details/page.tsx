'use client'
import { Suspense } from 'react'
import * as React from "react";
const { useState, useEffect, useRef } = React;
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { BACKEND_URL } from "@/config";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch, ApiError } from "@/lib/api";
import { AdminMenu } from "@/components/AdminMenu";
import {
  ArrowLeft,
  Download,
  Clock,
  Users,
  FileAudio,
  Moon,
  Sun,
  Play,
  Pause,
  Calendar,
  Hash,
  FileText,
  StickyNote,
  AlertCircle,
  Loader2,
  Check,
  Sparkles,
  FileDown,
  Pencil,
  X
} from "lucide-react";
import { useTheme } from "next-themes";
import PdfExportModal from "@/components/PdfExportModal";
import { generateTranscriptPdf } from "@/lib/pdfGenerator";
import type { PdfAnalysisData } from "@/lib/pdfGenerator";
import { exportTranscript, type PlainExportFormat } from "@/lib/exportFormats";

export default function TranscriptDetails() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-stone-200 dark:bg-neutral-900 animate-pulse" />}>
      <TranscriptDetailsPage />
    </Suspense>
  );
}

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
      className="transition-all duration-500 ease-in-out hover:scale-110"
    >
      {theme === "light" ? (
        <Moon className="h-5 w-5 transition-all duration-500 ease-in-out" />
      ) : (
        <Sun className="h-5 w-5 transition-all duration-500 ease-in-out" />
      )}
    </Button>
  );
}

interface Segment {
  id: string;
  segment_index: number;
  speaker: string;
  speaker_display_name: string;
  start_time: number;
  end_time: number;
  minio_url: string;
  transcript_text: string;
  embedding_generated: boolean;
  timestamp: string;
  status: string;
  point_id?: string | number;
}

interface RelatedTranscript {
  job_id: string;
  filename: string;
  reference_number: string;
  match_reasons: string[];
}

interface ParentTranscript {
  job_id: string;
  filename: string;
  category: string;
  reference_number: string;
  notes: string;
  minio_url: string;
  status: string;
  timestamp: string;
  speakers: number;
  local_path?: string;
}

function TranscriptDetailsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const jobId = searchParams.get('job_id');
  const { authFetch, isAuthenticated, isLoading: authLoading } = useAuth();

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push("/login");
    }
  }, [authLoading, isAuthenticated, router]);

  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [parent, setParent] = useState<ParentTranscript | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [playingSegment, setPlayingSegment] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState<string | null>(null);
  const [audioProgress, setAudioProgress] = useState<{ [key: string]: number }>({});

  const [editedTexts, setEditedTexts] = useState<{ [key: string]: string }>({});
  const [savingSegments, setSavingSegments] = useState<Set<string>>(new Set());
  const [savedSegments, setSavedSegments] = useState<Set<string>>(new Set());
  const saveTimeouts = useRef<{ [key: string]: NodeJS.Timeout }>({});
  const saveLocks = useRef<Set<string>>(new Set());

  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'segmented' | 'paragraph'>('segmented');
  const [exportLoading, setExportLoading] = useState(false);
  const [analysisPdfData, setAnalysisPdfData] = useState<PdfAnalysisData | null>(null);

  const [relatedTranscripts, setRelatedTranscripts] = useState<RelatedTranscript[]>([]);

  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [speakerNameInput, setSpeakerNameInput] = useState('');
  const [renamingSpeaker, setRenamingSpeaker] = useState(false);

  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  const handlePlainExport = (format: PlainExportFormat) => {
    if (!parent) return;
    exportTranscript(
      format,
      segments.map(s => ({ ...s, transcript_text: editedTexts[s.id] || s.transcript_text })),
      parent.filename
    );
    setExportMenuOpen(false);
  };

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const audioObjectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    setMounted(true);
    if (authLoading) return;
    if (!jobId) {
      setError('No job ID provided');
      setLoading(false);
      return;
    }
    if (isAuthenticated) {
      fetchTranscriptData();
    }
  }, [jobId, isAuthenticated, authLoading]);

  useEffect(() => {
    if (!isAuthenticated || !jobId) return;
    apiFetch<RelatedTranscript[]>(authFetch, `${BACKEND_URL}/transcripts/${jobId}/related`)
      .then(data => setRelatedTranscripts(data ?? []))
      .catch(() => setRelatedTranscripts([])); // non-critical — just don't show the section
  }, [isAuthenticated, jobId, authFetch]);

  // Poll quietly while the pipeline hasn't finished, so convert -> diarize
  // -> transcribe progress shows up without a manual reload. "transcribed"
  // is the only reliably-set terminal status the pipeline actually uses
  // (see gradio/transcription/transcription.py) — anything else is worth
  // continuing to check.
  useEffect(() => {
    if (!isAuthenticated || !jobId || !parent) return;
    if (parent.status === 'transcribed' || parent.status === 'error') return;

    const interval = setInterval(() => {
      fetchTranscriptData({ background: true });
    }, 5000);
    return () => clearInterval(interval);
  }, [isAuthenticated, jobId, parent?.status]);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
      if (audioObjectUrlRef.current) {
        URL.revokeObjectURL(audioObjectUrlRef.current);
        audioObjectUrlRef.current = null;
      }
      Object.values(saveTimeouts.current).forEach(timeout => clearTimeout(timeout));
    };
  }, []);

  const fetchTranscriptData = async (opts: { background?: boolean } = {}) => {
    try {
      if (!opts.background) {
        setLoading(true);
        setError(null);
      }

      const parentPayload = await apiFetch<any>(authFetch, `${BACKEND_URL}/transcripts/${jobId}`);

      setParent({
        job_id: parentPayload.id,
        filename: parentPayload.filename,
        category: parentPayload.category || 'Uncategorized',
        reference_number: parentPayload.reference_number || 'N/A',
        notes: parentPayload.notes || '',
        minio_url: parentPayload.minio_url || '',
        status: parentPayload.status || 'unknown',
        timestamp: parentPayload.timestamp,
        speakers: parentPayload.speakers || 0,
        local_path: parentPayload.local_path
      });

      if (parentPayload.analysis_status === "complete") {
        setAnalysisPdfData({
          summary: parentPayload.analysis_summary || "",
          keywords: parentPayload.analysis_keywords || [],
          entities: parentPayload.analysis_entities || { persons: [], locations: [], organizations: [], events: [] },
          classification: parentPayload.analysis_classification || "",
        });
      }

      const segmentPoints = await apiFetch<any[]>(authFetch, `${BACKEND_URL}/transcripts/${jobId}/segments`);

      const transformedSegments: Segment[] = (segmentPoints ?? []).map((s: any) => ({
        id: `segment-${s.segment_index}`,
        point_id: `segment-${s.segment_index}`,
        segment_index: s.segment_index,
        speaker: s.speaker,
        speaker_display_name: s.speaker_display_name || '',
        start_time: s.start_time,
        end_time: s.end_time,
        minio_url: '', // no longer used directly — playback fetches the audio endpoint as a blob
        transcript_text: s.transcript_text || 'Transcription pending...',
        embedding_generated: s.embedding_generated,
        timestamp: s.timestamp,
        status: s.status || 'unknown'
      }));

      setSegments(transformedSegments);

      // On a background poll, don't clobber text the user may be actively
      // editing in a segment that already finished transcribing while
      // others are still in progress — only fill in segments we haven't
      // seen text for yet.
      setEditedTexts(prev => {
        const next = opts.background ? { ...prev } : {};
        transformedSegments.forEach((seg: Segment) => {
          if (!(seg.id in next)) {
            next[seg.id] = seg.transcript_text;
          }
        });
        return next;
      });

    } catch (err) {
      if (opts.background) return; // a failed background poll shouldn't disrupt the visible page
      console.error("Failed to fetch transcript data:", err);
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to load transcript');
    } finally {
      if (!opts.background) {
        setLoading(false);
      }
    }
  };

  const handleTextChange = (segmentId: string, newText: string) => {
    setEditedTexts(prev => ({
      ...prev,
      [segmentId]: newText
    }));

    if (saveTimeouts.current[segmentId]) {
      clearTimeout(saveTimeouts.current[segmentId]);
    }

    setSavedSegments(prev => {
      const newSet = new Set(prev);
      newSet.delete(segmentId);
      return newSet;
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, segmentId: string) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();

      if (saveTimeouts.current[segmentId]) {
        clearTimeout(saveTimeouts.current[segmentId]);
      }

      const currentText = editedTexts[segmentId];
      if (currentText !== undefined) {
        saveTranscript(segmentId, currentText);
      }
    }
  };

  const saveTranscript = async (segmentId: string, newText: string) => {
    if (saveLocks.current.has(segmentId)) {
      console.log('Save already in progress for segment:', segmentId);
      return;
    }

    const segment = segments.find(s => s.id === segmentId);
    if (!segment) {
      console.error('Segment not found:', { segmentId });
      return;
    }

    if (newText.trim() === segment.transcript_text.trim()) {
      console.log('Text unchanged, skipping save');
      return;
    }

    try {
      saveLocks.current.add(segmentId);
      setSavingSegments(prev => new Set(prev).add(segmentId));

      await apiFetch(
        authFetch,
        `${BACKEND_URL}/transcripts/${jobId}/segments/${segment.segment_index}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript_text: newText.trim() }),
        }
      );

      setSegments(prevSegments =>
        prevSegments.map(s =>
          s.id === segmentId ? { ...s, transcript_text: newText.trim() } : s
        )
      );

      setSavedSegments(prev => new Set(prev).add(segmentId));
      setTimeout(() => {
        setSavedSegments(prev => {
          const newSet = new Set(prev);
          newSet.delete(segmentId);
          return newSet;
        });
      }, 2000);

    } catch (err) {
      console.error('Failed to save transcript:', err);
      alert(`Failed to save changes: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      saveLocks.current.delete(segmentId);
      setSavingSegments(prev => {
        const newSet = new Set(prev);
        newSet.delete(segmentId);
        return newSet;
      });
    }
  };

  const handleRenameSpeaker = async (speakerLabel: string) => {
    const displayName = speakerNameInput.trim();
    if (!displayName) return;

    try {
      setRenamingSpeaker(true);
      // Diarization assigns the same raw label (e.g. "SPEAKER_00") to every
      // segment from that speaker, so one rename call applies to all of
      // them at once — reflect that locally instead of refetching.
      await apiFetch(
        authFetch,
        `${BACKEND_URL}/transcripts/${jobId}/speakers/${encodeURIComponent(speakerLabel)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ display_name: displayName }),
        }
      );

      setSegments(prev =>
        prev.map(s => (s.speaker === speakerLabel ? { ...s, speaker_display_name: displayName } : s))
      );
      setEditingSpeaker(null);
      setSpeakerNameInput('');
    } catch (err) {
      alert(`Failed to rename speaker: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setRenamingSpeaker(false);
    }
  };

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    if (audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = null;
    }
  };

  const handlePlayPause = async (segment: Segment) => {
    if (playingSegment === segment.id) {
      stopAudio();
      setPlayingSegment(null);
      setAudioProgress({});
      return;
    }

    stopAudio();
    setAudioProgress({});

    try {
      setAudioLoading(segment.id);
      setAudioProgress({ [segment.id]: 0 });

      // The segment audio is encrypted at rest (SSE-C) and can no longer be
      // handed out as a presigned URL — the backend streams the decrypted
      // bytes directly, so we fetch them as a blob and play from an object
      // URL instead of pointing <audio> at a remote URL.
      const response = await authFetch(
        `${BACKEND_URL}/transcripts/${jobId}/segments/${segment.segment_index}/audio`
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load audio (${response.status})`);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      audioObjectUrlRef.current = objectUrl;

      const audio = new Audio();
      audio.src = objectUrl;
      audioRef.current = audio;

      const segmentDuration = segment.end_time - segment.start_time;

      audio.addEventListener('loadeddata', () => {
        if (audioRef.current) {
          audioRef.current.currentTime = segment.start_time;
        }

        setAudioLoading(null);
        setPlayingSegment(segment.id);

        progressIntervalRef.current = setInterval(() => {
          if (audioRef.current && !audioRef.current.paused) {
            const elapsed = audioRef.current.currentTime - segment.start_time;
            const progress = Math.min((elapsed / segmentDuration) * 100, 100);
            setAudioProgress({ [segment.id]: progress });

            if (audioRef.current.currentTime >= segment.end_time) {
              audioRef.current.pause();
              setPlayingSegment(null);
              if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
              }
              setAudioProgress({});
            }
          }
        }, 100);
      });

      audio.addEventListener('ended', () => {
        setPlayingSegment(null);
        stopAudio();
        setAudioProgress({});
      });

      audio.addEventListener('error', (e) => {
        const target = e.target as HTMLAudioElement;
        let errorMessage = 'Unknown error';

        if (target.error) {
          switch (target.error.code) {
            case MediaError.MEDIA_ERR_ABORTED:
              errorMessage = 'Audio playback aborted';
              break;
            case MediaError.MEDIA_ERR_NETWORK:
              errorMessage = 'Network error while loading audio';
              break;
            case MediaError.MEDIA_ERR_DECODE:
              errorMessage = 'Audio decoding error';
              break;
            case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
              errorMessage = 'Audio format not supported or URL not accessible';
              break;
          }
        }

        console.error('Audio playback error:', errorMessage);
        alert(`Cannot play audio: ${errorMessage}`);

        setAudioLoading(null);
        setPlayingSegment(null);
        stopAudio();
        setAudioProgress({});
      });

      audio.load();
      await audio.play();

    } catch (error) {
      console.error('Failed to play audio:', error);
      alert(`Failed to play audio: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setAudioLoading(null);
      setPlayingSegment(null);
      stopAudio();
      setAudioProgress({});
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
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

  const getTotalDuration = () => {
    if (segments.length === 0) return "0:00";
    const lastSegment = segments[segments.length - 1];
    return formatTime(lastSegment.end_time);
  };

  const getSpeakerCount = () => {
    if (parent?.speakers) {
      return Math.floor(parent.speakers);
    }
    const speakers = new Set(segments.map(s => s.speaker));
    return speakers.size;
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

  const handleDownload = async () => {
    if (!jobId) return;
    try {
      // Encrypted at rest (SSE-C) — the backend streams the decrypted file
      // directly rather than handing out a presigned URL, so fetch it as a
      // blob and trigger the download client-side.
      const response = await authFetch(`${BACKEND_URL}/files/${jobId}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Failed to download (${response.status})`);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = parent?.filename || "download";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      console.error('Failed to download file:', err);
      alert(err instanceof Error ? err.message : 'Failed to prepare download');
    }
  };

  const handleGeneratePdf = async (format: 'segmented' | 'paragraph') => {
    if (!parent) return;
    setExportLoading(true);
    try {
      await generateTranscriptPdf({
        parent: {
          filename: parent.filename,
          reference_number: parent.reference_number,
          category: parent.category,
          status: parent.status,
          timestamp: parent.timestamp,
        },
        segments: segments.map(s => ({
          speaker: s.speaker,
          start_time: s.start_time,
          end_time: s.end_time,
          transcript_text: editedTexts[s.id] || s.transcript_text,
          segment_index: s.segment_index,
        })),
        format,
        analysisData: analysisPdfData,
      });
      setExportModalOpen(false);
    } finally {
      setExportLoading(false);
    }
  };

  if (!mounted || loading) {
    return (
      <div className="min-h-screen bg-stone-200 dark:bg-neutral-900 animate-pulse">
        <header className="backdrop-blur-sm shadow-md dark:shadow-lg">
          <div className="max-w-8xl mx-auto pl-2 pr-6 py-4 flex items-center justify-between gap-2">
            <div className="h-8 w-48 bg-stone-300 dark:bg-neutral-700 rounded"></div>
            <div className="h-10 w-10 bg-stone-300 dark:bg-neutral-700 rounded"></div>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-6 py-6">
          <div className="h-64 bg-stone-300 dark:bg-neutral-700 rounded-lg mb-6"></div>
          <div className="h-96 bg-stone-300 dark:bg-neutral-700 rounded-lg"></div>
        </main>
      </div>
    );
  }

  if (error || !parent) {
    return (
      <div className="min-h-screen bg-stone-200 dark:bg-neutral-900">
        <header className="backdrop-blur-sm shadow-md dark:shadow-lg">
          <div className="max-w-8xl mx-auto pl-2 pr-6 py-4 flex items-center justify-between gap-2">
            <h1 className="text-2xl font-bold text-neutral-700 dark:text-white">
              Transcription App
            </h1>
            <div className="flex items-center gap-1">
              <AdminMenu />
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-6 py-6">
          <Card className="shadow-xl bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 mb-6">
            <CardContent className="p-12 text-center">
              <AlertCircle className="w-16 h-16 mx-auto mb-4 text-red-600 dark:text-red-400" />
              <p className="text-xl text-red-800 dark:text-red-200 font-medium mb-2">
                {error || 'Transcript not found'}
              </p>
              <Button
                onClick={() => router.push('/Transcripts/List')}
                className="mt-4 bg-stone-600 hover:bg-stone-700 dark:bg-neutral-700 dark:hover:bg-neutral-600"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to List
              </Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-200 dark:bg-neutral-900 transition-all duration-500 ease-in-out">
      <header className="backdrop-blur-sm shadow-md dark:shadow-lg transition-all duration-500 ease-in-out relative z-10">
        <div className="max-w-8xl mx-auto pl-2 pr-6 py-4 flex items-center justify-between gap-2">
          <h1
            className="text-2xl font-bold text-neutral-700 dark:text-white transition-colors duration-500 ease-in-out cursor-pointer hover:text-neutral-900 dark:hover:text-neutral-200"
            onClick={() => router.push('/')}
          >
            Transcription App
          </h1>
          <div className="flex items-center gap-1">
            <AdminMenu />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 transition-all duration-500 ease-in-out">
        <Button
          onClick={() => router.push('/Transcripts/List')}
          variant="ghost"
          className="mb-6 text-stone-700 dark:text-neutral-300 hover:text-stone-900 dark:hover:text-white transition-all duration-300 hover:scale-105"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Transcripts
        </Button>

        <Card className="shadow-xl bg-stone-100 dark:bg-neutral-800 border-stone-200 dark:border-neutral-700 mb-6 transition-all duration-500 ease-in-out">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <CardTitle className="text-2xl text-neutral-900 dark:text-white mb-2">
                  {parent.filename}
                </CardTitle>
                <Badge className={`${getStatusColor(parent.status)} font-medium flex items-center gap-1 w-fit`}>
                  {parent.status !== 'transcribed' && parent.status !== 'error' && (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  )}
                  {parent.status.toUpperCase()}
                </Badge>
                {parent.status !== 'transcribed' && parent.status !== 'error' && segments.length > 0 && (() => {
                  const done = segments.filter(s => s.status === 'transcribed').length;
                  const pct = Math.round((done / segments.length) * 100);
                  return (
                    <div className="mt-3 max-w-xs">
                      <div className="flex justify-between text-xs text-stone-500 dark:text-neutral-400 mb-1">
                        <span>{done} of {segments.length} segments transcribed</span>
                        <span>{pct}%</span>
                      </div>
                      <div className="w-full bg-stone-200 dark:bg-neutral-700 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-stone-600 dark:bg-neutral-400 h-full transition-all duration-500 ease-out"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })()}
              </div>
              <div className="flex items-center gap-2">
                {parent.status === "transcribed" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => router.push(`/Transcripts/Analysis?job_id=${jobId}`)}
                    className="bg-stone-50 hover:bg-stone-200 dark:bg-neutral-700 dark:hover:bg-neutral-600 transition-all duration-300 hover:scale-105"
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    Analyse
                  </Button>
                )}
                {segments.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setExportModalOpen(true)}
                    className="bg-stone-50 hover:bg-stone-200 dark:bg-neutral-700 dark:hover:bg-neutral-600 transition-all duration-300 hover:scale-105"
                  >
                    <FileDown className="w-4 h-4 mr-2" />
                    Export PDF
                  </Button>
                )}
                {segments.length > 0 && (
                  <div className="relative">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setExportMenuOpen(prev => !prev)}
                      className="bg-stone-50 hover:bg-stone-200 dark:bg-neutral-700 dark:hover:bg-neutral-600 transition-all duration-300 hover:scale-105"
                    >
                      <FileDown className="w-4 h-4 mr-2" />
                      Export...
                    </Button>
                    {exportMenuOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setExportMenuOpen(false)} />
                        <div className="absolute right-0 mt-1 w-40 rounded-lg border border-stone-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-lg z-20 overflow-hidden">
                          {(["srt", "vtt", "txt", "csv"] as PlainExportFormat[]).map(fmt => (
                            <button
                              key={fmt}
                              onClick={() => handlePlainExport(fmt)}
                              className="w-full text-left px-4 py-2 text-sm text-stone-700 dark:text-neutral-200 hover:bg-stone-100 dark:hover:bg-neutral-700 uppercase"
                            >
                              {fmt}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownload}
                  disabled={!parent.minio_url}
                  className="bg-stone-50 hover:bg-stone-200 dark:bg-neutral-700 dark:hover:bg-neutral-600 transition-all duration-300 hover:scale-105 disabled:opacity-50"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <div className="flex items-center gap-3 p-4 bg-stone-50 dark:bg-neutral-700/50 rounded-lg transition-all duration-300 hover:scale-105">
                <FileText className="w-5 h-5 text-stone-600 dark:text-neutral-400" />
                <div>
                  <p className="text-xs text-stone-500 dark:text-neutral-400">Category</p>
                  <p className="font-semibold text-stone-900 dark:text-white">
                    {parent.category}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 p-4 bg-stone-50 dark:bg-neutral-700/50 rounded-lg transition-all duration-300 hover:scale-105">
                <Hash className="w-5 h-5 text-stone-600 dark:text-neutral-400" />
                <div>
                  <p className="text-xs text-stone-500 dark:text-neutral-400">Reference</p>
                  <p className="font-semibold text-stone-900 dark:text-white">
                    {parent.reference_number}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 p-4 bg-stone-50 dark:bg-neutral-700/50 rounded-lg transition-all duration-300 hover:scale-105">
                <Clock className="w-5 h-5 text-stone-600 dark:text-neutral-400" />
                <div>
                  <p className="text-xs text-stone-500 dark:text-neutral-400">Duration</p>
                  <p className="font-semibold text-stone-900 dark:text-white">
                    {getTotalDuration()}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 p-4 bg-stone-50 dark:bg-neutral-700/50 rounded-lg transition-all duration-300 hover:scale-105">
                <Users className="w-5 h-5 text-stone-600 dark:text-neutral-400" />
                <div>
                  <p className="text-xs text-stone-500 dark:text-neutral-400">Speakers</p>
                  <p className="font-semibold text-stone-900 dark:text-white">
                    {getSpeakerCount()}
                  </p>
                </div>
              </div>
            </div>

            {parent.notes && (
              <div className="p-4 bg-stone-50 dark:bg-neutral-700/50 rounded-lg">
                <div className="flex items-start gap-2 mb-2">
                  <StickyNote className="w-4 h-4 text-stone-600 dark:text-neutral-400 mt-0.5" />
                  <p className="text-xs font-semibold text-stone-500 dark:text-neutral-400">NOTES</p>
                </div>
                <p className="text-stone-900 dark:text-white">
                  {parent.notes}
                </p>
              </div>
            )}

            <div className="mt-4 flex items-center gap-2 text-xs text-stone-500 dark:text-neutral-400">
              <Calendar className="w-4 h-4" />
              <span>Uploaded: {formatDate(parent.timestamp)}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-xl bg-stone-100 dark:bg-neutral-800 border-stone-200 dark:border-neutral-700 transition-all duration-500 ease-in-out">
          <CardHeader>
            <CardTitle className="text-xl text-neutral-900 dark:text-white flex items-center gap-2">
              <FileAudio className="w-5 h-5" />
              Transcript Segments ({segments.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {segments.length === 0 ? (
              <div className="text-center py-12">
                <FileAudio className="w-16 h-16 mx-auto mb-4 text-stone-400 dark:text-neutral-500" />
                <p className="text-stone-600 dark:text-neutral-400">
                  No segments available yet
                </p>
                <p className="text-sm text-stone-500 dark:text-neutral-500 mt-2">
                  Segments will appear here once processing is complete
                </p>
              </div>
            ) : (
              segments.map((segment) => {
                const isPlaying = playingSegment === segment.id;
                const isLoading = audioLoading === segment.id;
                const isSaving = savingSegments.has(segment.id);
                const isSaved = savedSegments.has(segment.id);

                return (
                  <div
                    key={segment.id}
                    className="border border-stone-200 dark:border-neutral-700 rounded-lg bg-stone-50 dark:bg-neutral-700/50 transition-all duration-300 hover:shadow-md"
                  >
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <Badge className="bg-stone-600 dark:bg-neutral-600 text-white">
                              #{segment.segment_index}
                            </Badge>
                            {editingSpeaker === segment.speaker ? (
                              <div className="flex items-center gap-1">
                                <input
                                  autoFocus
                                  value={speakerNameInput}
                                  onChange={(e) => setSpeakerNameInput(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      handleRenameSpeaker(segment.speaker);
                                    } else if (e.key === 'Escape') {
                                      setEditingSpeaker(null);
                                      setSpeakerNameInput('');
                                    }
                                  }}
                                  placeholder={segment.speaker}
                                  className="text-sm font-semibold bg-white dark:bg-neutral-800 border border-stone-300 dark:border-neutral-600 rounded px-2 py-0.5 w-32"
                                />
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6"
                                  disabled={renamingSpeaker}
                                  onClick={() => handleRenameSpeaker(segment.speaker)}
                                >
                                  <Check className="w-3 h-3" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6"
                                  onClick={() => {
                                    setEditingSpeaker(null);
                                    setSpeakerNameInput('');
                                  }}
                                >
                                  <X className="w-3 h-3" />
                                </Button>
                              </div>
                            ) : (
                              <span
                                className="font-semibold text-stone-900 dark:text-white group inline-flex items-center gap-1 cursor-pointer"
                                onClick={() => {
                                  setEditingSpeaker(segment.speaker);
                                  setSpeakerNameInput(segment.speaker_display_name || '');
                                }}
                                title="Click to rename speaker"
                              >
                                {segment.speaker_display_name || segment.speaker}
                                <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-50" />
                              </span>
                            )}
                            <span className="text-sm text-stone-500 dark:text-neutral-400">
                              {formatTime(segment.start_time)} - {formatTime(segment.end_time)}
                            </span>
                            {isSaving && (
                              <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                Saving...
                              </Badge>
                            )}
                            {isSaved && (
                              <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 animate-pulse">
                                <Check className="w-3 h-3 mr-1" />
                                Saved
                              </Badge>
                            )}
                          </div>

                          {isPlaying && (
                            <div className="mb-2 w-full bg-stone-200 dark:bg-neutral-600 rounded-full h-1.5 overflow-hidden">
                              <div
                                className="bg-stone-600 dark:bg-neutral-400 h-full transition-all duration-100 ease-linear"
                                style={{
                                  width: `${audioProgress[segment.id] || 0}%`
                                }}
                              />
                            </div>
                          )}

                          <Textarea
                            value={editedTexts[segment.id] || segment.transcript_text}
                            onChange={(e) => handleTextChange(segment.id, e.target.value)}
                            onKeyDown={(e) => handleKeyDown(e, segment.id)}
                            className="w-full min-h-[80px] text-stone-800 dark:text-neutral-200 text-right font-faruma resize-y bg-white dark:bg-neutral-800 border-stone-300 dark:border-neutral-600 focus:border-stone-500 dark:focus:border-neutral-400 focus:ring-1 focus:ring-stone-500 dark:focus:ring-neutral-400 transition-all"
                            placeholder="Edit transcript... (Press Enter to save, Shift+Enter for new line)"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handlePlayPause(segment)}
                            disabled={isLoading}
                            className="text-stone-600 hover:text-stone-900 dark:text-neutral-400 dark:hover:text-white transition-all duration-300 hover:scale-110 disabled:opacity-50"
                          >
                            {isLoading ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : isPlaying ? (
                              <Pause className="w-4 h-4" />
                            ) : (
                              <Play className="w-4 h-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {relatedTranscripts.length > 0 && (
          <Card className="shadow-xl bg-stone-100 dark:bg-neutral-800 border-stone-200 dark:border-neutral-700 mt-6">
            <CardHeader>
              <CardTitle className="text-lg text-neutral-900 dark:text-white flex items-center gap-2">
                <Hash className="w-5 h-5" />
                Related Transcripts ({relatedTranscripts.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {relatedTranscripts.map((r) => (
                <div
                  key={r.job_id}
                  onClick={() => router.push(`/Transcripts/Details?job_id=${r.job_id}`)}
                  className="p-3 rounded-lg bg-stone-50 dark:bg-neutral-700/50 hover:bg-stone-200 dark:hover:bg-neutral-700 cursor-pointer transition-colors"
                >
                  <p className="font-medium text-stone-900 dark:text-white">{r.filename}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {r.match_reasons.map((reason, i) => (
                      <Badge
                        key={i}
                        className="bg-stone-200 text-stone-700 dark:bg-neutral-600 dark:text-neutral-200 text-xs"
                      >
                        {reason}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <PdfExportModal
          open={exportModalOpen}
          onClose={() => setExportModalOpen(false)}
          onGenerate={handleGeneratePdf}
          loading={exportLoading}
        />
      </main>
    </div>
  );
}
