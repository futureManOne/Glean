import { TranslationSchema } from './zh-CN';

export const en: TranslationSchema = {
  // Brand & Common
  brand: 'Glean',
  appName: 'Glean',
  appSubtitle: 'Open-source immersive bilingual video learning extension',
  version: 'v1.0.0',
  close: 'Close',
  save: 'Save',
  saveAndClose: 'Save & Close',
  savedSuccess: 'Settings saved!',
  loading: 'Loading...',

  // Languages
  lang: {
    'zh-CN': '简体中文',
    'en': 'English',
    'ja': '日本語'
  },
  uiLanguage: 'UI Language',
  targetLanguage: 'Target Translation Language',

  // Control Bar
  controlBar: {
    subtitleSource: 'Subtitles',
    loadDemo: 'Load Demo Bilingual Subtitles',
    importLocal: 'Import Local Subtitles (SRT / VTT / ASS)',
    loadSuccess: 'Successfully loaded {count} subtitle cues',
    loadFail: 'Failed to parse subtitle file. Please verify file format.',
    showSubtitle: 'Show Subtitles',
    hideSubtitle: 'Hide Subtitles',
    modeBoth: 'Bilingual',
    modeMixed: 'Mixed',
    modeTarget: 'Target Only',
    modeTranslation: 'Translation Only',
    modeHidden: 'Hidden',
    maskModeTitle: 'Listening Frosted Mask Mode (Toggle)',
    fontDecrease: 'Decrease Font Size (A-)',
    fontIncrease: 'Increase Font Size (A+)',
    offsetMinus: 'Advance Subtitles 0.5s ([)',
    offsetPlus: 'Delay Subtitles 0.5s (])',
    offsetReset: 'Reset Subtitle Offset',
    settings: 'Settings'
  },

  // Settings Modal
  settingsModal: {
    title: 'Glean Settings',
    aiProvider: 'AI Model Provider:',
    apiKey: 'API Key:',
    apiBaseUrl: 'API Base URL (Endpoint):',
    modelName: 'Model Name:',
    testConnection: 'Test Connection',
    testing: 'Testing...',
    connectSuccess: 'Connected ({latency}ms)',
    connectFail: 'Connection Failed',
    modelsAvailable: 'Available Models: {count}',
    providerGoogle: 'Google Gemini',
    googleGeminiDesc: 'Google Gemini Official Model (Gemini 2.5 Flash)',
    fillGoogleKeyHint: 'Enter your Google AI Studio API Key (AIzaSy...)',
    googleStudioHint: 'Get Google API Key',
    badgeOfficial: 'Official',
    badgeRecommended: 'Recommended',
    badgeDedicated: 'Dedicated',
    subtitleFontSize: 'Subtitle Font Size:',
    transcriptFontSize: 'Transcript Font Size:',
    sidePanelWidth: 'Sidebar Width:',
    defaultSubtitleMode: 'Default Subtitle Mode:',
    aiTranslationLang: 'AI Translation Target Language:',
    aiTranslationLangDesc: 'Subtitles in Chinese will automatically translate to English; foreign speech will translate to your chosen language.',
    mixedGlossDensity: 'AI Translation Density:',
    mixedGlossDensityDesc: 'Controls the volume of key phrases/words annotated in subtitles. High density maximizes vocabulary coverage.',
    mixedGlossDensityLow: 'Low (1-2 words)',
    mixedGlossDensityMedium: 'Medium (2-4 words)',
    mixedGlossDensityHigh: 'High (4-8+ words)',
    maskModeLabel: 'Listening Frosted Mask (Train Your Ears)',
    maskModeDesc: 'Translation subtitles are blurred by default and reveal clearly on hover',
    subtitleOpacity: 'Subtitle Background Opacity:'
  },

  // Subtitle Overlay
  subtitleOverlay: {
    dragTip: 'Drag to adjust vertical height (double-click to reset)',
    switchMode: 'Switch Subtitle Mode',
    hideSubtitle: 'Hide Subtitles'
  },

  // Word Popup
  wordPopup: {
    tabExplain: 'Context & Meaning',
    tabGrammar: 'Grammar & Nuance',
    tabExamples: 'Examples',
    retryAi: 'Retry AI',
    regenerateExamples: 'Regenerate',
    loadingExamples: 'AI is generating 3 example sentences and grammar breakdowns...',
    meaningLabel: 'Meaning in Context',
    grammarLabel: 'Grammar Structure',
    noApiKeyExamples: 'AI API Key not configured. Please set it in settings.',
    failedExamples: 'Failed to generate examples. Please retry.',
    offlineBadge: 'Offline Dict',
    offlineRichBadge: 'Curated Offline',
    grokBadge: 'Grok 4.6 Deep Analysis',
    googleBadge: 'Google Gemini Deep Analysis',
    intentPrefix: 'Contextual Intent:',
    newWord: 'New',
    learning: 'Learning',
    known: 'Known',
    mastered: 'Mastered',
    pronounce: 'Pronounce',
    loadingExplanation: 'Analyzing context with Grok 4.6...',
    loadingExplanationGoogle: 'Analyzing context with Google Gemini...',
    noLocalDef: 'No offline definition available'
  },

  // Sentence Analysis Card
  sentenceAnalysis: {
    title: 'AI Context & Deep Sentence Analysis',
    loading: 'Analyzing sentence syntax, nuance, and contextual intent...',
    tabContext: 'Intent & Context',
    tabVocab: 'Key Vocabulary',
    tabGrammar: 'Syntax & Grammar',
    tabIdiomatic: 'Idiomatic Nuance',
    repeatSentence: 'Repeat Sentence',
    loopSentence: 'Loop Sentence',
    close: 'Close'
  },

  // Transcript Panel
  transcript: {
    tabSubtitles: 'Subtitles',
    tabVocabulary: 'Vocabulary',
    tabSaved: 'Saved Words',
    searchPlaceholder: 'Search transcript...',
    emptySubtitles: 'No subtitles available. Please load subtitles from the top bar.',
    emptyVocabulary: 'No key vocabulary extracted.',
    emptySaved: 'No saved words yet. Click any word in the subtitles to save it.',
    exportMenu: 'Export Subtitles & Vocabulary',
    exportAnki: 'Export to Anki (TSV)',
    exportJson: 'Export JSON',
    exportCsv: 'Export CSV',
    exportSuccess: 'Export successful!',
    clearAll: 'Clear All'
  },

  // Popup Window
  popup: {
    supportedPlatforms: 'Supported Platforms',
    quarkPan: '✓ Quark Cloud Drive (pan.quark.cn)',
    youtube: '✓ YouTube',
    html5Video: '✓ Universal HTML5 Video Players',
    aiConfigTitle: 'AI Model Configuration',
    selectPreset: 'Select Provider Preset:',
    googleStudioHint: 'Google AI Studio Official Model Service',
    exportSavedWords: 'Export Saved Words ({count} words)',
    saveConfig: 'Save Configuration'
  }
};
