export const zhCN = {
  // Brand & Common
  brand: 'Glean 拾句',
  appName: 'Glean 拾句',
  appSubtitle: '开源沉浸式双语视频学习浏览器插件',
  version: 'v1.0.0',
  close: '关闭',
  save: '保存',
  saveAndClose: '保存并关闭',
  savedSuccess: '设置已保存！',
  loading: '加载中...',

  // Languages
  lang: {
    'zh-CN': '简体中文',
    'en': 'English',
    'ja': '日本語'
  },
  uiLanguage: '界面语言',
  targetLanguage: '目标翻译语言',

  // Control Bar
  controlBar: {
    subtitleSource: '字幕源',
    loadDemo: '加载演示双语字幕',
    importLocal: '导入本地字幕 (SRT / VTT / ASS)',
    loadSuccess: '已成功载入 {count} 句字幕',
    loadFail: '解析字幕文件失败，请检查文件格式',
    showSubtitle: '开启字幕',
    hideSubtitle: '关闭字幕',
    modeBoth: '双语字幕',
    modeMixed: '中英混合',
    modeTarget: '仅外语',
    modeTranslation: '仅中译',
    modeHidden: '关闭字幕',
    maskModeTitle: '听力磨砂遮罩模式 (点击开关)',
    fontDecrease: '字号缩小 (A-)',
    fontIncrease: '字号放大 (A+)',
    offsetMinus: '字幕快进 0.5 秒 ([)',
    offsetPlus: '字幕回退 0.5 秒 (])',
    offsetReset: '重置字幕偏移',
    settings: '设置'
  },

  // Settings Modal
  settingsModal: {
    title: 'Glean 拾句 设置',
    aiProvider: 'AI 大模型服务提供商:',
    apiKey: 'API 密钥 (API Key):',
    apiBaseUrl: 'API Base URL (端点):',
    modelName: '模型名称 (Model Name):',
    testConnection: '测试连接',
    testing: '测试中...',
    connectSuccess: '连接成功 ({latency}ms)',
    connectFail: '连接失败',
    modelsAvailable: '可用模型: {count} 个',
    providerGoogle: 'Google Gemini',
    googleGeminiDesc: 'Google Gemini 官方大模型 (Gemini 2.5 Flash)',
    fillGoogleKeyHint: '请输入 Google AI Studio 生成的 API Key (AIzaSy...)',
    googleStudioHint: '获取 Google API Key',
    badgeOfficial: '官方',
    badgeRecommended: '推荐',
    badgeDedicated: '专用',
    subtitleFontSize: '底部视频字幕字号:',
    transcriptFontSize: '右侧台词面板字号:',
    sidePanelWidth: '右侧侧边栏宽度:',
    defaultSubtitleMode: '默认字幕模式:',
    aiTranslationLang: 'AI 翻译目标语言:',
    aiTranslationLangDesc: '视频原声为中文时将自动翻译为英文；原声为外语时翻译为所选语言。',
    mixedGlossDensity: 'AI 精翻覆盖密度:',
    mixedGlossDensityDesc: '控制每句台词中重点词汇与短语的标注数量。密集全量模式下将尽可能标注全部实词短语。',
    mixedGlossDensityLow: '轻度精要 (1-2 词)',
    mixedGlossDensityMedium: '标准均衡 (2-4 词)',
    mixedGlossDensityHigh: '密集全量 (4-8+ 词)',
    mixedModeShowTranslation: '显示整句中文翻译',
    mixedModeShowTranslationDesc: '在混合行下方额外显示整句中文译文；关闭后仅保留英文原句与行内重点释义，画面更清爽沉浸。',
    maskModeLabel: '听力磨砂遮罩模式 (脱离字幕磨耳朵)',
    maskModeDesc: '翻译字幕默认虚化模糊，鼠标悬停时清晰显示',
    subtitleOpacity: '字幕卡片背景不透明度:',
    audioSectionTitle: '🔊 单词发音与朗读语音设置',
    audioSectionDesc: '推荐优先使用有道真人原声，母语录音纯正清晰；如选用系统语音，已自动为您屏蔽 Mac 旧版低质声音（如沙哑的 Alex）。',
    ttsEngine: '发音引擎与来源:',
    ttsEngineYoudaoUS: '有道词典真人原声 (美音) [推荐]',
    ttsEngineYoudaoUK: '有道词典真人原声 (英音)',
    ttsEngineGoogle: 'Google 词典 TTS (国际标准音)',
    ttsEngineSystem: '系统 / 浏览器原生语音 (Web Speech API)',
    ttsVoice: '系统发音人:',
    ttsVoiceAuto: '自动优选高质量声音 (Samantha / Ava / Google 等)',
    ttsRate: '发音语速:',
    testAudio: '试听发音',
    testingAudio: '正在播放...'
  },

  // Subtitle Overlay
  subtitleOverlay: {
    dragTip: '拖拽调节垂直高度 (双击复位)',
    switchMode: '切换字幕模式',
    hideSubtitle: '关闭字幕'
  },

  // Word Popup
  wordPopup: {
    tabExplain: '语境精析',
    tabGrammar: '语法与辨析',
    tabExamples: '拓展例句',
    retryAi: '重试 AI',
    regenerateExamples: '重新生成',
    loadingExamples: '正在构思 3 个场景拓展例句及语法解析...',
    meaningLabel: '词义解析',
    grammarLabel: '语法结构',
    noApiKeyExamples: '未配置 AI API Key，请在设置中配置后重试',
    failedExamples: '拓展例句生成失败，请重试',
    offlineBadge: '离线词库',
    offlineRichBadge: '精选离线',
    grokBadge: 'Grok 4.6 深度解析',
    googleBadge: 'Google Gemini 深度解析',
    intentPrefix: '语境意图:',
    newWord: '新词',
    learning: '学习中',
    known: '已掌握',
    mastered: '熟练',
    pronounce: '播放发音',
    loadingExplanation: '正在进行 Grok 4.6 语境深度解析...',
    loadingExplanationGoogle: '正在进行 Google Gemini 语境深度解析...',
    noLocalDef: '暂无离线释义'
  },

  // Sentence Analysis Card
  sentenceAnalysis: {
    title: 'AI 语境精讲与深度拆解',
    loading: '正在结合上下文进行深度多维语法拆解与语境推理...',
    tabContext: '语境意图',
    tabVocab: '难词短语',
    tabGrammar: '语法句式',
    tabIdiomatic: '地道表达',
    repeatSentence: '单句复读',
    loopSentence: '循环跟读',
    close: '关闭'
  },

  // Transcript Panel
  transcript: {
    tabSubtitles: '字幕列表',
    tabVocabulary: '本集词汇',
    tabSaved: '已存生词',
    searchPlaceholder: '搜索台词...',
    emptySubtitles: '暂无字幕台词，请在播放器顶部载入字幕',
    emptyVocabulary: '暂无提取到的重点词汇',
    emptySaved: '暂无保存的生词，点击字幕中的单词并收藏',
    exportMenu: '导出字幕与生词',
    exportAnki: '导出 Anki (TSV)',
    exportJson: '导出 JSON',
    exportCsv: '导出 CSV',
    exportSuccess: '导出成功！',
    clearAll: '清空生词',
    importSubtitles: '导入本地字幕文件'
  },

  // Popup Window
  popup: {
    supportedPlatforms: '支持播放平台',
    quarkPan: '✓ 夸克网盘 (pan.quark.cn)',
    youtube: '✓ YouTube',
    html5Video: '✓ 通用网页 HTML5 视频',
    aiConfigTitle: 'AI 大模型服务配置',
    selectPreset: '选择服务提供商预设：',
    googleStudioHint: 'Google AI Studio 官方模型服务',
    exportSavedWords: '导出已保存生词 ({count} 词)',
    saveConfig: '保存配置'
  }
};

export type TranslationSchema = typeof zhCN;
