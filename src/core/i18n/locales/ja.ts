import { TranslationSchema } from './zh-CN';

export const ja: TranslationSchema = {
  // Brand & Common
  brand: 'Glean（拾句）',
  appName: 'Glean（拾句）',
  appSubtitle: 'オープンソースの没入型バイリンガル動画学習ブラウザ拡張',
  version: 'v1.0.0',
  close: '閉じる',
  save: '保存',
  saveAndClose: '保存して閉じる',
  savedSuccess: '設定を保存しました！',
  loading: '読み込み中...',

  // Languages
  lang: {
    'zh-CN': '简体中文',
    'en': 'English',
    'ja': '日本語'
  },
  uiLanguage: '表示言語',
  targetLanguage: '翻訳ターゲット言語',

  // Control Bar
  controlBar: {
    subtitleSource: '字幕ソース',
    loadDemo: 'デモバイリンガル字幕を読み込む',
    importLocal: 'ローカル字幕をインポート (SRT / VTT / ASS)',
    loadSuccess: '{count} 件の字幕を読み込みました',
    loadFail: '字幕ファイルの解析に失敗しました。ファイル形式を確認してください。',
    showSubtitle: '字幕を表示',
    hideSubtitle: '字幕を非表示',
    modeBoth: 'バイリンガル',
    modeMixed: '日英混合',
    modeTarget: '外国語のみ',
    modeTranslation: '翻訳のみ',
    modeHidden: '非表示',
    maskModeTitle: 'リスニングブラインドマスク (クリックで切替)',
    fontDecrease: 'フォント縮小 (A-)',
    fontIncrease: 'フォント拡大 (A+)',
    offsetMinus: '字幕を0.5秒進める ([)',
    offsetPlus: '字幕を0.5秒遅らせる (])',
    offsetReset: '字幕オフセットをリセット',
    settings: '設定'
  },

  // Settings Modal
  settingsModal: {
    title: 'Glean（拾句）設定',
    aiProvider: 'AIモデルプロバイダー:',
    apiKey: 'APIキー (API Key):',
    apiBaseUrl: 'APIベースURL (エンドポイント):',
    modelName: 'モデル名 (Model Name):',
    testConnection: '接続テスト',
    testing: 'テスト中...',
    connectSuccess: '接続成功 ({latency}ms)',
    connectFail: '接続失敗',
    modelsAvailable: '利用可能なモデル: {count} 件',
    providerGoogle: 'Google Gemini',
    googleGeminiDesc: 'Google Gemini 公式モデル (Gemini 2.5 Flash)',
    fillGoogleKeyHint: 'Google AI Studio で生成した API キーを入力 (AIzaSy...)',
    googleStudioHint: 'Google API キーを取得',
    badgeOfficial: '公式',
    badgeRecommended: '推奨',
    badgeDedicated: '専用',
    subtitleFontSize: '動画字幕フォントサイズ:',
    transcriptFontSize: '台詞パネルフォントサイズ:',
    sidePanelWidth: 'サイドバー幅:',
    defaultSubtitleMode: 'デフォルト字幕モード:',
    aiTranslationLang: 'AI 翻訳対象言語:',
    aiTranslationLangDesc: '中国語の音声は自動的に英語に翻訳され、外国語は選択した言語に翻訳されます。',
    mixedGlossDensity: 'AI 精翻の密度:',
    mixedGlossDensityDesc: '字幕内で注釈する重要語句の密度を調整します。高密度モードでは実質語句を最大限カバーします。',
    mixedGlossDensityLow: '低 (1-2語)',
    mixedGlossDensityMedium: '標準 (2-4語)',
    mixedGlossDensityHigh: '高 (4-8+語)',
    mixedModeShowTranslation: '全文翻訳を表示',
    mixedModeShowTranslationDesc: 'ハイブリッド字幕の下に全文翻訳を表示します。オフにすると原文と語句注釈のみが表示され、すっきりと学習に集中できます。',
    maskModeLabel: 'リスニングブラインドマスク (字幕に頼らず耳を鍛える)',
    maskModeDesc: '翻訳字幕をデフォルトでぼかし、マウスオーバーでクリアに表示',
    subtitleOpacity: '字幕背景の不透明度:'
  },

  // Subtitle Overlay
  subtitleOverlay: {
    dragTip: 'ドラッグで高さを調整 (ダブルクリックでリセット)',
    switchMode: '字幕モード切替',
    hideSubtitle: '字幕を非表示'
  },

  // Word Popup
  wordPopup: {
    tabExplain: '文脈・意味',
    tabExamples: '発展例文',
    tabGrammar: '文法と語法',
    retryAi: 'AI再試行',
    regenerateExamples: '再生成',
    loadingExamples: 'AIが3つの例文と文法解説を生成中...',
    meaningLabel: '文脈上の意味',
    grammarLabel: '文法構造',
    noApiKeyExamples: 'AI APIキーが未設定です。設定から登録してください。',
    failedExamples: '例文の生成に失敗しました。再試行してください。',
    offlineBadge: 'オフライン辞書',
    offlineRichBadge: '精選オフライン',
    grokBadge: 'Grok 4.6 詳細解析',
    googleBadge: 'Google Gemini 詳細解析',
    intentPrefix: '発話意図:',
    newWord: '新出',
    learning: '学習中',
    known: '習得済',
    mastered: 'マスター',
    pronounce: '発音を再生',
    loadingExplanation: 'Grok 4.6 が文脈を深層解析中...',
    loadingExplanationGoogle: 'Google Gemini が文脈を深層解析中...',
    noLocalDef: 'オフライン解説なし'
  },

  // Sentence Analysis Card
  sentenceAnalysis: {
    title: 'AI 深層文脈・文法詳細解説',
    loading: '文脈と文法構文を多角的に詳細解析中...',
    tabContext: '文脈と意図',
    tabVocab: '重要語彙',
    tabGrammar: '文法と構文',
    tabIdiomatic: 'ネイティブ表現',
    repeatSentence: 'リピート再生',
    loopSentence: 'ループ再生',
    close: '閉じる'
  },

  // Transcript Panel
  transcript: {
    tabSubtitles: '字幕リスト',
    tabVocabulary: '重要単語',
    tabSaved: '単語帳',
    searchPlaceholder: '字幕を検索...',
    emptySubtitles: '字幕データがありません。上部バーから字幕を読み込んでください。',
    emptyVocabulary: '抽出された重要語彙はありません。',
    emptySaved: '保存された単語はありません。字幕の単語をクリックして保存できます。',
    exportMenu: '字幕と単語帳をエクスポート',
    exportAnki: 'Ankiにエクスポート (TSV)',
    exportJson: 'JSONエクスポート',
    exportCsv: 'CSVエクスポート',
    exportSuccess: 'エクスポート成功！',
    clearAll: 'すべて削除'
  },

  // Popup Window
  popup: {
    supportedPlatforms: '対応プラットフォーム',
    quarkPan: '✓ Quark Cloud Drive (pan.quark.cn)',
    youtube: '✓ YouTube',
    html5Video: '✓ 汎用HTML5動画プレイヤー',
    aiConfigTitle: 'AIモデルサービス設定',
    selectPreset: 'プロバイダープリセットを選択：',
    googleStudioHint: 'Google AI Studio 公式モデルサービス',
    exportSavedWords: '保存済み単語をエクスポート ({count} 語)',
    saveConfig: '設定を保存'
  }
};
