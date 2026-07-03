'use client'
export const dynamic = 'force-dynamic'
import * as React from "react";
const { useState, useEffect } = React;
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Upload, FileText, X, Moon, Sun, Check } from "lucide-react";
import { useTheme } from "next-themes";
import { BACKEND_URL } from "@/config";

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

export default function NewTranscript() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const jobId = searchParams.get('job_id');

  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [searchValue, setSearchValue] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [speakers, setSpeakers] = useState([5]);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
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
          setUploadedFile(file);

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

  const filteredCategories = categories.filter((cat) =>
    cat.label.toLowerCase().includes(searchValue.toLowerCase())
  );

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

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setUploadedFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setUploadedFile(e.target.files[0]);
    }
  };

  const handleRemoveFile = () => {
    setUploadedFile(null);
  };

  const handleSubmit = async () => {
    if (!uploadedFile) {
      setNotification({
        show: true,
        message: "Please upload a file first.",
        type: 'warning'
      });
      return;
    }

    const formData = new FormData();
    formData.append("file", uploadedFile);
    formData.append("category", category);
    formData.append("reference_number", referenceNumber);
    formData.append("notes", notes);
    formData.append("speakers", Math.floor(speakers[0]).toString());

    try {
      const res = await fetch(`${BACKEND_URL}/upload`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || "Failed to upload");
      }

      // Try to parse response, but handle if it's empty or not JSON
      let data: any = {};
      const contentType = res.headers.get("content-type");

      if (contentType && contentType.includes("application/json")) {
        const text = await res.text();
        if (text) {
          data = JSON.parse(text);
        }
      }

      console.log("Upload response:", data);
      console.log("Response headers:", Object.fromEntries(res.headers.entries()));

      // Extract job_id from response - try different possible formats
      const uploadedJobId = data.job_id || data.jobId || data.id || data.Job_ID || data.message?.job_id;

      if (!uploadedJobId) {
        console.warn("No job_id found in response. Server may return job_id separately or you need to fetch the most recent transcript.");

        // Show success and navigate to list page
        setNotification({
          show: true,
          message: "Audio uploaded successfully! View in transcripts list.",
          type: 'success'
        });

        setTimeout(() => {
          setIsNavigating(true);
          router.push('/Transcripts/List');
        }, 2000);
        return;
      }

      setNotification({
        show: true,
        message: "Audio uploaded successfully! Redirecting to details...",
        type: 'success'
      });

      // Navigate to details page with the job_id after 1.5 seconds
      setTimeout(() => {
        setIsNavigating(true);
        router.push(`/Transcripts/Details?job_id=${uploadedJobId}`);
      }, 1500);

    } catch (error) {
      console.error("Upload failed:", error);
      setNotification({
        show: true,
        message: error instanceof Error ? error.message : "Upload failed. Please try again.",
        type: 'error'
      });
    }
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
            <ThemeToggle />
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
              {/* Category Combobox */}
              <div className="space-y-2">
                <Label htmlFor="category" className="text-stone-900 dark:text-white transition-colors duration-500 ease-in-out">
                  Category
                </Label>
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
                    className="bg-stone-50 dark:bg-neutral-700/50 border-stone-300 dark:border-neutral-600 text-stone-900 dark:text-white placeholder:text-stone-500 dark:placeholder:text-neutral-400 transition-all duration-500 ease-in-out"
                  />
                  {open && filteredCategories.length > 0 && (
                    <div className="absolute z-50 w-full mt-2 rounded-md border bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 shadow-md">
                      <div className="max-h-[200px] overflow-y-auto p-1">
                        {filteredCategories.map((cat) => (
                          <div
                            key={cat.value}
                            onClick={() => {
                              setCategory(cat.value);
                              setSearchValue(cat.label);
                              setOpen(false);
                            }}
                            className="flex items-center px-2 py-1.5 text-sm cursor-pointer rounded-sm text-stone-700 dark:text-neutral-300 hover:bg-stone-100 dark:hover:bg-neutral-700 transition-colors"
                          >
                            <Check
                              className={`mr-2 h-4 w-4 ${category === cat.value ? "opacity-100" : "opacity-0"}`}
                            />
                            {cat.label}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Reference Number */}
              <div className="space-y-2">
                <Label htmlFor="reference" className="text-stone-900 dark:text-white transition-colors duration-500 ease-in-out">
                  Reference Number
                </Label>
                <Input
                  id="reference"
                  type="text"
                  placeholder="Enter reference number"
                  value={referenceNumber}
                  onChange={(e) => setReferenceNumber(e.target.value)}
                  className="bg-stone-50 dark:bg-neutral-700/50 border-stone-300 dark:border-neutral-600 text-stone-900 dark:text-white placeholder:text-stone-500 dark:placeholder:text-neutral-400 transition-all duration-500 ease-in-out"
                />
              </div>

              {/* Additional Notes */}
              <div className="space-y-2">
                <Label htmlFor="notes" className="text-stone-900 dark:text-white transition-colors duration-500 ease-in-out">
                  Additional Notes
                </Label>
                <Textarea
                  id="notes"
                  placeholder="Enter any additional notes..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                  className="bg-stone-50 dark:bg-neutral-700/50 border-stone-300 dark:border-neutral-600 text-stone-900 dark:text-white placeholder:text-stone-500 dark:placeholder:text-neutral-400 transition-all duration-500 ease-in-out resize-none"
                />
              </div>

              {/* Number of Speakers */}
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <Label className="text-stone-900 dark:text-white transition-colors duration-500 ease-in-out">
                    Number of Speakers
                  </Label>
                  <span className="text-2xl font-bold text-stone-600 dark:text-neutral-300 transition-colors duration-500 ease-in-out">
                    {Math.round(speakers[0])}
                  </span>
                </div>
                <Slider
                  value={speakers}
                  onValueChange={setSpeakers}
                  max={10}
                  min={1}
                  step={0.01}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-stone-500 dark:text-neutral-400 transition-colors duration-500 ease-in-out">
                  <span>1</span>
                  <span>10</span>
                </div>
              </div>

              {/* Uploaded File Display or Upload Area */}
              <div className="space-y-2">
                <Label className="text-stone-900 dark:text-white transition-colors duration-500 ease-in-out">
                  Audio/Video File {uploadedFile && <span className="text-green-600 dark:text-green-400">(Uploaded)</span>}
                </Label>

                {uploadedFile ? (
                  <div className="flex items-center gap-4 p-4 bg-stone-50 dark:bg-neutral-700/50 border border-stone-300 dark:border-neutral-600 rounded-lg transition-all duration-500 ease-in-out">
                    <div className="bg-stone-100 dark:bg-neutral-900/50 p-3 rounded-lg transition-colors duration-500 ease-in-out">
                      <FileText className="w-6 h-6 text-stone-400 dark:text-neutral-400 transition-colors duration-500 ease-in-out" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-stone-900 dark:text-white truncate transition-colors duration-500 ease-in-out">
                        {uploadedFile.name}
                      </p>
                      <p className="text-sm text-stone-500 dark:text-neutral-400 transition-colors duration-500 ease-in-out">
                        {(uploadedFile.size / (1024 * 1024)).toFixed(2)} MB
                      </p>
                    </div>
                    <Button
                      onClick={handleRemoveFile}
                      variant="ghost"
                      size="icon"
                      className="text-stone-600 hover:text-stone-900 dark:text-neutral-400 dark:hover:text-white transition-all duration-500 ease-in-out hover:scale-110"
                    >
                      <X className="w-5 h-5" />
                    </Button>
                  </div>
                ) : (
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
                      Drop your file here
                    </p>
                    <p className="text-sm text-stone-500 dark:text-neutral-400 mb-3 transition-colors duration-500 ease-in-out">
                      or click to browse
                    </p>
                    <input
                      type="file"
                      id="additional-file"
                      className="hidden"
                      onChange={handleFileInput}
                      accept="audio/*,video/*"
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
                )}
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
                  disabled={!uploadedFile}
                  className="flex-1 bg-stone-600 hover:bg-stone-700 dark:bg-neutral-700 dark:hover:bg-neutral-600 text-white transition-all duration-500 ease-in-out hover:scale-105 hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Submit Transcript
                </Button>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    </>
  );
}