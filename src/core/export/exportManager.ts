import { SubtitleCue, SavedWord } from '@/types';
import { formatTimestamp } from '@/core/subtitle/parser';

export type ExportFormat = 'word' | 'pdf' | 'txt' | 'srt' | 'csv' | 'json' | 'anki';
export type ExportLanguageMode = 'both' | 'target' | 'translation';

export interface TranscriptExportOptions {
  mode?: ExportLanguageMode; // 'both' | 'target' | 'translation'
  includeTimestamps?: boolean;
  title?: string;
}

export interface VocabularyExportOptions {
  filterLevel?: 'all' | 'learning' | 'known' | 'mastered';
  title?: string;
}

/**
 * Format seconds into standard SRT timestamp: HH:mm:ss,SSS
 */
export function secondsToSrtTimestamp(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const totalMillis = Math.round(seconds * 1000);
  const hours = Math.floor(totalMillis / 3600000);
  const minutes = Math.floor((totalMillis % 3600000) / 60000);
  const secs = Math.floor((totalMillis % 60000) / 1000);
  const millis = totalMillis % 1000;
  const pad = (n: number, z = 2) => String(n).padStart(z, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${pad(millis, 3)}`;
}

/**
 * Sanitize filename by removing invalid filesystem characters
 */
export function sanitizeFilename(filename: string, fallback = 'Glean_Export'): string {
  if (!filename || !filename.trim()) return fallback;
  const cleaned = filename
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 100) || fallback;
}

/**
 * Trigger browser file download using Blob
 */
export function triggerFileDownload(content: Blob | string, filename: string, mimeType: string): void {
  if (typeof document === 'undefined') return;
  const blob = typeof content === 'string' ? new Blob([content], { type: mimeType }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.setAttribute('download', filename);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* =========================================================================
   1. TRANSCRIPT EXPORTERS (全片台词剧本导出)
   ========================================================================= */

/**
 * Generate standard SRT subtitle text
 */
export function generateTranscriptSrt(cues: SubtitleCue[], options: TranscriptExportOptions = {}): string {
  const mode = options.mode || 'both';
  return cues
    .map((cue, idx) => {
      const start = secondsToSrtTimestamp(cue.start);
      const end = secondsToSrtTimestamp(cue.end);
      let text = '';
      if (mode === 'target') {
        text = cue.textEn || '';
      } else if (mode === 'translation') {
        text = cue.textZh || cue.textEn || '';
      } else {
        // Both
        if (cue.textEn && cue.textZh) {
          text = `${cue.textEn}\n${cue.textZh}`;
        } else {
          text = cue.textEn || cue.textZh || '';
        }
      }
      return `${idx + 1}\n${start} --> ${end}\n${text.trim()}\n`;
    })
    .join('\n');
}

/**
 * Generate clean TXT script
 */
export function generateTranscriptTxt(cues: SubtitleCue[], options: TranscriptExportOptions = {}): string {
  const mode = options.mode || 'both';
  const includeTimestamps = options.includeTimestamps !== false;
  const title = options.title ? `${options.title}\n${'='.repeat(options.title.length)}\n\n` : '';

  const lines = cues.map(cue => {
    const timeStr = includeTimestamps ? `[${formatTimestamp(cue.start)} - ${formatTimestamp(cue.end)}] ` : '';
    if (mode === 'target') {
      return `${timeStr}${cue.textEn}`;
    } else if (mode === 'translation') {
      return `${timeStr}${cue.textZh || cue.textEn}`;
    } else {
      if (cue.textEn && cue.textZh) {
        return `${timeStr}${cue.textEn}\n${cue.textZh}`;
      }
      return `${timeStr}${cue.textEn || cue.textZh}`;
    }
  });

  return `${title}${lines.join('\n\n')}\n`;
}

/**
 * Generate structured JSON string
 */
export function generateTranscriptJson(cues: SubtitleCue[], options: TranscriptExportOptions = {}): string {
  const data = {
    title: options.title || 'Video Transcript',
    exportTime: new Date().toISOString(),
    totalCues: cues.length,
    cues: cues.map((cue, idx) => ({
      index: idx + 1,
      startTime: cue.start,
      endTime: cue.end,
      timeFormatted: `${formatTimestamp(cue.start)} - ${formatTimestamp(cue.end)}`,
      textEn: cue.textEn || '',
      textZh: cue.textZh || '',
      isAiRefined: Boolean(cue.isAiRefined)
    }))
  };
  return JSON.stringify(data, null, 2);
}

/**
 * Generate CSV with UTF-8 BOM (\uFEFF) for Excel compatibility
 */
export function generateTranscriptCsv(cues: SubtitleCue[], options: TranscriptExportOptions = {}): string {
  const BOM = '\uFEFF';
  const header = 'Index,Start Time,End Time,Timestamp,English,Chinese,AI Refined\n';
  const rows = cues.map((cue, idx) => {
    const start = secondsToSrtTimestamp(cue.start);
    const end = secondsToSrtTimestamp(cue.end);
    const timeFormatted = `${formatTimestamp(cue.start)} - ${formatTimestamp(cue.end)}`;
    const en = `"${(cue.textEn || '').replace(/"/g, '""')}"`;
    const zh = `"${(cue.textZh || '').replace(/"/g, '""')}"`;
    const refined = cue.isAiRefined ? 'Yes' : 'No';
    return `${idx + 1},${start},${end},"${timeFormatted}",${en},${zh},${refined}`;
  }).join('\n');
  return BOM + header + rows;
}

/**
 * Generate Anki flashcards text format (Tab-separated)
 */
export function generateTranscriptAnki(cues: SubtitleCue[], options: TranscriptExportOptions = {}): string {
  return cues
    .filter(cue => Boolean(cue.textEn))
    .map(cue => {
      const en = (cue.textEn || '').replace(/\t/g, ' ').replace(/\n/g, ' ');
      const zh = (cue.textZh || '').replace(/\t/g, ' ').replace(/\n/g, ' ');
      const time = `[${formatTimestamp(cue.start)} - ${formatTimestamp(cue.end)}]`;
      return `${en}\t${zh}\t${time}`;
    })
    .join('\n');
}

/**
 * Generate rich Word (.doc) document HTML with beautiful script typography
 */
export function generateTranscriptWordHtml(cues: SubtitleCue[], options: TranscriptExportOptions = {}): string {
  const mode = options.mode || 'both';
  const includeTimestamps = options.includeTimestamps !== false;
  const rawTitle = options.title || '视频台词双语剧本';
  const displayTitle = escapeHtml(rawTitle);
  const nowStr = new Date().toLocaleDateString();

  const itemsHtml = cues.map((cue, idx) => {
    const timeBadge = includeTimestamps
      ? `<div style="font-family: Consolas, 'Courier New', monospace; font-size: 9pt; color: #2563eb; background: #eff6ff; padding: 2px 8px; border-radius: 4px; display: inline-block; margin-bottom: 4px;">#${idx + 1}&nbsp;&nbsp;${formatTimestamp(cue.start)} &ndash; ${formatTimestamp(cue.end)}</div>`
      : `<div style="font-family: Consolas, monospace; font-size: 9pt; color: #64748b; margin-bottom: 4px;">#${idx + 1}</div>`;

    const enHtml = (mode === 'both' || mode === 'target') && cue.textEn
      ? `<div style="font-size: 11pt; font-weight: 600; color: #0f172a; line-height: 1.5; margin: 2px 0 3px 0;">${escapeHtml(cue.textEn)}</div>`
      : '';

    const zhHtml = (mode === 'both' || mode === 'translation') && (cue.textZh || (mode === 'translation' && cue.textEn))
      ? `<div style="font-size: 10pt; color: #475569; line-height: 1.5; margin: 2px 0;">${escapeHtml(cue.textZh || cue.textEn)}</div>`
      : '';

    return `
      <div style="margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #e2e8f0; page-break-inside: avoid;">
        ${timeBadge}
        ${enHtml}
        ${zhHtml}
      </div>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
  <meta charset='utf-8'>
  <title>${displayTitle}</title>
  <!--[if gte mso 9]>
  <xml>
    <w:WordDocument>
      <w:View>Print</w:View>
      <w:Zoom>100</w:Zoom>
      <w:DoNotOptimizeForBrowser/>
    </w:WordDocument>
  </xml>
  <![endif]-->
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
      line-height: 1.6;
      color: #1f2937;
      padding: 36px 48px;
    }
    h1 {
      font-size: 18pt;
      font-weight: 700;
      color: #0f172a;
      margin: 0 0 6px 0;
    }
    .header-border {
      border-bottom: 2px solid #3b82f6;
      padding-bottom: 12px;
      margin-bottom: 24px;
    }
    .meta {
      font-size: 9.5pt;
      color: #64748b;
      margin: 0;
    }
  </style>
</head>
<body>
  <div class="header-border">
    <h1>${displayTitle}</h1>
    <p class="meta">Glean 导出 &bull; 共 ${cues.length} 句台词 &bull; 导出日期: ${nowStr}</p>
  </div>
  <div>
    ${itemsHtml}
  </div>
</body>
</html>`;
}

/**
 * Open high-fidelity print-preview page and invoke window.print() for saving as vector PDF
 */
export function exportTranscriptPdf(cues: SubtitleCue[], options: TranscriptExportOptions = {}): void {
  const mode = options.mode || 'both';
  const includeTimestamps = options.includeTimestamps !== false;
  const rawTitle = options.title || '视频台词双语剧本';
  const displayTitle = escapeHtml(rawTitle);
  const nowStr = new Date().toLocaleDateString();

  const cuesHtml = cues.map((cue, idx) => {
    const timeBadge = includeTimestamps
      ? `<span class="badge">#${idx + 1} &nbsp;${formatTimestamp(cue.start)} - ${formatTimestamp(cue.end)}</span>`
      : `<span class="badge badge-subtle">#${idx + 1}</span>`;

    const enHtml = (mode === 'both' || mode === 'target') && cue.textEn
      ? `<div class="cue-en">${escapeHtml(cue.textEn)}</div>`
      : '';

    const zhHtml = (mode === 'both' || mode === 'translation') && (cue.textZh || (mode === 'translation' && cue.textEn))
      ? `<div class="cue-zh">${escapeHtml(cue.textZh || cue.textEn)}</div>`
      : '';

    return `
      <div class="cue-card">
        <div class="cue-top">${timeBadge}</div>
        ${enHtml}
        ${zhHtml}
      </div>
    `;
  }).join('');

  const htmlContent = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>${displayTitle} - 剧本打印与导出</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 32px 48px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif;
      color: #1e293b;
      background: #f8fafc;
      -webkit-font-smoothing: antialiased;
    }
    .print-bar {
      position: sticky;
      top: 0;
      z-index: 100;
      background: #0f172a;
      color: #fff;
      padding: 12px 24px;
      margin: -32px -48px 32px -48px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    .print-bar-title {
      font-size: 14px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .print-tip {
      font-size: 12px;
      color: #94a3b8;
    }
    .print-actions {
      display: flex;
      gap: 10px;
    }
    .btn {
      background: #3b82f6;
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s;
    }
    .btn:hover { background: #2563eb; }
    .btn-secondary {
      background: #334155;
      color: #cbd5e1;
    }
    .btn-secondary:hover { background: #475569; color: #fff; }
    .container {
      max-width: 860px;
      margin: 0 auto;
      background: #ffffff;
      padding: 48px;
      border-radius: 12px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .header {
      border-bottom: 2px solid #3b82f6;
      padding-bottom: 16px;
      margin-bottom: 28px;
    }
    .title {
      font-size: 24px;
      font-weight: 700;
      color: #0f172a;
      margin: 0 0 8px 0;
      line-height: 1.3;
    }
    .meta {
      font-size: 13px;
      color: #64748b;
      margin: 0;
    }
    .cue-card {
      margin-bottom: 18px;
      padding-bottom: 14px;
      border-bottom: 1px solid #f1f5f9;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .cue-top {
      margin-bottom: 6px;
    }
    .badge {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      font-weight: 600;
      color: #2563eb;
      background: #eff6ff;
      border: 1px solid #dbeafe;
      padding: 2px 8px;
      border-radius: 4px;
      display: inline-block;
    }
    .badge-subtle {
      color: #64748b;
      background: #f1f5f9;
      border-color: #e2e8f0;
    }
    .cue-en {
      font-size: 15px;
      font-weight: 600;
      color: #0f172a;
      line-height: 1.55;
      margin: 4px 0 3px 0;
    }
    .cue-zh {
      font-size: 13.5px;
      color: #475569;
      line-height: 1.5;
      margin: 0;
    }
    @page {
      size: A4;
      margin: 15mm 15mm 15mm 15mm;
    }
    @media print {
      body {
        background: #fff !important;
        padding: 0 !important;
      }
      .no-print {
        display: none !important;
      }
      .container {
        border: none !important;
        box-shadow: none !important;
        padding: 0 !important;
        max-width: 100% !important;
      }
      .cue-card {
        page-break-inside: avoid;
        break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="print-bar no-print">
    <div class="print-bar-title">
      <span>📄 Glean 高保真剧本导出</span>
      <span class="print-tip">提示：在打印对话框的目标设备中选择【另存为 PDF】即可保存精美排版文档</span>
    </div>
    <div class="print-actions">
      <button class="btn" onclick="window.print()">
        🖨 立即打印 / 另存为 PDF
      </button>
      <button class="btn btn-secondary" onclick="window.close()">
        ✕ 关闭
      </button>
    </div>
  </div>

  <div class="container">
    <div class="header">
      <h1 class="title">${displayTitle}</h1>
      <p class="meta">Glean 双语学习剧本 &bull; 共 ${cues.length} 句台词 &bull; 导出时间: ${nowStr}</p>
    </div>

    <div>
      ${cuesHtml}
    </div>
  </div>

  <script>
    window.addEventListener('load', function() {
      setTimeout(function() {
        window.print();
      }, 400);
    });
  </script>
</body>
</html>`;

  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    alert('浏览器拦截了弹出窗口，请在地址栏允许本站弹出窗口以导出 PDF。');
  }
}

/* =========================================================================
   2. SAVED VOCABULARY EXPORTERS (已存生词本导出)
   ========================================================================= */

/**
 * Filter saved words by mastery level
 */
function getFilteredWords(words: SavedWord[], filterLevel?: string): SavedWord[] {
  if (!filterLevel || filterLevel === 'all') return words;
  return words.filter(w => w.level === filterLevel);
}

/**
 * Generate vocabulary TXT
 */
export function generateVocabularyTxt(words: SavedWord[], options: VocabularyExportOptions = {}): string {
  const filtered = getFilteredWords(words, options.filterLevel);
  const title = options.title ? `${options.title}\n${'='.repeat(options.title.length)}\n\n` : 'Glean 生词本\n================\n\n';
  const lines = filtered.map(w => {
    const cefr = w.cefr ? ` [${w.cefr}]` : '';
    const phonetic = w.phonetic ? ` /${w.phonetic}/` : '';
    const trans = w.quickCn ? ` : ${w.quickCn}` : '';
    let item = `${w.word}${phonetic}${cefr}${trans}`;
    if (w.contextSentenceEn) {
      item += `\n   例: "${w.contextSentenceEn}"`;
      if (w.contextSentenceZh) {
        item += `\n       ${w.contextSentenceZh}`;
      }
    }
    return item;
  });
  return `${title}${lines.join('\n\n')}\n`;
}

/**
 * Generate vocabulary CSV with UTF-8 BOM
 */
export function generateVocabularyCsv(words: SavedWord[], options: VocabularyExportOptions = {}): string {
  const filtered = getFilteredWords(words, options.filterLevel);
  const BOM = '\uFEFF';
  const header = 'Word,Phonetic,CEFR,Translation,Context_EN,Context_ZH,Level,Saved_At\n';
  const rows = filtered.map(w => {
    const word = `"${w.word.replace(/"/g, '""')}"`;
    const phonetic = `"${(w.phonetic || '').replace(/"/g, '""')}"`;
    const cefr = `"${(w.cefr || '').replace(/"/g, '""')}"`;
    const trans = `"${(w.quickCn || '').replace(/"/g, '""')}"`;
    const en = `"${(w.contextSentenceEn || '').replace(/"/g, '""')}"`;
    const zh = `"${(w.contextSentenceZh || '').replace(/"/g, '""')}"`;
    const level = `"${w.level || 'learning'}"`;
    const savedAt = `"${new Date(w.timestamp || Date.now()).toISOString()}"`;
    return `${word},${phonetic},${cefr},${trans},${en},${zh},${level},${savedAt}`;
  }).join('\n');
  return BOM + header + rows;
}

/**
 * Generate vocabulary JSON
 */
export function generateVocabularyJson(words: SavedWord[], options: VocabularyExportOptions = {}): string {
  const filtered = getFilteredWords(words, options.filterLevel);
  const data = {
    title: options.title || 'Glean Saved Vocabulary',
    exportTime: new Date().toISOString(),
    totalWords: filtered.length,
    words: filtered
  };
  return JSON.stringify(data, null, 2);
}

/**
 * Generate vocabulary Anki format (Tab-separated)
 */
export function generateVocabularyAnki(words: SavedWord[], options: VocabularyExportOptions = {}): string {
  const filtered = getFilteredWords(words, options.filterLevel);
  return filtered.map(w => {
    const word = w.word.replace(/\t/g, ' ');
    const phonetic = (w.phonetic || '').replace(/\t/g, ' ');
    const trans = (w.quickCn || '').replace(/\t/g, ' ');
    const en = (w.contextSentenceEn || '').replace(/\t/g, ' ').replace(/\n/g, ' ');
    const zh = (w.contextSentenceZh || '').replace(/\t/g, ' ').replace(/\n/g, ' ');
    const level = w.level || 'learning';
    const cefr = w.cefr || '';
    return `${word}\t${phonetic}\t${trans}\t${en}\t${zh}\t${level}\t${cefr}`;
  }).join('\n');
}

/**
 * Generate vocabulary Word (.doc)
 */
export function generateVocabularyWordHtml(words: SavedWord[], options: VocabularyExportOptions = {}): string {
  const filtered = getFilteredWords(words, options.filterLevel);
  const rawTitle = options.title || 'Glean 生词本词汇卡';
  const displayTitle = escapeHtml(rawTitle);
  const nowStr = new Date().toLocaleDateString();

  const rowsHtml = filtered.map(w => `
    <tr>
      <td style="font-weight: bold; color: #0f172a; font-size: 11pt;">${escapeHtml(w.word)}</td>
      <td style="font-family: monospace; color: #64748b; font-size: 9.5pt;">${escapeHtml(w.phonetic || '')}</td>
      <td style="color: #2563eb; font-weight: 600; font-size: 9.5pt;">${escapeHtml(w.cefr || '-')}</td>
      <td style="color: #334155; font-size: 10pt;">${escapeHtml(w.quickCn || '')}</td>
      <td style="color: #475569; font-size: 9.5pt;">${escapeHtml(w.contextSentenceEn || '')}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
  <meta charset='utf-8'>
  <title>${displayTitle}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
      line-height: 1.5;
      padding: 36px 48px;
    }
    h1 { font-size: 18pt; color: #0f172a; margin: 0 0 6px 0; }
    .header-border { border-bottom: 2px solid #3b82f6; padding-bottom: 12px; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th { background: #f8fafc; color: #334155; padding: 10px; border: 1px solid #cbd5e1; text-align: left; font-size: 10pt; }
    td { padding: 10px; border: 1px solid #e2e8f0; vertical-align: top; }
  </style>
</head>
<body>
  <div class="header-border">
    <h1>${displayTitle}</h1>
    <p style="font-size: 9.5pt; color: #64748b; margin: 0;">共 ${filtered.length} 个生词 &bull; 导出日期: ${nowStr}</p>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width: 20%;">单词</th>
        <th style="width: 15%;">音标</th>
        <th style="width: 10%;">等级</th>
        <th style="width: 25%;">中文释义</th>
        <th style="width: 30%;">例句语境</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>
</body>
</html>`;
}

/**
 * Open vocabulary PDF printable preview
 */
export function exportVocabularyPdf(words: SavedWord[], options: VocabularyExportOptions = {}): void {
  const filtered = getFilteredWords(words, options.filterLevel);
  const rawTitle = options.title || 'Glean 生词本词汇卡';
  const displayTitle = escapeHtml(rawTitle);
  const nowStr = new Date().toLocaleDateString();

  const cardsHtml = filtered.map(w => `
    <div class="word-card">
      <div class="word-header">
        <span class="word-title">${escapeHtml(w.word)}</span>
        ${w.phonetic ? `<span class="word-phonetic">/${escapeHtml(w.phonetic)}/</span>` : ''}
        ${w.cefr ? `<span class="word-cefr">${escapeHtml(w.cefr)}</span>` : ''}
      </div>
      <div class="word-trans">${escapeHtml(w.quickCn || '')}</div>
      ${w.contextSentenceEn ? `<div class="word-example-en">"${escapeHtml(w.contextSentenceEn)}"</div>` : ''}
      ${w.contextSentenceZh ? `<div class="word-example-zh">${escapeHtml(w.contextSentenceZh)}</div>` : ''}
    </div>
  `).join('');

  const htmlContent = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>${displayTitle} - 打印与导出</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 32px 48px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif;
      color: #1e293b;
      background: #f8fafc;
    }
    .print-bar {
      position: sticky;
      top: 0;
      z-index: 100;
      background: #0f172a;
      color: #fff;
      padding: 12px 24px;
      margin: -32px -48px 32px -48px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    .btn {
      background: #3b82f6;
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-secondary { background: #334155; margin-left: 8px; }
    .container {
      max-width: 860px;
      margin: 0 auto;
      background: #ffffff;
      padding: 48px;
      border-radius: 12px;
      border: 1px solid #e2e8f0;
    }
    .header {
      border-bottom: 2px solid #3b82f6;
      padding-bottom: 16px;
      margin-bottom: 28px;
    }
    .word-card {
      margin-bottom: 16px;
      padding: 14px 18px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .word-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 6px;
    }
    .word-title {
      font-size: 16px;
      font-weight: 700;
      color: #0f172a;
    }
    .word-phonetic {
      font-family: monospace;
      font-size: 13px;
      color: #64748b;
    }
    .word-cefr {
      font-size: 11px;
      font-weight: 700;
      color: #2563eb;
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      padding: 1px 6px;
      border-radius: 4px;
    }
    .word-trans {
      font-size: 14px;
      color: #334155;
      font-weight: 500;
      margin-bottom: 6px;
    }
    .word-example-en {
      font-size: 12.5px;
      color: #475569;
      font-style: italic;
    }
    .word-example-zh {
      font-size: 12px;
      color: #64748b;
      margin-top: 2px;
    }
    @page { size: A4; margin: 15mm; }
    @media print {
      body { background: #fff !important; padding: 0 !important; }
      .no-print { display: none !important; }
      .container { border: none !important; padding: 0 !important; max-width: 100% !important; }
      .word-card { page-break-inside: avoid; break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="print-bar no-print">
    <div>
      <span style="font-size: 14px; font-weight: 600;">📚 Glean 生词本导出</span>
      <span style="font-size: 12px; color: #94a3b8; margin-left: 12px;">在打印对话框中选择【另存为 PDF】</span>
    </div>
    <div>
      <button class="btn" onclick="window.print()">🖨 打印 / 另存为 PDF</button>
      <button class="btn btn-secondary" onclick="window.close()">✕ 关闭</button>
    </div>
  </div>
  <div class="container">
    <div class="header">
      <h1 style="font-size: 24px; margin: 0 0 6px 0;">${displayTitle}</h1>
      <p style="font-size: 13px; color: #64748b; margin: 0;">共 ${filtered.length} 个生词 &bull; 导出时间: ${nowStr}</p>
    </div>
    <div>${cardsHtml}</div>
  </div>
  <script>
    window.addEventListener('load', function() {
      setTimeout(function() { window.print(); }, 400);
    });
  </script>
</body>
</html>`;

  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    alert('浏览器拦截了弹出窗口，请在地址栏允许本站弹出窗口以导出 PDF。');
  }
}

/* =========================================================================
   3. UNIFIED DISPATCHERS
   ========================================================================= */

/**
 * Export transcript according to specified format
 */
export function exportTranscript(
  cues: SubtitleCue[],
  format: ExportFormat,
  options: TranscriptExportOptions = {}
): void {
  const rawTitle = options.title || 'Glean_Transcript';
  const cleanTitle = sanitizeFilename(rawTitle);

  switch (format) {
    case 'word': {
      const content = generateTranscriptWordHtml(cues, options);
      triggerFileDownload(content, `${cleanTitle}_双语剧本.doc`, 'application/msword;charset=utf-8');
      break;
    }
    case 'pdf': {
      exportTranscriptPdf(cues, options);
      break;
    }
    case 'txt': {
      const content = generateTranscriptTxt(cues, options);
      triggerFileDownload(content, `${cleanTitle}_台词.txt`, 'text/plain;charset=utf-8');
      break;
    }
    case 'srt': {
      const content = generateTranscriptSrt(cues, options);
      triggerFileDownload(content, `${cleanTitle}.srt`, 'text/plain;charset=utf-8');
      break;
    }
    case 'csv': {
      const content = generateTranscriptCsv(cues, options);
      triggerFileDownload(content, `${cleanTitle}_台词.csv`, 'text/csv;charset=utf-8');
      break;
    }
    case 'json': {
      const content = generateTranscriptJson(cues, options);
      triggerFileDownload(content, `${cleanTitle}_台词.json`, 'application/json;charset=utf-8');
      break;
    }
    case 'anki': {
      const content = generateTranscriptAnki(cues, options);
      triggerFileDownload(content, `${cleanTitle}_Anki.txt`, 'text/plain;charset=utf-8');
      break;
    }
  }
}

/**
 * Export saved vocabulary according to specified format
 */
export function exportVocabulary(
  words: SavedWord[],
  format: ExportFormat,
  options: VocabularyExportOptions = {}
): void {
  const rawTitle = options.title || 'Glean_Vocabulary';
  const cleanTitle = sanitizeFilename(rawTitle);

  switch (format) {
    case 'word': {
      const content = generateVocabularyWordHtml(words, options);
      triggerFileDownload(content, `${cleanTitle}_词汇表.doc`, 'application/msword;charset=utf-8');
      break;
    }
    case 'pdf': {
      exportVocabularyPdf(words, options);
      break;
    }
    case 'txt': {
      const content = generateVocabularyTxt(words, options);
      triggerFileDownload(content, `${cleanTitle}.txt`, 'text/plain;charset=utf-8');
      break;
    }
    case 'srt': {
      // Fallback to txt for vocabulary
      const content = generateVocabularyTxt(words, options);
      triggerFileDownload(content, `${cleanTitle}.txt`, 'text/plain;charset=utf-8');
      break;
    }
    case 'csv': {
      const content = generateVocabularyCsv(words, options);
      triggerFileDownload(content, `${cleanTitle}_词汇表.csv`, 'text/csv;charset=utf-8');
      break;
    }
    case 'json': {
      const content = generateVocabularyJson(words, options);
      triggerFileDownload(content, `${cleanTitle}_词汇表.json`, 'application/json;charset=utf-8');
      break;
    }
    case 'anki': {
      const content = generateVocabularyAnki(words, options);
      triggerFileDownload(content, `${cleanTitle}_Anki.txt`, 'text/plain;charset=utf-8');
      break;
    }
  }
}
