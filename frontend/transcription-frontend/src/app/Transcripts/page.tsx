'use client'
import { Suspense } from 'react'
import * as React from "react";
const { useState, useEffect, useRef } = React;
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Upload, FileText, X, Moon, Sun, Check, Loader2, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import { useTheme } from "next-themes";
import { BACKEND_URL } from "@/config";
import { useAuth } from "@/contexts/AuthContext";
import { AdminMenu } from "@/components/AdminMenu";

export default function NewTranscript() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-stone-200 dark:bg-neutral-900 animate-pulse" />}>
      <NewTranscriptPage />
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

const categories = [
  { value: "meeting", label: "Meeting" },
  { value: "interview", label: "Interview" },
  { value: "lecture", label: "Lecture" },
  { value: "podcast", label: "Podcast" },
  { value: "presentation", label: "Presentation" },
  { value: "conference", label: "Conference" },
  { value: "webinar", label: "Webinar" },
  { value: "other", label: "Other" },
];

// Self-contained category combobox — each uploaded file gets its own
// instance, so the open/search state can't leak between files the way a
// single shared `open`/`searchValue` pair used to when there was only one
// set of detail fields for the whole batch.
function CategoryPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState(() => categories.find(c => c.value === value)?.label ?? "");

  const filteredCategories = categories.filter((cat) =>
    cat.label.toLowerCase().includes(searchValue.toLowerCase())
  );

  return (
    <div className="relative">
      <Input
        type="text"
        placeholder="Type to search categories..."
        value={searchValue}
        onChange={(e) => {
          setSearchValue(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="bg-stone-50 dark:bg-neutral-700/50 border-stone-300 dark:border-neutral-600 text-stone-900 dark:text-white placeholder:text-stone-500 dark:placeholder:text-neutral-400 transition-all duration-500 ease-in-out"
      />
      {open && filteredCategories.length > 0 && (
        <div className="absolute z-50 w-full mt-2 rounded-md border bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 shadow-md">
          <div className="max-h-[200px] overflow-y-auto p-1">
            {filteredCategories.map((cat) => (
              <div
                key={cat.value}
                onMouseDown={(e) => {
                  // onMouseDown (not onClick) fires before the input's onBlur
                  // closes the dropdown out from under this click.
                  e.preventDefault();
                  onChange(cat.value);
                  setSearchValue(cat.label);
                  setOpen(false);
                }}
                className="flex items-center px-2 py-1.5 text-sm cursor-pointer rounded-sm text-stone-700 dark:text-neutral-300 hover:bg-stone-100 dark:hover:bg-neutral-700 transition-colors"
              >
                <Check
                  className={`mr-2 h-4 w-4 ${value === cat.value ? "opacity-100" : "opacity-0"}`}
                />
                {cat.label}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// A row of discrete, individually clickable/draggable blocks rather than a
// continuous drag handle — speaker count is inherently a small whole number,
// so this reads at a glance and is harder to mis-set than a fine-grained
// slider that then gets rounded for display.
function SegmentedSpeakerSlider({ value, onChange, max = 10 }: { value: number; onChange: (value: number) => void; max?: number }) {
  const draggingRef = useRef(false);

  useEffect(() => {
    const stopDragging = () => { draggingRef.current = false; };
    window.addEventListener("mouseup", stopDragging);
    window.addEventListener("touchend", stopDragging);
    return () => {
      window.removeEventListener("mouseup", stopDragging);
      window.removeEventListener("touchend", stopDragging);
    };
  }, []);

  return (
    <div className="flex gap-1 w-full select-none">
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          aria-label={`${n} speaker${n > 1 ? "s" : ""}`}
          aria-pressed={n <= value}
          onMouseDown={() => {
            draggingRef.current = true;
            onChange(n);
          }}
          onMouseEnter={() => {
            if (draggingRef.current) onChange(n);
          }}
          className={`flex-1 h-8 rounded-sm transition-colors duration-150 ease-in-out ${n <= value
            ? "bg-stone-600 dark:bg-neutral-300"
            : "bg-stone-200 hover:bg-stone-300 dark:bg-neutral-700 dark:hover:bg-neutral-600"
            }`}
        />
      ))}
    </div>
  );
}

interface FileDetail {
  category: string;
  referenceNumber: string;
  notes: string;
  speakers: number;
}

const DEFAULT_SPEAKERS = 5;

function defaultFileDetail(): FileDetail {
  return { category: "", referenceNumber: "", notes: "", speakers: DEFAULT_SPEAKERS };
}

function NewTranscriptPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const jobId = searchParams.get('job_id');
  const { authFetch, isAuthenticated, isLoading: authLoading } = useAuth();

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push("/login");
    }
  }, [authLoading, isAuthenticated, router]);

  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  // Kept in lockstep (by index) with uploadedFiles — each file gets its own
  // category/reference/notes/speaker count instead of one set of fields
  // shared across the whole batch.
  const [fileDetails, setFileDetails] = useState<FileDetail[]>([]);
  const [expandedIndices, setExpandedIndices] = useState<Set<number>>(new Set());
  type FileStatus = 'pending' | 'uploading' | 'success' | 'error';
  const [fileStatuses, setFileStatuses] = useState<FileStatus[]>([]);
  const [fileErrors, setFileErrors] = useState<(string | null)[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notification, setNotification] = useState<{
    show: boolean;
    message: string;
    type: 'success' | 'error' | 'warning';
  }>({ show: false, message: '', type: 'success' });

  useEffect(() => {
    setMounted(true);

    const fileDataStr = sessionStorage.getItem('uploadedFileData');
    const fileContent = sessionStorage.getItem('uploadedFileContent');

    if (fileDataStr && fileContent) {
      const fileData = JSON.parse(fileDataStr);

      fetch(fileContent)
        .then(res => res.blob())
        .then(blob => {
          const file = new File([blob], fileData.name, {
            type: fileData.type,
            lastModified: fileData.lastModified
          });
          addFiles([file]);

          sessionStorage.removeItem('uploadedFileData');
          sessionStorage.removeItem('uploadedFileContent');
        });
    }
  }, []);

  useEffect(() => {
    if (notification.show) {
      const timer = setTimeout(() => {
        setNotification(prev => ({ ...prev, show: false }));
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [notification.show]);

  const addFiles = (files: File[]) => {
    if (files.length === 0) return;
    const startIndex = uploadedFiles.length;
    setUploadedFiles(prev => [...prev, ...files]);
    setFileStatuses(prev => [...prev, ...files.map(() => 'pending' as FileStatus)]);
    setFileErrors(prev => [...prev, ...files.map(() => null)]);
    setFileDetails(prev => [...prev, ...files.map(() => defaultFileDetail())]);
    // Newly-added files start expanded so their fields are immediately
    // visible/editable — matching how the single set of fields used to
    // always be visible before this became per-file.
    setExpandedIndices(prev => {
      const next = new Set(prev);
      files.forEach((_, i) => next.add(startIndex + i));
      return next;
    });
  };

  const updateFileDetail = (index: number, patch: Partial<FileDetail>) => {
    setFileDetails(prev => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  };

  const toggleExpanded = (index: number) => {
    setExpandedIndices(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  };

  const handleDrag = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files) {
      addFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      addFiles(Array.from(e.target.files));
    }
    e.target.value = ''; // allow re-selecting the same file(s) again later
  };

  const handleRemoveFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
    setFileStatuses(prev => prev.filter((_, i) => i !== index));
    setFileErrors(prev => prev.filter((_, i) => i !== index));
    setFileDetails(prev => prev.filter((_, i) => i !== index));
    setExpandedIndices(prev => {
      const next = new Set<number>();
      prev.forEach(i => {
        if (i < index) next.add(i);
        else if (i > index) next.add(i - 1);
      });
      return next;
    });
  };

  // Uploads every selected file sequentially (not in parallel) against the
  // existing single-file /upload endpoint — the pipeline's Redis queue
  // processes one conversion job at a time per worker anyway, and
  // sequential uploads make per-file progress easy to show without any
  // backend changes for batching. Each file's own category/reference
  // number/notes/speaker count (fileDetails[i]) travels with it.
  const handleSubmit = async () => {
    if (uploadedFiles.length === 0) {
      setNotification({
        show: true,
        message: "Please add at least one file first.",
        type: 'warning'
      });
      return;
    }

    setIsSubmitting(true);
    const jobIds: string[] = [];
    let failureCount = 0;

    for (let i = 0; i < uploadedFiles.length; i++) {
      setFileStatuses(prev => prev.map((s, idx) => (idx === i ? 'uploading' : s)));

      const detail = fileDetails[i] ?? defaultFileDetail();
      const formData = new FormData();
      formData.append("file", uploadedFiles[i]);
      formData.append("category", detail.category);
      formData.append("reference_number", detail.referenceNumber);
      formData.append("notes", detail.notes);
      formData.append("speakers", Math.floor(detail.speakers).toString());

      try {
        const res = await authFetch(`${BACKEND_URL}/upload`, {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(errorText || "Failed to upload");
        }

        let data: any = {};
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const text = await res.text();
          if (text) data = JSON.parse(text);
        }

        const uploadedJobId = data.job_id || data.jobId || data.id || data.Job_ID || data.message?.job_id;
        if (uploadedJobId) jobIds.push(uploadedJobId);

        setFileStatuses(prev => prev.map((s, idx) => (idx === i ? 'success' : s)));
      } catch (error) {
        failureCount++;
        setFileStatuses(prev => prev.map((s, idx) => (idx === i ? 'error' : s)));
        setFileErrors(prev => prev.map((e, idx) => (idx === i ? (error instanceof Error ? error.message : 'Upload failed') : e)));
      }
    }

    setIsSubmitting(false);

    if (failureCount === 0) {
      setNotification({
        show: true,
        message: uploadedFiles.length === 1
          ? "Audio uploaded successfully! Redirecting to details..."
          : `All ${uploadedFiles.length} files uploaded successfully! Redirecting to list...`,
        type: 'success'
      });
    } else {
      setNotification({
        show: true,
        message: `${uploadedFiles.length - failureCount} of ${uploadedFiles.length} uploaded — ${failureCount} failed. See file list for details.`,
        type: failureCount === uploadedFiles.length ? 'error' : 'warning'
      });
      return; // let the user see which files failed rather than navigating away
    }

    setTimeout(() => {
      setIsNavigating(true);
      if (jobIds.length === 1) {
        router.push(`/Transcripts/Details?job_id=${jobIds[0]}`);
      } else {
        router.push('/Transcripts/List');
      }
    }, 1500);
  };

  const handleCancel = () => {
    setIsNavigating(true);
    setTimeout(() => {
      router.back();
    }, 500);
  };

  if (!mounted) {
    return (
      <div className="min-h-screen bg-stone-200 dark:bg-neutral-900 animate-pulse">
        <header className="backdrop-blur-sm shadow-md dark:shadow-lg">
          <div className="max-w-8xl mx-auto pl-2 pr-6 py-4 flex items-center justify-between gap-2">
            <div className="h-8 w-48 bg-stone-300 dark:bg-neutral-700 rounded"></div>
            <div className="h-10 w-10 bg-stone-300 dark:bg-neutral-700 rounded"></div>
          </div>
        </header>
        <main className="max-w-4xl mx-auto px-6 py-6">
          <div className="text-center mb-8">
            <div className="h-10 w-64 bg-stone-300 dark:bg-neutral-700 rounded mx-auto mb-2"></div>
          </div>
          <Card className="shadow-xl bg-stone-100 dark:bg-neutral-800 border-stone-200 dark:border-neutral-700">
            <CardContent className="p-8 space-y-6">
              <div className="h-40 w-full bg-stone-200 dark:bg-neutral-700/50 rounded-lg"></div>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <>
      {/* Notification Toast */}
      {notification.show && (
        <div className="fixed top-20 right-4 animate-in slide-in-from-top duration-300" style={{ zIndex: 99999 }}>
          <Card className={`shadow-2xl border-2 ${notification.type === 'success'
            ? 'bg-green-50 dark:bg-green-900 border-green-500 dark:border-green-600'
            : notification.type === 'warning'
              ? 'bg-yellow-50 dark:bg-yellow-900 border-yellow-500 dark:border-yellow-600'
              : 'bg-red-50 dark:bg-red-900 border-red-500 dark:border-red-600'
            } transition-all duration-300`}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${notification.type === 'success'
                ? 'bg-green-500 dark:bg-green-400'
                : notification.type === 'warning'
                  ? 'bg-yellow-500 dark:bg-yellow-400'
                  : 'bg-red-500 dark:bg-red-400'
                } animate-pulse`} />
              <p className={`font-medium ${notification.type === 'success'
                ? 'text-green-800 dark:text-green-200'
                : notification.type === 'warning'
                  ? 'text-yellow-800 dark:text-yellow-200'
                  : 'text-red-800 dark:text-red-200'
                }`}>
                {notification.message}
              </p>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setNotification({ ...notification, show: false })}
                className={`ml-2 h-6 w-6 ${notification.type === 'success'
                  ? 'text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-200'
                  : notification.type === 'warning'
                    ? 'text-yellow-600 hover:text-yellow-800 dark:text-yellow-400 dark:hover:text-yellow-200'
                    : 'text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-200'
                  } transition-all duration-200 hover:scale-110`}
              >
                <X className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

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

        <main className="max-w-4xl mx-auto px-6 py-6 transition-all duration-500 ease-in-out">
          <div className="text-center mb-8 transition-all duration-500 ease-in-out">
            <h2 className="text-4xl font-bold text-neutral-700 dark:text-white mb-2 transition-colors duration-500 ease-in-out">
              New Transcript
            </h2>
            {jobId && (
              <p className="text-lg text-stone-600 dark:text-neutral-300 transition-colors duration-500 ease-in-out">
                Job ID: <span className="font-semibold">{jobId}</span>
              </p>
            )}
          </div>

          <Card className="shadow-xl bg-stone-100 dark:bg-neutral-800 border-stone-200 dark:border-neutral-700 transition-all duration-500 ease-in-out">
            <CardContent className="p-8 space-y-6 transition-all duration-500 ease-in-out">
              {/* Uploaded Files — each gets its own expandable details section */}
              <div className="space-y-2">
                <Label className="text-stone-900 dark:text-white transition-colors duration-500 ease-in-out">
                  Audio/Video File(s) {uploadedFiles.length > 0 && (
                    <span className="text-green-600 dark:text-green-400">
                      ({uploadedFiles.length} selected)
                    </span>
                  )}
                </Label>

                {uploadedFiles.length > 0 && (
                  <div className="space-y-2 mb-2">
                    {uploadedFiles.map((file, index) => {
                      const status = fileStatuses[index];
                      const detail = fileDetails[index] ?? defaultFileDetail();
                      const isExpanded = expandedIndices.has(index);
                      return (
                        <div
                          key={`${file.name}-${index}`}
                          className="bg-stone-50 dark:bg-neutral-700/50 border border-stone-300 dark:border-neutral-600 rounded-lg transition-all duration-500 ease-in-out overflow-hidden"
                        >
                          <div className="flex items-center gap-4 p-4">
                            <div className="bg-stone-100 dark:bg-neutral-900/50 p-3 rounded-lg transition-colors duration-500 ease-in-out">
                              <FileText className="w-6 h-6 text-stone-400 dark:text-neutral-400 transition-colors duration-500 ease-in-out" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-stone-900 dark:text-white truncate transition-colors duration-500 ease-in-out">
                                {file.name}
                              </p>
                              <p className="text-sm text-stone-500 dark:text-neutral-400 transition-colors duration-500 ease-in-out">
                                {(file.size / (1024 * 1024)).toFixed(2)} MB
                              </p>
                              {status === 'error' && fileErrors[index] && (
                                <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1 mt-1">
                                  <AlertCircle className="w-3 h-3 shrink-0" />
                                  {fileErrors[index]}
                                </p>
                              )}
                            </div>
                            {status === 'uploading' && <Loader2 className="w-5 h-5 animate-spin text-stone-500 dark:text-neutral-400" />}
                            {status === 'success' && <Check className="w-5 h-5 text-green-600 dark:text-green-400" />}
                            {status === 'error' && <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />}
                            <Button
                              type="button"
                              onClick={() => toggleExpanded(index)}
                              variant="ghost"
                              size="icon"
                              title={isExpanded ? "Hide details" : "Edit details"}
                              className="text-stone-600 hover:text-stone-900 dark:text-neutral-400 dark:hover:text-white transition-all duration-500 ease-in-out"
                            >
                              {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                            </Button>
                            {(status === 'pending' || status === 'error') && (
                              <Button
                                onClick={() => handleRemoveFile(index)}
                                variant="ghost"
                                size="icon"
                                className="text-stone-600 hover:text-stone-900 dark:text-neutral-400 dark:hover:text-white transition-all duration-500 ease-in-out hover:scale-110"
                              >
                                <X className="w-5 h-5" />
                              </Button>
                            )}
                          </div>

                          {isExpanded && (
                            <div className="px-4 pb-4 pt-4 space-y-4 border-t border-stone-300 dark:border-neutral-600">
                              <div className="space-y-2">
                                <Label className="text-sm text-stone-900 dark:text-white transition-colors duration-500 ease-in-out">
                                  Category
                                </Label>
                                <CategoryPicker
                                  value={detail.category}
                                  onChange={(v) => updateFileDetail(index, { category: v })}
                                />
                              </div>

                              <div className="space-y-2">
                                <Label className="text-sm text-stone-900 dark:text-white transition-colors duration-500 ease-in-out">
                                  Reference Number
                                </Label>
                                <Input
                                  type="text"
                                  placeholder="Enter reference number"
                                  value={detail.referenceNumber}
                                  onChange={(e) => updateFileDetail(index, { referenceNumber: e.target.value })}
                                  className="bg-stone-50 dark:bg-neutral-700/50 border-stone-300 dark:border-neutral-600 text-stone-900 dark:text-white placeholder:text-stone-500 dark:placeholder:text-neutral-400 transition-all duration-500 ease-in-out"
                                />
                              </div>

                              <div className="space-y-2">
                                <Label className="text-sm text-stone-900 dark:text-white transition-colors duration-500 ease-in-out">
                                  Additional Notes
                                </Label>
                                <Textarea
                                  placeholder="Enter any additional notes..."
                                  value={detail.notes}
                                  onChange={(e) => updateFileDetail(index, { notes: e.target.value })}
                                  rows={3}
                                  className="bg-stone-50 dark:bg-neutral-700/50 border-stone-300 dark:border-neutral-600 text-stone-900 dark:text-white placeholder:text-stone-500 dark:placeholder:text-neutral-400 transition-all duration-500 ease-in-out resize-none"
                                />
                              </div>

                              <div className="space-y-3">
                                <div className="flex justify-between items-center">
                                  <Label className="text-sm text-stone-900 dark:text-white transition-colors duration-500 ease-in-out">
                                    Number of Speakers
                                  </Label>
                                  <span className="text-xl font-bold text-stone-600 dark:text-neutral-300 transition-colors duration-500 ease-in-out">
                                    {detail.speakers}
                                  </span>
                                </div>
                                <SegmentedSpeakerSlider
                                  value={detail.speakers}
                                  onChange={(v) => updateFileDetail(index, { speakers: v })}
                                />
                                <div className="flex justify-between text-xs text-stone-500 dark:text-neutral-400 transition-colors duration-500 ease-in-out">
                                  <span>1</span>
                                  <span>10</span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div
                  className={`border-2 border-dashed rounded-lg p-8 text-center transition-all duration-500 ease-in-out ${dragActive
                    ? "border-stone-500 bg-stone-100 dark:border-neutral-400 dark:bg-neutral-950/50 scale-105"
                    : "border-stone-300 bg-stone-50 dark:border-neutral-600 dark:bg-neutral-700/50"
                    }`}
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                >
                  <Upload className="w-12 h-12 mx-auto mb-3 text-stone-400 dark:text-neutral-500 transition-colors duration-500 ease-in-out" />
                  <p className="text-stone-700 dark:text-white mb-2 transition-colors duration-500 ease-in-out">
                    Drop file(s) here
                  </p>
                  <p className="text-sm text-stone-500 dark:text-neutral-400 mb-3 transition-colors duration-500 ease-in-out">
                    or click to browse — you can select multiple files at once
                  </p>
                  <input
                    type="file"
                    id="additional-file"
                    className="hidden"
                    onChange={handleFileInput}
                    accept="audio/*,video/*"
                    multiple
                  />
                  <label htmlFor="additional-file">
                    <Button
                      type="button"
                      onClick={() => document.getElementById('additional-file')?.click()}
                      className="bg-neutral-600 hover:bg-neutral-700 dark:bg-neutral-400 dark:hover:bg-neutral-500 transition-all duration-500 ease-in-out hover:scale-105"
                    >
                      Browse Files
                    </Button>
                  </label>
                </div>
              </div>

              {/* Submit Button */}
              <div className="flex gap-4 pt-4">
                <Button
                  onClick={handleCancel}
                  variant="outline"
                  className="flex-1 bg-stone-100 hover:bg-stone-200 text-stone-800 border-stone-300 dark:bg-neutral-700 dark:hover:bg-neutral-600 dark:text-neutral-200 dark:border-neutral-600 transition-all duration-500 ease-in-out hover:scale-105"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={uploadedFiles.length === 0 || isSubmitting}
                  className="flex-1 bg-stone-600 hover:bg-stone-700 dark:bg-neutral-700 dark:hover:bg-neutral-600 text-white transition-all duration-500 ease-in-out hover:scale-105 hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Uploading...
                    </>
                  ) : uploadedFiles.length > 1 ? (
                    `Submit ${uploadedFiles.length} Files`
                  ) : (
                    'Submit Transcript'
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    </>
  );
}
