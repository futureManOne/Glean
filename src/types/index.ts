export type MasteryLevel = 'new' | 'learning' | 'known' | 'mastered';
export type CEFRLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export interface PopupPosition {
  x: number;
  y: number;
  placement?: 'top' | 'bottom';
  arrowOffset?: number;
}

export interface WordToken {
  id: string;
  text: string;
  isWord: boolean;
  lemma?: string;
  level?: MasteryLevel;
  cefr?: CEFRLevel;
  contextMeaning?: string; // 精准中文语境释义 (如 "表现", "进展")
  phraseId?: string;       // 所属短语唯一ID (如 "phrase-1")
  phraseText?: string;     // 完整短语原文 (如 "getting used to")
  phraseMeaning?: string;  // 完整短语上下文释义 (如 "习惯于")
  isKeyPhrase?: boolean;   // 是否为高亮表意短语
  isPhraseStart?: boolean; // 是否为短语首词
  isPhraseEnd?: boolean;   // 是否为短语尾词 (释义在此词后展示)
}

export interface PhraseGlossItem {
  phrase: string;          // 英文短语或表意词组 (如 "getting used to", "image generation")
  meaning: string;         // 精确上下文中文释义 (如 "习惯于", "图像生成")
}

export interface SubtitleCue {
  id: number;
  start: number; // in seconds
  end: number;   // in seconds
  textEn: string;
  textZh: string;
  tokens?: WordToken[];
  mixedPhrases?: PhraseGlossItem[];
  isAiRefined?: boolean;
  isMixedRefined?: boolean;
}

export interface WordDefinition {
  pos: string;      // e.g. noun, verb, adj
  meaning: string;  // e.g. 生产率, 效率, 生产力
}

export interface WordExample {
  en: string;
  zh: string;
  highlightWord?: string;
  meaningExplanation?: string; // 语境词义与用法解释
  grammarExplanation?: string; // 语法结构与句法功能解析
}

export interface WordSentenceComparison {
  currentUsage: string;    // 本句用法深度分析
  contrastUsage: string;   // 与常见其它用法/同义近义词辨析
  nuanceTip: string;       // 语感与使用避坑要点
}

export interface WordCollocation {
  phrase: string;          // e.g. "boost productivity"
  translation: string;     // e.g. "大幅提高工作效率"
}

export interface WordExplanation {
  word: string;
  phonetic: string;
  quickCn: string;
  contextSentenceEn: string;
  contextSentenceZh: string;
  contextExplanation: string; // e.g. 在这个句子中，"productivity" 指的是...
  contextIntent?: string;     // 说话人语用意图与修辞色彩
  wordPosition?: string;      // 句子中的语法位置说明
  definitions: WordDefinition[];
  examples: WordExample[];
  aiExtendedExamples?: WordExample[]; // AI 生成的 3 句拓展例句，包含语法与词义解释
  grammar: string;            // 确切语法角色
  sentenceComparison?: WordSentenceComparison;
  collocations?: WordCollocation[];
  level: MasteryLevel;
  cefr?: CEFRLevel;
  collins?: number;
  audioUrl?: string;
  source?: 'grok-ai' | 'google' | 'offline-rich' | 'ecdict-mini' | 'ai';
  aiModel?: string;
  isFallback?: boolean;
  fallbackReason?: string;
}

export interface SavedWord {
  id: string;
  word: string;
  phonetic: string;
  quickCn: string;
  contextSentenceEn: string;
  contextSentenceZh: string;
  timestamp: number;
  level: MasteryLevel;
  cefr?: CEFRLevel;
  collins?: number;
  tags?: string[];
}

export type AiProvider = 'sub2api' | 'grok' | 'deepseek' | 'openai' | 'google' | 'custom';

export interface AiPreset {
  name: string;
  provider: AiProvider;
  apiBaseUrl: string;
  modelName: string;
  defaultKeyHint?: string;
  description?: string;
}

export const AI_PRESETS: Record<AiProvider, AiPreset> = {
  sub2api: {
    name: '第三方网关 (Custom Gateway)',
    provider: 'sub2api',
    apiBaseUrl: 'https://api.your-gateway.com/v1',
    modelName: 'gpt-4o',
    defaultKeyHint: 'sk-...',
    description: '第三方 OpenAI 兼容网关，请填入您信任的网关地址与 API Key'
  },
  grok: {
    name: 'xAI Grok',
    provider: 'grok',
    apiBaseUrl: 'https://api.x.ai/v1',
    modelName: 'grok-2-latest',
    defaultKeyHint: 'xai-...',
    description: 'xAI 官方 Grok 模型接口或兼容中转网关'
  },
  deepseek: {
    name: 'DeepSeek',
    provider: 'deepseek',
    apiBaseUrl: 'https://api.deepseek.com/v1',
    modelName: 'deepseek-chat',
    defaultKeyHint: 'sk-...',
    description: 'DeepSeek V3 高速通用模型'
  },
  openai: {
    name: 'OpenAI',
    provider: 'openai',
    apiBaseUrl: 'https://api.openai.com/v1',
    modelName: 'gpt-4o-mini',
    defaultKeyHint: 'sk-...',
    description: 'GPT-4o mini 官方标准接口'
  },
  google: {
    name: 'Google Gemini',
    provider: 'google',
    apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelName: 'gemini-2.5-flash',
    defaultKeyHint: 'AIzaSy...',
    description: 'Google Gemini 高速多模态大模型'
  },
  custom: {
    name: '自定义 (Custom)',
    provider: 'custom',
    apiBaseUrl: '',
    modelName: '',
    defaultKeyHint: 'sk-...',
    description: '任意 OpenAI 兼容的大模型网关'
  }
};

export interface LlmConfig {
  apiKey: string;
  apiBaseUrl: string;
  modelName: string;
  timeoutMs?: number;
}

export interface ConnectionTestResult {
  success: boolean;
  latencyMs: number;
  modelsCount?: number;
  modelUsed?: string;
  errorMessage?: string;
  availableModels?: string[];
}

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmChatParams {
  messages: LlmChatMessage[];
  temperature?: number;
  responseFormatJson?: boolean;
  maxTokens?: number;
}

export type SubtitleMode = 'both' | 'mixed' | 'target' | 'translation' | 'hidden';
export type SupportedLang = 'zh-CN' | 'en' | 'ja';
export type MixedGlossDensity = 'low' | 'medium' | 'high';

export interface TranslationLanguageOption {
  code: string;
  name: string;
  englishName: string;
}

export const SUPPORTED_TRANSLATION_LANGUAGES: TranslationLanguageOption[] = [
  { code: 'auto', name: '智能双向 (中文译英 / 外语译中)', englishName: 'Auto (ZH->EN / Foreign->ZH)' },
  { code: 'en', name: '英语', englishName: 'English' },
  { code: 'zh-CN', name: '简体中文', englishName: 'Simplified Chinese' },
  { code: 'zh-TW', name: '繁体中文', englishName: 'Traditional Chinese' },
  { code: 'ja', name: '日语', englishName: 'Japanese' },
  { code: 'ko', name: '韩语', englishName: 'Korean' },
  { code: 'fr', name: '法语', englishName: 'French' },
  { code: 'de', name: '德语', englishName: 'German' },
  { code: 'es', name: '西班牙语', englishName: 'Spanish' },
  { code: 'ru', name: '俄语', englishName: 'Russian' },
];

export interface AppSettings {
  pluginEnabled: boolean;
  // LLM AI Settings
  aiProvider: AiProvider;
  apiKey: string;
  apiBaseUrl: string;
  modelName: string;
  
  // Display & Behavior
  uiLanguage?: SupportedLang;
  primaryLang: 'en';
  secondaryLang: string; // 'auto', 'zh-CN', 'en', 'ja', 'zh-TW', 'ko', 'es', 'fr', 'de', 'ru'
  subtitleMode: SubtitleMode; // 'both' | 'mixed' | 'target' | 'translation' | 'hidden'
  subtitleFontSize: number;
  transcriptFontSize: number;
  sidePanelWidth: number;
  subtitleBottomPercent: number; // Vertical position in percent (0% to 80%)
  subtitleOpacity: number;       // Background opacity (0 ~ 1.0); 0 renders text only
  showEnglish: boolean;
  showChinese: boolean;
  showTranslationInMixedMode?: boolean; // 中英混合模式下是否在底部额外显示整句中文翻译 (默认 true)
  mixedModeFilterLevel?: 'all_content' | 'advanced_only'; // 混合模式词汇过滤级别 (默认 'all_content')
  mixedGlossDensity?: MixedGlossDensity; // AI精翻覆盖密度: 'low'(轻度 1-2词) | 'medium'(标准 2-4词) | 'high'(密集 4-8+词), 默认 'medium'
  maskChinese: boolean;          // 听力盲听遮罩模式：模糊中文，鼠标悬停清晰
  maskEnglish: boolean;          // 模糊英文，鼠标悬停清晰
  autoPauseOnHover: boolean;
  autoPauseAfterSentence: boolean; // Shadowing training
  highlightVocabulary: boolean;
  subtitleTimeOffset: number;       // In seconds (e.g. +0.5, -0.5)
  
  // Playback & Shortcuts
  repeatCount: number;
  playbackSpeed: number;
  hotkeys: {
    prevCue: string;
    nextCue: string;
    repeatCue: string;
    playPause: string;
    toggleSubtitle: string;
    cycleSubtitleMode?: string;
    toggleSidePanel: string;
    offsetMinus: string;
    offsetPlus: string;
  };
}

export interface PlayerState {
  currentTime: number;
  duration: number;
  paused: boolean;
  playbackRate: number;
  isFullscreen: boolean;
}

// ============================================================================
// AI Sentence Deep Analysis Contracts (Requirement 3)
// ============================================================================

export interface SentenceSyntacticBreakdown {
  clause: string;
  role: string;
  explanation: string;
}

export interface SentenceIdiomOrPhrase {
  phrase: string;
  meaning: string;
  usageNote?: string;
}

export interface SentencePronunciationTip {
  phenomenon: string;
  detail: string;
}

export interface SentenceDeepAnalysis {
  sentenceEn: string;
  sentenceZh: string;
  authenticTranslation: string;
  contextTone: string;
  syntacticBreakdown: SentenceSyntacticBreakdown[];
  idiomsAndPhrases: SentenceIdiomOrPhrase[];
  pronunciationTips: SentencePronunciationTip[];
  rawMarkdown?: string;
  source?: 'grok-ai' | 'google' | 'offline-fallback';
  isFallback?: boolean;
}
