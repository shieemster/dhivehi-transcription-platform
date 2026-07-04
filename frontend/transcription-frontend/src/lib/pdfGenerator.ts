export interface PdfSegmentData {
  speaker: string;
  start_time: number;
  end_time: number;
  transcript_text: string;
  segment_index: number;
}

export interface PdfParentData {
  filename: string;
  reference_number: string;
  category: string;
  status: string;
  timestamp: string;
}

export interface PdfAnalysisData {
  summary: string;
  keywords: string[];
  entities: {
    persons: string[];
    locations: string[];
    organizations: string[];
    events: string[];
  };
  classification: string;
}

export async function generateTranscriptPdf(data: {
  parent: PdfParentData;
  segments: PdfSegmentData[];
  format: 'segmented' | 'paragraph';
  analysisData?: PdfAnalysisData | null;
}): Promise<void> {
  const response = await fetch('/api/export-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'PDF generation failed' }));
    throw new Error(err.error || `Server error: ${response.status}`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeFilename = data.parent.filename.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40);
  a.download = `${safeFilename}_transcript.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
