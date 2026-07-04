'use client'
import { Suspense } from 'react'
import * as React from "react";
const { useState, useEffect, useRef } = React;
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { QDRANT_URL, MINIO_URL, BACKEND_URL } from "@/config";
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
  FileDown
} from "lucide-react";
import { useTheme } from "next-themes";
import PdfExportModal from "@/components/PdfExportModal";
import { generateTranscriptPdf } from "@/lib/pdfGenerator";
import type { PdfAnalysisData } from "@/lib/pdfGenerator";

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
  start_time: number;
  end_time: number;
  minio_url: string;
  transcript_text: string;
  embedding_generated: boolean;
  timestamp: string;
  status: string;
  point_id?: string | number;
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

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setMounted(true);
    if (jobId) {
      fetchTranscriptData();
    } else {
      setError('No job ID provided');
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
      Object.values(saveTimeouts.current).forEach(timeout => clearTimeout(timeout));
    };
  }, []);

  const fetchTranscriptData = async () => {
    try {
      setLoading(true);
      setError(null);

      const parentResponse = await fetch(`${QDRANT_URL}/collections/file_metadata/points/scroll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filter: {
            must: [
              {
                key: "type",
                match: { value: "parent" }
              },
              {
                key: "job_id",
                match: { value: jobId }
              }
            ]
          },
          limit: 1,
          with_payload: true,
          with_vector: false
        })
      });

      if (!parentResponse.ok) {
        throw new Error('Failed to fetch parent transcript');
      }

      const parentData = await parentResponse.json();

      if (parentData.result.points.length === 0) {
        throw new Error('Transcript not found');
      }

      const parentPoint = parentData.result.points[0];
      const parentPayload = parentPoint.payload;

      setParent({
        job_id: parentPayload.job_id,
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

      let allSegments: any[] = [];
      let offset: string | number | null | undefined = undefined;
      let hasMore = true;
      let iterationCount = 0;
      const maxIterations = 50;

      while (hasMore && iterationCount < maxIterations) {
        iterationCount++;

        const requestBody: any = {
          filter: {
            must: [
              {
                key: "type",
                match: { value: "segment" }
              },
              {
                key: "parent_job_id",
                match: { value: jobId }
              }
            ]
          },
          limit: 100,
          with_payload: true,
          with_vector: false
        };

        if (offset !== undefined && offset !== null) {
          requestBody.offset = offset;
        }

        const segmentsResponse: Response = await fetch(`${QDRANT_URL}/collections/file_metadata/points/scroll`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody)
        });

        if (!segmentsResponse.ok) {
          throw new Error('Failed to fetch segments');
        }

        const responseText = await segmentsResponse.text();

        const segmentsData: any = JSON.parse(responseText);

        const newPoints = segmentsData.result.points || [];
        console.log(`Iteration ${iterationCount}: Fetched ${newPoints.length} segments`);

        if (newPoints.length === 0) {
          break;
        }

        allSegments = allSegments.concat(newPoints);

        const nextOffset = segmentsData.result.next_page_offset;

        if (nextOffset === null || nextOffset === undefined) {
          hasMore = false;
        } else if (nextOffset === offset) {
          console.warn('Offset not changing, breaking to prevent infinite loop');
          break;
        } else {
          offset = nextOffset;
        }
      }

      if (iterationCount >= maxIterations) {
        console.warn(`Reached maximum iterations (${maxIterations}), stopping fetch`);
      }

      console.log(`Total segments fetched: ${allSegments.length}`);

      const transformedSegments = allSegments
        .map((point: any) => ({
          id: `segment-${point.payload.segment_index}`,
          point_id: String(point.id),
          segment_index: point.payload.segment_index,
          speaker: point.payload.speaker,
          start_time: point.payload.start_time,
          end_time: point.payload.end_time,
          minio_url: point.payload.minio_url,
          transcript_text: point.payload.transcript_text || 'Transcription pending...',
          embedding_generated: point.payload.embedding_generated,
          timestamp: point.payload.timestamp,
          status: point.payload.status || 'unknown'
        }))
        .sort((a: Segment, b: Segment) => a.segment_index - b.segment_index);

      const uniqueSegments = transformedSegments;

      setSegments(uniqueSegments);

      const initialTexts: { [key: string]: string } = {};
      uniqueSegments.forEach((seg: Segment) => {
        initialTexts[seg.id] = seg.transcript_text;
      });
      setEditedTexts(initialTexts);

    } catch (err) {
      console.error("Failed to fetch transcript data:", err);
      setError(err instanceof Error ? err.message : 'Failed to load transcript');
    } finally {
      setLoading(false);
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

      console.log('Starting transcript update with filter:', {
        segmentId,
        segmentIndex: segment.segment_index,
        parentJobId: jobId
      });

      // Use filter-based update instead of point ID to avoid precision issues
      const updateResponse = await fetch(`${QDRANT_URL}/collections/file_metadata/points/payload?wait=true`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filter: {
            must: [
              { key: "type", match: { value: "segment" } },
              { key: "parent_job_id", match: { value: jobId } },
              { key: "segment_index", match: { value: segment.segment_index } }
            ]
          },
          payload: {
            transcript_text: newText.trim()
          }
        })
      });

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        console.error('Update response error:', errorText);
        throw new Error(`Failed to update payload: ${updateResponse.status}`);
      }

      const responseData = await updateResponse.json();
      console.log('Qdrant update successful:', responseData);

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

  const handlePlayPause = async (segment: Segment) => {
    if (playingSegment === segment.id) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
      setPlayingSegment(null);
      setAudioProgress({});
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
    }
    setAudioProgress({});

    if (!segment.minio_url) {
      console.error('No audio URL available for this segment');
      alert('No audio URL available for this segment');
      return;
    }

    try {
      setAudioLoading(segment.id);
      setAudioProgress({ [segment.id]: 0 });

      const accessibleUrl = segment.minio_url.replace('http://minio:9000', MINIO_URL);

      const audio = new Audio();
      audio.crossOrigin = "anonymous";
      audio.src = accessibleUrl;
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
        audioRef.current = null;
        if (progressIntervalRef.current) {
          clearInterval(progressIntervalRef.current);
        }
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
        audioRef.current = null;
        if (progressIntervalRef.current) {
          clearInterval(progressIntervalRef.current);
        }
        setAudioProgress({});
      });

      audio.load();
      await audio.play();

    } catch (error) {
      console.error('Failed to play audio:', error);
      alert(`Failed to play audio: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setAudioLoading(null);
      setPlayingSegment(null);
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
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

  const handleDownload = () => {
    if (parent?.minio_url) {
      const downloadUrl = parent.minio_url.replace("http://minio:9000", MINIO_URL);
      window.open(downloadUrl, "_blank");
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
            <ThemeToggle />
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
          <ThemeToggle />
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
                <Badge className={`${getStatusColor(parent.status)} font-medium`}>
                  {parent.status.toUpperCase()}
                </Badge>
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
                            <span className="font-semibold text-stone-900 dark:text-white">
                              {segment.speaker}
                            </span>
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
                            disabled={isLoading || !segment.minio_url}
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