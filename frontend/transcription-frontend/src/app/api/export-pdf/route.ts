import { NextRequest, NextResponse } from 'next/server';
import puppeteer from 'puppeteer';

interface PdfSegmentData {
  speaker: string;
  start_time: number;
  end_time: number;
  transcript_text: string;
  segment_index: number;
}

interface PdfParentData {
  filename: string;
  reference_number: string;
  category: string;
  status: string;
  timestamp: string;
}

interface PdfAnalysisData {
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

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatDate(timestamp: string): string {
  return new Date(timestamp).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildHtml(
  parent: PdfParentData,
  segments: PdfSegmentData[],
  format: 'segmented' | 'paragraph',
  analysisData?: PdfAnalysisData | null
): string {
  const transcriptHtml =
    format === 'segmented'
      ? segments
          .map(
            (seg) => `
        <div class="segment">
          <div class="segment-header">[${seg.speaker}]  ${formatTime(seg.start_time)} &mdash; ${formatTime(seg.end_time)}</div>
          <div class="segment-text">${escHtml(seg.transcript_text || '')}</div>
        </div>`
          )
          .join('<hr class="sub-divider" />')
      : (() => {
          const groups: { speaker: string; texts: string[] }[] = [];
          for (const seg of segments) {
            const last = groups[groups.length - 1];
            if (last && last.speaker === seg.speaker) {
              last.texts.push(seg.transcript_text || '');
            } else {
              groups.push({ speaker: seg.speaker, texts: [seg.transcript_text || ''] });
            }
          }
          return groups
            .map(
              (g) => `
        <div class="speaker-block">
          <div class="speaker-heading">${escHtml(g.speaker)}</div>
          <div class="paragraph-text">${escHtml(g.texts.join(' '))}</div>
        </div>`
            )
            .join('<hr class="sub-divider" />');
        })();

  const analysisHtml = analysisData
    ? `
      <hr class="divider" />
      <div class="analysis-section">
        <h2>Analysis Summary</h2>

        <h3>Summary:</h3>
        <p>${escHtml(analysisData.summary || '')}</p>

        ${analysisData.keywords?.length ? `<h3>Keywords:</h3><p>${analysisData.keywords.map((kw) => `<span class="pill">${escHtml(kw)}</span>`).join(' ')}</p>` : ''}

        ${analysisData.classification ? `<h3>Classification:</h3><p><span class="classification-badge ${getClassificationClass(analysisData.classification)}">${escHtml(formatClassification(analysisData.classification))}</span></p>` : ''}

        ${(() => {
          const entityTypes: [string, string[]][] = [
            ['Persons', analysisData.entities?.persons || []],
            ['Locations', analysisData.entities?.locations || []],
            ['Organizations', analysisData.entities?.organizations || []],
            ['Events', analysisData.entities?.events || []],
          ];
          const hasEntities = entityTypes.some(([, items]) => items.length > 0);
          if (!hasEntities) return '';
          return `
            <h3>Named Entities:</h3>
            ${entityTypes
              .filter(([, items]) => items.length > 0)
              .map(
                ([label, items]) => `
              <div class="entity-group">
                <div class="entity-label">${label}:</div>
                <div>${items.map((item) => `<span class="pill">${escHtml(item)}</span>`).join(' ')}</div>
              </div>`
              )
              .join('')}
          `;
        })()}
      </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thaana:wght@400;700&display=swap" rel="stylesheet">
  <style>
    @page { margin: 20mm; }
    body { font-family: 'Noto Sans Thaana', Helvetica, Arial, sans-serif; margin: 0; padding: 0; color: #000; font-size: 10pt; line-height: 1.5; }
    .header-box { background: #f0f0f0; padding: 6mm 4mm; margin-bottom: 4mm; }
    .header-box h1 { font-size: 18pt; font-weight: bold; margin: 0 0 4mm 0; }
    .header-box p { font-size: 10pt; margin: 1mm 0; }
    .header-box .note { font-size: 8pt; color: #666; margin-top: 3mm; }
    .divider { border: none; border-top: 1px solid #b0b0b0; margin: 4mm 0; }
    .sub-divider { border: none; border-top: 1px solid #ddd; margin: 2mm 0; }
    .segment { margin-bottom: 3mm; }
    .segment-header { font-weight: bold; font-size: 10pt; }
    .segment-text { direction: rtl; }
    .speaker-block { margin-bottom: 3mm; }
    .speaker-heading { font-weight: bold; font-size: 11pt; margin-top: 3mm; }
    .paragraph-text { direction: rtl; }
    .analysis-section { margin-top: 6mm; }
    .analysis-section h2 { font-size: 14pt; font-weight: bold; margin-top: 4mm; margin-bottom: 3mm; }
    .analysis-section h3 { font-size: 10pt; font-weight: bold; margin-top: 3mm; margin-bottom: 1mm; }
    .analysis-section p { margin: 0 0 2mm 0; }
    .pill { display: inline-block; background: #e0e0e0; padding: 0.5mm 2mm; border-radius: 2mm; margin: 0.3mm; font-size: 9pt; }
    .classification-badge { display: inline-block; padding: 1.5mm 3mm; border-radius: 2mm; font-weight: bold; font-size: 10pt; }
    .classification-threat { background: #fee; color: #c00; }
    .classification-alibi { background: #fff3e0; color: #e65100; }
    .classification-emergency { background: #fff3e0; color: #cc5500; }
    .classification-general_discussion { background: #e3f2fd; color: #1565c0; }
    .classification-other { background: #f5f5f5; color: #666; }
    .entity-group { margin-bottom: 2mm; }
    .entity-label { font-weight: bold; margin-bottom: 0.5mm; }
  </style>
</head>
<body>
  <div class="header-box">
    <h1>Dhivehi Transcription Platform</h1>
    <p><strong>File:</strong> ${escHtml(parent.filename)}</p>
    <p><strong>Reference:</strong> ${escHtml(parent.reference_number)} &nbsp;|&nbsp; <strong>Category:</strong> ${escHtml(parent.category)} &nbsp;|&nbsp; <strong>Status:</strong> ${escHtml(parent.status.toUpperCase())}</p>
    <p><strong>Uploaded:</strong> ${formatDate(parent.timestamp)}</p>
    <p class="note">Note: Dhivehi text may not render correctly in all PDF viewers. For accurate Dhivehi display, refer to the on-screen transcript.</p>
  </div>

  <hr class="divider" />

  ${transcriptHtml}
  ${analysisHtml}
</body>
</html>`;
}

function escHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getClassificationClass(classification: string): string {
  const known = ['threat', 'alibi', 'emergency', 'general_discussion'];
  return known.includes(classification) ? `classification-${classification}` : 'classification-other';
}

function formatClassification(classification: string): string {
  return classification.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { parent, segments, format, analysisData } = body as {
      parent: PdfParentData;
      segments: PdfSegmentData[];
      format: 'segmented' | 'paragraph';
      analysisData?: PdfAnalysisData | null;
    };

    /*
     * Docker note:
     * In production Docker, consider using puppeteer-core + system Chromium
     * to avoid downloading the full Chromium binary.
     * Local dev uses full puppeteer with bundled Chromium.
     */
    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();

    const html = buildHtml(parent, segments, format, analysisData);
    await page.setContent(html, { waitUntil: 'load' });
    await page.emulateMediaType('screen');

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '20mm', right: '20mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `
        <div style="width:100%;font-size:8pt;color:#888;display:flex;justify-content:space-between;padding:0 20mm;box-sizing:border-box;">
          <span>CONFIDENTIAL &mdash; FOR LAW ENFORCEMENT USE ONLY</span>
          <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
        </div>
      `,
    });

    await browser.close();

    const safeFilename = parent.filename.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40);

    return new NextResponse(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeFilename}_transcript.pdf"`,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'PDF generation failed' },
      { status: 500 }
    );
  }
}
