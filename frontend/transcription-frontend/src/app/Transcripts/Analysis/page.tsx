'use client'
import { Suspense } from 'react'
import * as React from "react";
const { useState, useEffect } = React;
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { QDRANT_URL, BACKEND_URL } from "@/config";
import {
  ArrowLeft,
  FileText,
  Tag,
  Users,
  Shield,
  Languages,
  Loader2,
  AlertCircle,
  Sparkles,
  ChevronDown,
  Moon,
  Sun,
  Hash,
  Clock,
  Info,
  FileDown
} from "lucide-react";
import { useTheme } from "next-themes";
import PdfExportModal from "@/components/PdfExportModal";
import { generateTranscriptPdf, PdfSegmentData } from "@/lib/pdfGenerator";
import { useAuth } from "@/contexts/AuthContext";

export default function AnalysisPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-stone-200 dark:bg-neutral-900 animate-pulse" />}>
      <AnalysisPageContent />
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

interface AnalysisData {
  keywords: string[];
  entities: {
    persons: string[];
    locations: string[];
    organizations: string[];
    events: string[];
  };
  summary: string;
  classification: string;
  english_translation: string;
}

function AnalysisPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const jobId = searchParams.get('job_id');
  const { authFetch, token, isLoading: authLoading } = useAuth();

  useEffect(() => {
    if (!authLoading && !token) {
      router.push("/login");
    }
  }, [authLoading, token, router]);

  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [parent, setParent] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisData | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [visibleSections, setVisibleSections] = useState<Set<string>>(new Set());
  const [showTranslation, setShowTranslation] = useState(false);
  const [segments, setSegments] = useState<PdfSegmentData[]>([]);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (jobId) {
      fetchParentData();
      fetchSegments();
    } else {
      setError('No job ID provided');
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    if (!analysisResult) return;
    const order = ['summary', 'keywords', 'entities', 'classification', 'translation'];
    order.forEach((section, i) => {
      setTimeout(() => {
        setVisibleSections(prev => new Set([...prev, section]));
      }, i * 400);
    });
  }, [analysisResult]);

  const fetchParentData = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${QDRANT_URL}/collections/file_metadata/points/scroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filter: {
            must: [
              { key: "type", match: { value: "parent" } },
              { key: "job_id", match: { value: jobId } }
            ]
          },
          limit: 1,
          with_payload: true,
          with_vector: false
        })
      });

      if (!response.ok) throw new Error('Failed to fetch transcript data');

      const data = await response.json();
      if (data.result.points.length === 0) throw new Error('Transcript not found');

      const payload = data.result.points[0].payload;

      setParent(payload);

      if (payload.analysis_status === "complete") {
        setAnalysisResult({
          keywords: payload.analysis_keywords || [],
          entities: payload.analysis_entities || { persons: [], locations: [], organizations: [], events: [] },
          summary: payload.analysis_summary || "",
          classification: payload.analysis_classification || "",
          english_translation: payload.analysis_english_translation || "",
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const fetchSegments = async () => {
    if (!jobId) return;
    const allSegments: any[] = [];
    let offset: string | number | null | undefined = undefined;
    let hasMore = true;
    let iterationCount = 0;
    const maxIterations = 50;

    while (hasMore && iterationCount < maxIterations) {
      iterationCount++;
      const requestBody: any = {
        filter: {
          must: [
            { key: "type", match: { value: "segment" } },
            { key: "parent_job_id", match: { value: jobId } }
          ]
        },
        limit: 100,
        with_payload: true,
        with_vector: false
      };
      if (offset !== undefined && offset !== null) {
        requestBody.offset = offset;
      }
      try {
        const response = await fetch(`${QDRANT_URL}/collections/file_metadata/points/scroll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });
        if (!response.ok) break;
        const data = await response.json();
        const newPoints = data.result.points || [];
        if (newPoints.length === 0) break;
        allSegments.push(...newPoints);
        const nextOffset = data.result.next_page_offset;
        if (nextOffset === null || nextOffset === undefined) {
          hasMore = false;
        } else if (nextOffset === offset) {
          break;
        } else {
          offset = nextOffset;
        }
      } catch {
        break;
      }
    }

    setSegments(
      allSegments
        .map((point: any) => ({
          speaker: point.payload.speaker,
          start_time: point.payload.start_time,
          end_time: point.payload.end_time,
          transcript_text: point.payload.transcript_text || '',
          segment_index: point.payload.segment_index,
        }))
        .sort((a: PdfSegmentData, b: PdfSegmentData) => a.segment_index - b.segment_index)
    );
  };

  const handleAnalyse = async () => {
    if (!jobId) return;
    setAnalysing(true);
    setAnalysisError(null);
    try {
      const resp = await authFetch(`${BACKEND_URL}/transcripts/${jobId}/analyse`, {
        method: 'POST',
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || `Analysis failed: ${resp.status}`);
      }
      const data = await resp.json();
      setAnalysisResult({
        keywords: data.keywords || [],
        entities: data.entities || { persons: [], locations: [], organizations: [], events: [] },
        summary: data.summary || "",
        classification: data.classification || "",
        english_translation: data.english_translation || "",
      });
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setAnalysing(false);
    }
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

  const getClassificationColor = (classification: string) => {
    switch (classification) {
      case "threat": return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
      case "alibi": return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
      case "emergency": return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200";
      case "general_discussion": return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
      default: return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
    }
  };

  const formatClassification = (classification: string) => {
    return classification.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
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

  const handleGeneratePdf = async (format: 'segmented' | 'paragraph') => {
    if (!parent) return;
    setExportLoading(true);
    try {
      await generateTranscriptPdf({
        parent: {
          filename: parent.filename,
          reference_number: parent.reference_number || 'N/A',
          category: parent.category || 'Uncategorized',
          status: parent.status,
          timestamp: parent.timestamp,
        },
        segments,
        format,
        analysisData: analysisResult,
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Left sidebar - file metadata */}
          <div className="md:col-span-1">
            <div className="md:sticky md:top-6">
              <Card className="shadow-xl bg-stone-100 dark:bg-neutral-800 border-stone-200 dark:border-neutral-700 transition-all duration-500 ease-in-out">
                <CardHeader>
                  <CardTitle className="text-lg text-neutral-900 dark:text-white">
                    {parent.filename}
                  </CardTitle>
                  <Badge className={`${getStatusColor(parent.status)} font-medium`}>
                    {parent.status.toUpperCase()}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-3 p-3 bg-stone-50 dark:bg-neutral-700/50 rounded-lg">
                    <Hash className="w-4 h-4 text-stone-600 dark:text-neutral-400 shrink-0" />
                    <div>
                      <p className="text-xs text-stone-500 dark:text-neutral-400">Reference</p>
                      <p className="font-semibold text-stone-900 dark:text-white text-sm">
                        {parent.reference_number || 'N/A'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 p-3 bg-stone-50 dark:bg-neutral-700/50 rounded-lg">
                    <FileText className="w-4 h-4 text-stone-600 dark:text-neutral-400 shrink-0" />
                    <div>
                      <p className="text-xs text-stone-500 dark:text-neutral-400">Category</p>
                      <p className="font-semibold text-stone-900 dark:text-white text-sm">
                        {parent.category || 'Uncategorized'}
                      </p>
                    </div>
                  </div>

                  {parent.timestamp && (
                    <div className="flex items-center gap-3 p-3 bg-stone-50 dark:bg-neutral-700/50 rounded-lg">
                      <Clock className="w-4 h-4 text-stone-600 dark:text-neutral-400 shrink-0" />
                      <div>
                        <p className="text-xs text-stone-500 dark:text-neutral-400">Uploaded</p>
                        <p className="font-semibold text-stone-900 dark:text-white text-sm">
                          {formatDate(parent.timestamp)}
                        </p>
                      </div>
                    </div>
                  )}

                  <Button
                    variant="outline"
                    className="w-full bg-stone-50 hover:bg-stone-200 dark:bg-neutral-700 dark:hover:bg-neutral-600 transition-all duration-300"
                    onClick={() => router.push(`/Transcripts/Details?job_id=${jobId}`)}
                  >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Transcript
                  </Button>

                  {segments.length > 0 && (
                    <Button
                      variant="outline"
                      className="w-full bg-stone-50 hover:bg-stone-200 dark:bg-neutral-700 dark:hover:bg-neutral-600 transition-all duration-300"
                      onClick={() => setExportModalOpen(true)}
                    >
                      <FileDown className="w-4 h-4 mr-2" />
                      Export PDF
                    </Button>
                  )}

                  <div className="p-3 bg-stone-50 dark:bg-neutral-700/50 rounded-lg">
                    <div className="flex items-start gap-2">
                      <Info className="w-4 h-4 text-stone-500 dark:text-neutral-400 mt-0.5 shrink-0" />
                      <p className="text-xs text-stone-500 dark:text-neutral-400 leading-relaxed">
                        Analysis is performed on the full concatenated transcript
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Right column - analysis results */}
          <div className="md:col-span-2 space-y-6">
            {!analysisResult && !analysing && !analysisError && (
              <Card className="shadow-xl bg-stone-100 dark:bg-neutral-800 border-stone-200 dark:border-neutral-700">
                <CardContent className="p-12 text-center">
                  {parent.status === "transcribed" ? (
                    <>
                      <Sparkles className="w-12 h-12 mx-auto mb-4 text-stone-400 dark:text-neutral-500" />
                      <p className="text-lg text-stone-700 dark:text-neutral-300 mb-4">
                        This transcript is ready for analysis
                      </p>
                      <Button
                        onClick={handleAnalyse}
                        className="bg-stone-600 hover:bg-stone-700 dark:bg-neutral-700 dark:hover:bg-neutral-600"
                      >
                        <Sparkles className="w-4 h-4 mr-2" />
                        Analyse Transcript
                      </Button>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-12 h-12 mx-auto mb-4 text-stone-400 dark:text-neutral-500" />
                      <p className="text-lg text-stone-700 dark:text-neutral-300">
                        Transcript needs to be transcribed before analysis
                      </p>
                      <p className="text-sm text-stone-500 dark:text-neutral-400 mt-2">
                        Current status: {parent.status}
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {analysing && (
              <Card className="shadow-xl bg-stone-100 dark:bg-neutral-800 border-stone-200 dark:border-neutral-700 animate-pulse">
                <CardContent className="p-12 text-center">
                  <Loader2 className="w-12 h-12 mx-auto mb-4 text-stone-400 dark:text-neutral-500 animate-spin" />
                  <p className="text-lg text-stone-700 dark:text-neutral-300">
                    Analysing transcript...
                  </p>
                </CardContent>
              </Card>
            )}

            {analysisError && (
              <Card className="shadow-xl bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800">
                <CardContent className="p-12 text-center">
                  <AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-600 dark:text-red-400" />
                  <p className="text-lg text-red-800 dark:text-red-200 font-medium mb-2">
                    {analysisError}
                  </p>
                  <Button
                    onClick={handleAnalyse}
                    className="mt-4 bg-stone-600 hover:bg-stone-700 dark:bg-neutral-700 dark:hover:bg-neutral-600"
                  >
                    <Loader2 className="w-4 h-4 mr-2" />
                    Retry
                  </Button>
                </CardContent>
              </Card>
            )}

            {analysisResult && (
              <Card className="shadow-xl bg-stone-100 dark:bg-neutral-800 border-stone-200 dark:border-neutral-700">
                <CardHeader>
                  <CardTitle className="text-xl text-neutral-900 dark:text-white flex items-center gap-2">
                    <Sparkles className="w-5 h-5" />
                    Analysis Results
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Summary */}
                  <div className={`transition-all duration-500 ease-out ${visibleSections.has('summary') ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>
                    <Card className="shadow-sm bg-stone-50 dark:bg-neutral-700/50 border-stone-200 dark:border-neutral-600">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <FileText className="w-5 h-5 text-stone-600 dark:text-neutral-400" />
                          <h4 className="font-semibold text-neutral-900 dark:text-white">Summary</h4>
                        </div>
                        <p className="text-stone-700 dark:text-neutral-300 leading-relaxed">
                          {analysisResult.summary}
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Keywords */}
                  <div className={`transition-all duration-500 ease-out ${visibleSections.has('keywords') ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>
                    {analysisResult.keywords.length > 0 && (
                      <Card className="shadow-sm bg-stone-50 dark:bg-neutral-700/50 border-stone-200 dark:border-neutral-600">
                        <CardContent className="p-4">
                          <div className="flex items-center gap-2 mb-3">
                            <Tag className="w-5 h-5 text-stone-600 dark:text-neutral-400" />
                            <h4 className="font-semibold text-neutral-900 dark:text-white">Keywords</h4>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {analysisResult.keywords.map((kw, i) => (
                              <Badge key={i} className="bg-stone-600 dark:bg-neutral-600 text-white">
                                {kw}
                              </Badge>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>

                  {/* Named Entities */}
                  <div className={`transition-all duration-500 ease-out ${visibleSections.has('entities') ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>
                    {analysisResult.entities && (
                      <Card className="shadow-sm bg-stone-50 dark:bg-neutral-700/50 border-stone-200 dark:border-neutral-600">
                        <CardContent className="p-4">
                          <div className="flex items-center gap-2 mb-3">
                            <Users className="w-5 h-5 text-stone-600 dark:text-neutral-400" />
                            <h4 className="font-semibold text-neutral-900 dark:text-white">Named Entities</h4>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {Object.entries(analysisResult.entities).map(([type, items]) =>
                              Array.isArray(items) && items.length > 0 ? (
                                <div key={type} className="p-3 bg-white dark:bg-neutral-800 rounded-lg border border-stone-200 dark:border-neutral-700">
                                  <p className="text-xs font-semibold text-stone-500 dark:text-neutral-400 uppercase mb-2">
                                    {type}
                                  </p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {items.map((item: string, i: number) => (
                                      <Badge key={i} variant="outline" className="text-stone-700 dark:text-neutral-300 border-stone-300 dark:border-neutral-600">
                                        {item}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              ) : null
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>

                  {/* Classification */}
                  <div className={`transition-all duration-500 ease-out ${visibleSections.has('classification') ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>
                    {analysisResult.classification && (
                      <Card className="shadow-sm bg-stone-50 dark:bg-neutral-700/50 border-stone-200 dark:border-neutral-600">
                        <CardContent className="p-4">
                          <div className="flex items-center gap-2 mb-3">
                            <Shield className="w-5 h-5 text-stone-600 dark:text-neutral-400" />
                            <h4 className="font-semibold text-neutral-900 dark:text-white">Classification</h4>
                          </div>
                          <Badge className={`${getClassificationColor(analysisResult.classification)} font-medium text-sm px-4 py-1.5`}>
                            {formatClassification(analysisResult.classification)}
                          </Badge>
                        </CardContent>
                      </Card>
                    )}
                  </div>

                  {/* English Translation */}
                  <div className={`transition-all duration-500 ease-out ${visibleSections.has('translation') ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>
                    {analysisResult.english_translation && (
                      <Card className="shadow-sm bg-stone-50 dark:bg-neutral-700/50 border-stone-200 dark:border-neutral-600">
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <Languages className="w-5 h-5 text-stone-600 dark:text-neutral-400" />
                              <h4 className="font-semibold text-neutral-900 dark:text-white">English Translation</h4>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setShowTranslation(!showTranslation)}
                              className="text-stone-600 dark:text-neutral-400 hover:text-stone-800 dark:hover:text-neutral-200"
                            >
                              {showTranslation ? "Hide" : "Show"}
                              <ChevronDown className={`w-4 h-4 ml-1 transition-transform ${showTranslation ? "rotate-180" : ""}`} />
                            </Button>
                          </div>
                          {showTranslation && (
                            <div className="max-h-64 overflow-y-auto p-4 bg-white dark:bg-neutral-800 rounded-lg border border-stone-200 dark:border-neutral-700">
                              <p className="text-stone-700 dark:text-neutral-300 leading-relaxed whitespace-pre-wrap">
                                {analysisResult.english_translation}
                              </p>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
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
