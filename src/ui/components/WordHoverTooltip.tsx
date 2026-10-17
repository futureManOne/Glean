import React from 'react';
import { WordToken } from '@/types';
import { lookupLocalDict } from '@/core/dictionary/ecdictMini';

interface WordHoverTooltipProps {
  token: WordToken;
  sentenceEn: string;
  sentenceZh: string;
  anchorRect: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  onClick: () => void;
}

/**
 * Helper to strip bracketed lemma prefixes from display dictionary text
 */
function formatDisplayTrans(trans: string, lemmaText?: string): string {
  if (!trans) return '暂无释义';
  let clean = trans;
  if (lemmaText) {
    clean = clean.replace(new RegExp(`^\\[${lemmaText}\\]\\s*`, 'i'), '');
  }
  clean = clean.replace(/^\[[a-zA-Z0-9_\s'-]+\]\s*/, '');
  return clean.trim() || trans;
}

/**
 * Extract the most accurate contextual meaning of the word in the current sentence.
 * Strips bracketed lemmas like [preload] and ensures only clean Chinese meanings are selected.
 */
function extractContextualMeaning(
  word: string,
  lemma: string | undefined,
  trans: string,
  sentenceZh: string
): string {
  if (!trans || trans.includes('暂无离线释义') || trans.includes('暂无本地释义')) {
    return '无离线释义';
  }

  // Split multiple translations and strip [lemma] prefixes, part of speech, and parenthetical notes
  const definitions = trans
    .split(/[\n,，;；/、]/)
    .map(s => {
      return s
        .replace(/\[[a-zA-Z0-9_\s'-]+\]/g, '')
        .replace(/【.*?】/g, '')
        .replace(/^[a-z./\s]+\.\s*/i, '')
        .replace(/[（(].*?[）)]/g, '')
        .trim();
    })
    .filter(s => /[\u4e00-\u9fa5]/.test(s));

  if (definitions.length === 0) {
    return '无离线释义';
  }

  if (!sentenceZh || definitions.length <= 1) {
    return definitions[0];
  }

  // Look for direct match in the Chinese sentence
  for (const def of definitions) {
    if (def.length >= 2 && sentenceZh.includes(def)) {
      return def;
    }
  }

  // Look for 2-character submatch for compound verbs/nouns
  for (const def of definitions) {
    if (def.length > 2) {
      for (let i = 0; i <= def.length - 2; i++) {
        const sub = def.slice(i, i + 2);
        if (sentenceZh.includes(sub) && !['进行', '可以', '这个', '那个', '因为'].includes(sub)) {
          return def;
        }
      }
    }
  }

  return definitions[0];
}

export const WordHoverTooltip: React.FC<WordHoverTooltipProps> = ({
  token,
  sentenceEn,
  sentenceZh,
  anchorRect,
  onClick
}) => {
  if (!token.isWord) return null;

  const dictEntry = lookupLocalDict(token.lemma || token.text);
  const contextMeaning = extractContextualMeaning(
    token.text,
    token.lemma,
    dictEntry.trans,
    sentenceZh
  );

  const lemmaMatch = dictEntry.trans.match(/^\[([a-zA-Z0-9_\s'-]+)\]/);
  const displayLemma = dictEntry.lemma || (lemmaMatch ? lemmaMatch[1] : undefined);
  const displayTrans = formatDisplayTrans(dictEntry.trans, displayLemma);

  const tooltipWidth = 280;
  let left = anchorRect.left + anchorRect.width / 2 - tooltipWidth / 2;
  left = Math.max(12, Math.min(left, window.innerWidth - tooltipWidth - 12));

  // Determine whether to show above or below anchor
  const showAbove = anchorRect.top >= 120;
  const top = showAbove ? anchorRect.top - 8 : anchorRect.bottom + 8;
  const arrowLeft = Math.max(12, Math.min(tooltipWidth - 16, anchorRect.left + anchorRect.width / 2 - left));

  const isPhrase = Boolean(token.isKeyPhrase && token.phraseText);
  const displayTitle = isPhrase ? token.phraseText! : token.text;
  const activeContextMeaning = isPhrase && token.phraseMeaning ? token.phraseMeaning : contextMeaning;

  return (
    <div
      className="fixed z-[999997] w-[280px] bg-[#0e1219]/92 backdrop-blur-xl text-white rounded-xl shadow-[0_12px_36px_-6px_rgba(0,0,0,0.7),0_0_1px_1px_rgba(255,255,255,0.12)] border border-white/15 px-3.5 py-2.5 select-none pointer-events-auto transition-all animate-in fade-in zoom-in-95 duration-100 font-sans ring-1 ring-black/40"
      style={{
        left: `${left}px`,
        top: `${top}px`,
        transform: showAbove ? 'translateY(-100%)' : 'none'
      }}
      onClick={e => {
        e.stopPropagation();
        onClick();
      }}
    >
      {/* Downward or upward triangle pointer arrow */}
      <div
        className={`absolute w-2.5 h-2.5 bg-[#0e1219] border-white/15 rotate-45 z-10 ${
          showAbove ? '-bottom-[5px] border-b border-r' : '-top-[5px] border-t border-l'
        }`}
        style={{ left: `${arrowLeft}px` }}
      />

      {/* Header: Word/Phrase + Phonetic + CEFR Tag + POS */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-1.5 truncate">
          <span className="font-bold text-sm text-white tracking-tight truncate drop-shadow-sm">{displayTitle}</span>
          {!isPhrase && dictEntry.phonetic && (
            <span className="text-[11px] text-cyan-200/90 font-mono bg-cyan-950/50 px-1.5 py-0.2 rounded border border-cyan-500/20 shrink-0">
              {dictEntry.phonetic}
            </span>
          )}
        </div>
        <div className="flex items-center space-x-1.5 shrink-0 ml-1.5">
          {isPhrase ? (
            <span className="text-[10px] bg-amber-500/15 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded-full font-medium shadow-sm">
              表意短语
            </span>
          ) : (
            <>
              {dictEntry.pos && (
                <span className="text-[10px] text-gray-400 font-mono italic">{dictEntry.pos}</span>
              )}
              {dictEntry.cefr && (
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold uppercase tracking-wider ${
                  dictEntry.cefr === 'A1' || dictEntry.cefr === 'A2'
                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                    : dictEntry.cefr === 'B1' || dictEntry.cefr === 'B2'
                    ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                    : 'bg-purple-500/15 text-purple-300 border border-purple-500/30'
                }`}>
                  {dictEntry.cefr}
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* Primary Contextual Meaning (本句释义) */}
      <div className="mt-2 bg-gradient-to-r from-amber-500/15 to-amber-500/5 border border-amber-500/30 rounded-lg px-2.5 py-1.5 flex items-baseline space-x-1.5 shadow-sm">
        <span className="text-[11px] text-amber-400 font-semibold shrink-0">🎯 本句释义:</span>
        <span className="text-xs text-amber-200 font-bold truncate tracking-wide">{activeContextMeaning}</span>
      </div>

      {/* Standard Dictionary Definition */}
      <div className="mt-1.5 text-[11px] text-gray-300/90 leading-relaxed line-clamp-2">
        <span className="text-gray-400 mr-1 font-medium">词典:</span>
        {displayLemma && displayLemma.toLowerCase() !== token.text.toLowerCase() && (
          <span className="inline-block bg-cyan-950/60 border border-cyan-500/30 text-cyan-300 text-[9px] px-1.5 py-0.2 rounded font-mono mr-1">
            原型: {displayLemma}
          </span>
        )}
        <span>{displayTrans}</span>
      </div>

      {/* Interactive Micro-hint */}
      <div className="mt-2 pt-1.5 border-t border-white/10 flex items-center justify-between text-[10px] text-gray-400">
        <span className="text-cyan-400/90 flex items-center gap-1 font-medium">
          <span>🖱️</span>
          <span>点击暂停播放并展开完整 AI 语法卡片</span>
        </span>
      </div>
    </div>
  );
};
