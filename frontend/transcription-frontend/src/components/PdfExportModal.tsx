'use client'

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Loader2, FileDown, FileText, AlignLeft } from "lucide-react";

interface PdfExportModalProps {
  open: boolean;
  onClose: () => void;
  onGenerate: (format: 'segmented' | 'paragraph') => Promise<void>;
  loading: boolean;
}

export default function PdfExportModal({ open, onClose, onGenerate, loading }: PdfExportModalProps) {
  const [format, setFormat] = useState<'segmented' | 'paragraph'>('segmented');

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="w-full max-w-lg mx-4 bg-stone-100 dark:bg-neutral-800 border-stone-200 dark:border-neutral-700 shadow-xl">
        <CardHeader>
          <CardTitle className="text-lg text-neutral-900 dark:text-white flex items-center gap-2">
            <FileDown className="w-5 h-5" />
            Export Transcript PDF
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-stone-600 dark:text-neutral-400">
            Choose how you want the transcript formatted in the PDF.
          </p>

          <div className="grid grid-cols-1 gap-3">
            <button
              onClick={() => setFormat('segmented')}
              className={`flex items-start gap-4 p-4 rounded-lg border-2 text-left transition-all duration-200 ${
                format === 'segmented'
                  ? 'border-stone-600 dark:border-neutral-400 bg-stone-50 dark:bg-neutral-700/50'
                  : 'border-stone-200 dark:border-neutral-700 bg-transparent hover:bg-stone-50 dark:hover:bg-neutral-700/30'
              }`}
            >
              <FileText className={`w-6 h-6 mt-0.5 shrink-0 ${format === 'segmented' ? 'text-stone-700 dark:text-neutral-300' : 'text-stone-400 dark:text-neutral-500'}`} />
              <div>
                <p className={`font-semibold ${format === 'segmented' ? 'text-neutral-900 dark:text-white' : 'text-stone-600 dark:text-neutral-400'}`}>
                  Segmented
                </p>
                <p className="text-xs text-stone-500 dark:text-neutral-500 mt-1">
                  Transcript presented segment by segment with speaker labels and timestamps, preserving the original conversation structure.
                </p>
              </div>
            </button>

            <button
              onClick={() => setFormat('paragraph')}
              className={`flex items-start gap-4 p-4 rounded-lg border-2 text-left transition-all duration-200 ${
                format === 'paragraph'
                  ? 'border-stone-600 dark:border-neutral-400 bg-stone-50 dark:bg-neutral-700/50'
                  : 'border-stone-200 dark:border-neutral-700 bg-transparent hover:bg-stone-50 dark:hover:bg-neutral-700/30'
              }`}
            >
              <AlignLeft className={`w-6 h-6 mt-0.5 shrink-0 ${format === 'paragraph' ? 'text-stone-700 dark:text-neutral-300' : 'text-stone-400 dark:text-neutral-500'}`} />
              <div>
                <p className={`font-semibold ${format === 'paragraph' ? 'text-neutral-900 dark:text-white' : 'text-stone-600 dark:text-neutral-400'}`}>
                  Paragraph
                </p>
                <p className="text-xs text-stone-500 dark:text-neutral-500 mt-1">
                  Transcript grouped by speaker into continuous paragraphs without timestamps for a cleaner readable document.
                </p>
              </div>
            </button>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={loading}
              className="bg-stone-50 hover:bg-stone-200 dark:bg-neutral-700 dark:hover:bg-neutral-600"
            >
              Cancel
            </Button>
            <Button
              onClick={() => onGenerate(format)}
              disabled={loading}
              className="bg-stone-600 hover:bg-stone-700 dark:bg-neutral-700 dark:hover:bg-neutral-600"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <FileDown className="w-4 h-4 mr-2" />
                  Generate PDF
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
