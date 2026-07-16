export interface ExportSegment {
  speaker: string;
  speaker_display_name?: string;
  start_time: number;
  end_time: number;
  transcript_text: string;
  segment_index: number;
}

function speakerLabel(s: ExportSegment): string {
  return s.speaker_display_name || s.speaker;
}

// SRT timestamps: HH:MM:SS,mmm
function srtTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

// WebVTT timestamps: HH:MM:SS.mmm
function vttTimestamp(seconds: number): string {
  return srtTimestamp(seconds).replace(",", ".");
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function generateSrt(segments: ExportSegment[]): string {
  return segments
    .map((s, i) => `${i + 1}\n${srtTimestamp(s.start_time)} --> ${srtTimestamp(s.end_time)}\n${speakerLabel(s)}: ${s.transcript_text}\n`)
    .join("\n");
}

export function generateVtt(segments: ExportSegment[]): string {
  const body = segments
    .map((s, i) => `${i + 1}\n${vttTimestamp(s.start_time)} --> ${vttTimestamp(s.end_time)}\n${speakerLabel(s)}: ${s.transcript_text}\n`)
    .join("\n");
  return `WEBVTT\n\n${body}`;
}

export function generatePlainText(segments: ExportSegment[]): string {
  return segments
    .map((s) => `[${formatClock(s.start_time)} - ${formatClock(s.end_time)}] ${speakerLabel(s)}:\n${s.transcript_text}\n`)
    .join("\n");
}

// RFC4197-style CSV field escaping — wrap in quotes, double any internal quotes.
function csvField(value: string | number): string {
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function generateCsv(segments: ExportSegment[]): string {
  const header = ["segment_index", "speaker", "start_time", "end_time", "transcript_text"].join(",");
  const rows = segments.map((s) =>
    [s.segment_index, csvField(speakerLabel(s)), s.start_time, s.end_time, csvField(s.transcript_text)].join(",")
  );
  return [header, ...rows].join("\n");
}

export function downloadTextFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export type PlainExportFormat = "srt" | "vtt" | "txt" | "csv";

export function exportTranscript(format: PlainExportFormat, segments: ExportSegment[], baseFilename: string) {
  const safeFilename = baseFilename.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 40);
  switch (format) {
    case "srt":
      downloadTextFile(generateSrt(segments), `${safeFilename}.srt`, "text/plain");
      break;
    case "vtt":
      downloadTextFile(generateVtt(segments), `${safeFilename}.vtt`, "text/vtt");
      break;
    case "txt":
      downloadTextFile(generatePlainText(segments), `${safeFilename}.txt`, "text/plain");
      break;
    case "csv":
      downloadTextFile(generateCsv(segments), `${safeFilename}.csv`, "text/csv");
      break;
  }
}
