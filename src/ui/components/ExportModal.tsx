import React, { useEffect, useRef, useState } from 'react';
import { Download, X, FileText, Sparkles, FileJson, FileSpreadsheet, Film, Check, Printer } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { getLocale } from '@/core/i18n';
import {
  ExportFormat,
  ExportLanguageMode,
  exportTranscript,
  exportVocabulary,
  sanitizeFilename
} from '@/core/export/exportManager';

interface FormatOption {
  id: ExportFormat;
  name: string;
  extension: string;
  description: string;
  icon: React.ReactNode;
  badge?: string;
  isPopular?: boolean;
}

export const ExportModal: React.FC = () => {
  const {
    isExportModalOpen,
    setExportModalOpen,
    cues,
    savedWords,
    videoTitle,
    settings
  } = useAppStore();

  const t = getLocale(settings.uiLanguage);
  const dialogRef = useRef<HTMLElement>(null);

  const [scope, setScope] = useState<'transcript' | 'vocabulary'>('transcript');
  const [transcriptMode, setTranscriptMode] = useState<ExportLanguageMode>('both');
  const [includeTimestamps, setIncludeTimestamps] = useState<boolean>(true);
  const [vocabFilter, setVocabFilter] = useState<'all' | 'learning' | 'known' | 'mastered'>('all');
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('word');
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isExportModalOpen) return;
    const prev = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => prev?.focus();
  }, [isExportModalOpen]);

  if (!isExportModalOpen) return null;

  const handleClose = () => {
    setExportModalOpen(false);
    setFeedbackMessage(null);
  };

  const handleTriggerExport = (formatToUse?: ExportFormat) => {
    const format = formatToUse || selectedFormat;
    const title = videoTitle || (scope === 'transcript' ? '全片台词剧本' : 'Glean生词本');

    try {
      if (scope === 'transcript') {
        exportTranscript(cues, format, {
          mode: transcriptMode,
          includeTimestamps,
          title
        });
      } else {
        exportVocabulary(savedWords, format, {
          filterLevel: vocabFilter,
          title
        });
      }

      setFeedbackMessage(format === 'pdf' ? '已调起高保真打印窗口！' : '文件已开始下载！');
      setTimeout(() => setFeedbackMessage(null), 3500);
    } catch (err: any) {
      console.error('[Glean] Export failed:', err);
      alert(`导出遇到错误: ${err?.message || '未知错误'}`);
    }
  };

  const formats: FormatOption[] = [
    {
      id: 'word',
      name: 'Word 文档',
      extension: '.doc',
      description: '排版精美，支持 Word 与 WPS 阅读编辑',
      icon: <FileText className="text-blue-400" size={22} />,
      badge: '推荐',
      isPopular: true
    },
    {
      id: 'pdf',
      name: '高保真 PDF',
      extension: '.pdf',
      description: '打开专属排版页，1键另存为高清矢量 PDF',
      icon: <Printer className="text-rose-400" size={22} />,
      badge: '推荐',
      isPopular: true
    },
    {
      id: 'txt',
      name: '纯文本',
      extension: '.txt',
      description: '干净无格式剧本，适合直接导入笔记软件',
      icon: <FileText className="text-gray-400" size={22} />
    },
    {
      id: 'srt',
      name: 'SRT 字幕',
      extension: '.srt',
      description: '标准时间轴字幕，可导入任何播放器使用',
      icon: <Film className="text-amber-400" size={22} />
    },
    {
      id: 'csv',
      name: 'Excel 表格',
      extension: '.csv',
      description: 'UTF-8 BOM 编码，Excel 双击直接打开不乱码',
      icon: <FileSpreadsheet className="text-emerald-400" size={22} />
    },
    {
      id: 'json',
      name: '结构化 JSON',
      extension: '.json',
      description: '保留全部字段结构，方便数据归档与开发者接入',
      icon: <FileJson className="text-purple-400" size={22} />
    },
    {
      id: 'anki',
      name: 'Anki 闪卡',
      extension: '.txt',
      description: '制表符卡片格式，一键导入 Anki 牌组复习',
      icon: <Sparkles className="text-cyan-400" size={22} />
    }
  ];

  const totalCuesCount = cues.length;
  const filteredWordsCount = vocabFilter === 'all'
    ? savedWords.length
    : savedWords.filter(w => w.level === vocabFilter).length;

  return (
    <div
      className="fixed inset-0 z-[9999999] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={handleClose}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lr-export-modal-title"
        className="w-[720px] max-w-full max-h-[92vh] flex flex-col rounded-2xl border border-white/15 bg-[#14171a] text-gray-100 shadow-[0_24px_80px_rgba(0,0,0,.65)] font-sans overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') handleClose();
        }}
      >
        {/* Modal Header */}
        <header className="flex items-center justify-between border-b border-white/10 bg-[#191d21] px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/15 text-cyan-400 border border-cyan-500/20">
              <Download size={19} />
            </span>
            <div>
              <h2 id="lr-export-modal-title" className="text-base font-bold text-white tracking-wide">
                导出字幕与生词
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                支持 Word、PDF、SRT、Excel 等 7 种主流格式自由选择导出
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
            title="关闭 (Esc)"
          >
            <X size={18} />
          </button>
        </header>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          
          {/* 1. Scope Switcher */}
          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-2">
              1. 选择导出内容
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setScope('transcript')}
                className={`flex items-center justify-between p-3.5 rounded-xl border transition-all text-left ${
                  scope === 'transcript'
                    ? 'border-cyan-500 bg-cyan-500/10 text-white shadow-sm'
                    : 'border-white/10 bg-[#1c2025] text-gray-300 hover:border-white/20'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">📄</span>
                  <div>
                    <div className="text-sm font-bold">全片台词剧本</div>
                    <div className="text-xs text-gray-400 mt-0.5">共 {totalCuesCount} 句台词</div>
                  </div>
                </div>
                {scope === 'transcript' && <Check size={18} className="text-cyan-400" />}
              </button>

              <button
                type="button"
                onClick={() => setScope('vocabulary')}
                className={`flex items-center justify-between p-3.5 rounded-xl border transition-all text-left ${
                  scope === 'vocabulary'
                    ? 'border-cyan-500 bg-cyan-500/10 text-white shadow-sm'
                    : 'border-white/10 bg-[#1c2025] text-gray-300 hover:border-white/20'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">📚</span>
                  <div>
                    <div className="text-sm font-bold">已存生词本</div>
                    <div className="text-xs text-gray-400 mt-0.5">共 {savedWords.length} 个重点单词</div>
                  </div>
                </div>
                {scope === 'vocabulary' && <Check size={18} className="text-cyan-400" />}
              </button>
            </div>
          </div>

          {/* 2. Options per Scope */}
          {scope === 'transcript' ? (
            <div className="bg-[#1a1e23] border border-white/10 rounded-xl p-4 space-y-3.5">
              <div className="text-xs font-semibold text-gray-300">台词剧本导出选项</div>
              
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <span className="text-gray-400">语言内容:</span>
                <div className="inline-flex rounded-lg bg-[#14171a] p-1 border border-white/10">
                  <button
                    type="button"
                    onClick={() => setTranscriptMode('both')}
                    className={`px-3 py-1 rounded-md transition-colors ${
                      transcriptMode === 'both' ? 'bg-cyan-500 text-white font-bold' : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    中英双语对照
                  </button>
                  <button
                    type="button"
                    onClick={() => setTranscriptMode('target')}
                    className={`px-3 py-1 rounded-md transition-colors ${
                      transcriptMode === 'target' ? 'bg-cyan-500 text-white font-bold' : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    仅英文原句
                  </button>
                  <button
                    type="button"
                    onClick={() => setTranscriptMode('translation')}
                    className={`px-3 py-1 rounded-md transition-colors ${
                      transcriptMode === 'translation' ? 'bg-cyan-500 text-white font-bold' : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    仅中文译文
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1 border-t border-white/5">
                <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includeTimestamps}
                    onChange={(e) => setIncludeTimestamps(e.target.checked)}
                    className="rounded border-gray-600 bg-gray-700 text-cyan-500 focus:ring-cyan-400 w-4 h-4 cursor-pointer"
                  />
                  <span>包含时间戳徽章（适用于打印文档与纯文本剧本）</span>
                </label>
              </div>
            </div>
          ) : (
            <div className="bg-[#1a1e23] border border-white/10 rounded-xl p-4 space-y-3">
              <div className="text-xs font-semibold text-gray-300">生词过滤选项</div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-gray-400 mr-1">掌握等级:</span>
                {(['all', 'learning', 'known', 'mastered'] as const).map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setVocabFilter(lvl)}
                    className={`px-3 py-1.5 rounded-lg border transition-colors ${
                      vocabFilter === lvl
                        ? 'border-cyan-500 bg-cyan-500/20 text-cyan-300 font-bold'
                        : 'border-white/10 bg-[#14171a] text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {lvl === 'all' && `全部 (${savedWords.length})`}
                    {lvl === 'learning' && '学习中'}
                    {lvl === 'known' && '已掌握'}
                    {lvl === 'mastered' && '熟练掌握'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 3. Format Selection Grid */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block">
                2. 选择导出格式
              </label>
              <span className="text-[11px] text-gray-500">点击选中格式，点击下方按钮开始导出</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {formats.map((fmt) => {
                const isSelected = selectedFormat === fmt.id;
                // If scope is vocabulary and format is SRT, explain that it will fallback to txt or disable
                const isSrtForVocab = scope === 'vocabulary' && fmt.id === 'srt';

                return (
                  <button
                    key={fmt.id}
                    type="button"
                    onClick={() => setSelectedFormat(fmt.id)}
                    className={`group relative p-3 rounded-xl border cursor-pointer transition-all text-left ${
                      isSelected
                        ? 'border-cyan-500 bg-cyan-500/10 shadow-[0_0_15px_rgba(6,182,212,0.15)] ring-1 ring-cyan-500'
                        : 'border-white/10 bg-[#1c2025] hover:border-white/25 hover:bg-[#22272d]'
                    }`}
                  >
                    <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
                      {fmt.badge && (
                        <span className="text-[10px] bg-gradient-to-r from-blue-600 to-cyan-600 text-white font-bold px-1.5 py-0.5 rounded shadow-sm">
                          {fmt.badge}
                        </span>
                      )}
                      {isSelected && (
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-cyan-500 text-black shadow-sm">
                          <Check size={11} strokeWidth={3} />
                        </span>
                      )}
                    </div>

                    <div className="flex items-start gap-2.5">
                      <div className={`p-2 rounded-lg border transition-transform shrink-0 ${
                        isSelected
                          ? 'bg-cyan-500/20 border-cyan-500/30'
                          : 'bg-[#14171a] border-white/5 group-hover:scale-105'
                      }`}>
                        {fmt.icon}
                      </div>
                      <div className="min-w-0 flex-1 pr-6">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-sm font-bold transition-colors truncate ${
                            isSelected ? 'text-cyan-300' : 'text-white group-hover:text-cyan-300'
                          }`}>
                            {fmt.name}
                          </span>
                          <span className="text-[11px] text-gray-400 font-mono">
                            {fmt.extension}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-400 mt-1 leading-snug line-clamp-2">
                          {isSrtForVocab ? '生词本不支持 SRT，将导出纯文本' : fmt.description}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <footer className="border-t border-white/10 bg-[#191d21] px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {feedbackMessage ? (
              <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium bg-emerald-950/60 border border-emerald-800 px-3 py-1.5 rounded-lg animate-in fade-in">
                <Check size={14} />
                <span>{feedbackMessage}</span>
              </div>
            ) : (
              <span className="text-xs text-gray-400">
                当前准备导出：
                <strong className="text-gray-200">
                  {scope === 'transcript' ? `全片 ${totalCuesCount} 句台词` : `${filteredWordsCount} 个生词`}
                </strong>
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
            >
              关闭
            </button>
            <button
              type="button"
              onClick={() => handleTriggerExport()}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white shadow-lg active:scale-95 transition-all"
            >
              <Download size={14} />
              <span>立即导出 {formats.find(f => f.id === selectedFormat)?.name}</span>
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
};
