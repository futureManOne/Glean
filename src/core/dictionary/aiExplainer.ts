import { WordExplanation, AppSettings, MasteryLevel, WordDefinition, WordExample, WordSentenceComparison, WordCollocation, SupportedLang, AI_PRESETS } from '@/types';
import { lookupLocalDict } from './ecdictMini';
import { callLlmChat } from '@/core/api/llmClient';
import { getWordExplanationCache, setWordExplanationCache } from './aiCache';

/**
 * Built-in Rich Fallback Explanations for demo & instant offline usage
 */
const OFFLINE_RICH_EXPLANATIONS: Record<string, Partial<WordExplanation>> = {
  "productivity": {
    phonetic: "/ˌprɒdʌkˈtɪvəti/",
    quickCn: "生产率，效率，生产力",
    contextExplanation: "在这个句子中，\"productivity\" 指的是工作或学习的效率与产出能力。说话者想向观众展示如何利用人工智能与结构化工作流来大幅提高个人效能并保持深度专注。",
    contextIntent: "说话者以分享与赋能的自信口吻，向观众介绍经实践验证的高效个人工作系统。",
    wordPosition: "主句宾语短语中的复合名词修饰定语，与 focus 共同修饰核心名词 system。",
    definitions: [
      { pos: "noun", meaning: "生产率，生产力，产出率，工作效率" },
      { pos: "noun", meaning: "产量，生产能力" }
    ],
    examples: [
      {
        en: "figured why don't I also show you my AI productivity and focus system.",
        zh: "想，为什么不也向你们展示一下我的AI生产力和专注力系统呢？",
        highlightWord: "productivity"
      },
      {
        en: "AI tools can boost your daily work productivity significantly.",
        zh: "人工智能工具可以大幅提升你日常工作的效率。",
        highlightWord: "productivity"
      }
    ],
    sentenceComparison: {
      currentUsage: "在此句中作为复合前置名词定语修饰 system，强调系统专用于提升生产效能。",
      contrastUsage: "常态句作独立不可数名词主语或宾语：His productivity improved after taking short breaks.",
      nuanceTip: "注意与 efficiency 的区别：productivity 侧重总产出数量与成果，efficiency 侧重资源利用率与投入产出比。"
    },
    collocations: [
      { phrase: "boost productivity", translation: "大幅提高生产率" },
      { phrase: "productivity system", translation: "生产力系统/效能工作流" },
      { phrase: "work productivity", translation: "工作效率" }
    ],
    grammar: "不可数名词 (Uncountable Noun)。在此句中作复合名词定语，与 focus 共同修饰名词 system。",
    cefr: "B2",
    collins: 4
  },
  "content": {
    phonetic: "/ˈkɒntent/",
    quickCn: "内容，信息，内容创作",
    contextExplanation: "在这个句子中，\"content\" 是一个名词，指的是面向大众发布的信息与作品。\"Content creator\" 的意思是“内容创作者”，即制作和发布数字内容（文章、视频、教程等）的人。说话者用此词明确自身职业身份与自媒体从业背景。",
    contextIntent: "说话者以真诚、平易近人的自述语气介绍自己的职业身份，建立与观众的信任纽带。",
    wordPosition: "作表语复合名词短语 \"content creator\" 的前置定语，限定创作领域与性质。",
    definitions: [
      { pos: "noun", meaning: "内容，实质，容量" },
      { pos: "noun", meaning: "数字内容，音视频图文材料" },
      { pos: "adj.", meaning: "满意的，知足的" }
    ],
    examples: [
      {
        en: "of you who don't know me, hello, my name is Tina. I am a content creator and I",
        zh: "那些不认识我的人，大家好，我叫蒂娜。我是一名内容创作者，同时",
        highlightWord: "content"
      },
      {
        en: "She creates high-quality educational content for language learners.",
        zh: "她为语言学习者制作高质量的教学内容。",
        highlightWord: "content"
      }
    ],
    sentenceComparison: {
      currentUsage: "在此句中与 creator 组合构成固定职业搭配 content creator (数字内容创作者)。",
      contrastUsage: "作表语形容词时重音在后 /kənˈtent/，表示满足：He is content with his current life.",
      nuanceTip: "表示作品/内容时重音在第一音节 /ˈkɒntent/；表示心满意足时重音在第二音节 /kənˈtent/。"
    },
    collocations: [
      { phrase: "content creator", translation: "内容创作者/自媒体博主" },
      { phrase: "educational content", translation: "教育类内容" },
      { phrase: "generate content", translation: "生成/生产内容" }
    ],
    grammar: "在此句中作为复合名词的前置定语修饰 creator，构成固定复合职业称谓。",
    cefr: "B1",
    collins: 4
  },
  "creator": {
    phonetic: "/kriˈeɪtər/",
    quickCn: "创作者，创造者",
    contextExplanation: "在这个句子中，\"creator\" 指的是从事创意与作品产出的人。与 content 连用构成 \"content creator\"，专指活跃在 YouTube、播客等平台的现代自媒体从业者。",
    contextIntent: "说话者简明扼要地标定自身职业定位，并为后续展示专业方法论做铺垫。",
    wordPosition: "句中主系表结构中的核心表语名词，被不定冠词 a 与定语 content 修饰。",
    definitions: [
      { pos: "noun", meaning: "创造者，创作者，发明者" }
    ],
    examples: [
      {
        en: "I am a content creator and I also run an AI education company.",
        zh: "我是一名内容创作者，同时我也经营一家AI教育公司。",
        highlightWord: "creator"
      },
      {
        en: "Digital creators are reshaping how people consume educational media.",
        zh: "数字创作者正在重塑人们获取教育媒体的方式。",
        highlightWord: "creators"
      }
    ],
    sentenceComparison: {
      currentUsage: "当前语境下特指网络新媒体内容创作者，带有强烈的时代互联网特征。",
      contrastUsage: "大写 Creator 特指造物主或上帝：God as the Creator of the universe.",
      nuanceTip: "注意与 artist/author 的区别：creator 范围更广，不仅涵盖文字绘画，更涵盖短视频、数字工具与课程全栈产出。"
    },
    collocations: [
      { phrase: "content creator", translation: "内容创作者" },
      { phrase: "digital creator", translation: "数字新媒体创作者" },
      { phrase: "course creator", translation: "课程主讲人/开发者" }
    ],
    grammar: "可数名词单数形式，前面有不定冠词 a 修饰，在主系表句式中担任核心表语。",
    cefr: "B1",
    collins: 3
  },
  "focus": {
    phonetic: "/ˈfəʊkəs/",
    quickCn: "专注，聚焦，核心焦点",
    contextExplanation: "在此句中与 productivity 并列作为名词修饰词，指代保持心流状态、排除干扰的注意力管理体系。",
    contextIntent: "说话者强调高效不仅依赖工具，更依赖抗干扰的专注力心智架构。",
    wordPosition: "并列定语成分，与 productivity 共同修饰中心词 system。",
    definitions: [
      { pos: "noun", meaning: "焦点，专心，注意力集中" },
      { pos: "verb", meaning: "聚焦，集中注意力于" }
    ],
    examples: [
      {
        en: "figured why don't I also show you my AI productivity and focus system.",
        zh: "想，为什么不也向你们展示一下我的AI生产力和专注力系统呢？",
        highlightWord: "focus"
      }
    ],
    sentenceComparison: {
      currentUsage: "在此句中作为复合修饰词，指注意力集中机制。",
      contrastUsage: "作为及物/不及物动词用法：You need to focus on your highest-leverage task.",
      nuanceTip: "作为名词既可表示抽象的集中状态，亦可表示具体光学或讨论的中心焦点。"
    },
    collocations: [
      { phrase: "focus system", translation: "专注力管理系统" },
      { phrase: "stay focused", translation: "保持专注" },
      { phrase: "deep focus", translation: "深度聚焦" }
    ],
    grammar: "名词作前置并列定语，修饰中心名词 system。",
    cefr: "A2",
    collins: 5
  },
  "system": {
    phonetic: "/ˈsɪstəm/",
    quickCn: "系统，体系，工作流",
    contextExplanation: "在此句中指的是一整套行之有效、可重复运转的个人工作流与软件工具组合，而非单一软件。",
    contextIntent: "说话者展示结构化思维，强调方法论的系统性与可持续性。",
    wordPosition: "复合宾语短语中的核心中心词 (Head Noun)。",
    definitions: [
      { pos: "noun", meaning: "体系，系统，制度，秩序" }
    ],
    examples: [
      {
        en: "figured why don't I also show you my AI productivity and focus system.",
        zh: "想，为什么不也向你们展示一下我的AI生产力和专注力系统呢？",
        highlightWord: "system"
      }
    ],
    sentenceComparison: {
      currentUsage: "特指个人工作机制与组织体系，包含日程、任务流与AI工具协同。",
      contrastUsage: "指客观计算机系统或社会制度：operating system / judicial system.",
      nuanceTip: "在个人成长语境中，system 强调靠流程而非靠意志力来保证持续输出。"
    },
    collocations: [
      { phrase: "productivity system", translation: "效能体系" },
      { phrase: "operating system", translation: "操作系统" },
      { phrase: "design a system", translation: "搭建一套体系" }
    ],
    grammar: "可数名词单数，作动词 show 的直接宾语核心词。",
    cefr: "A2",
    collins: 5
  }
};

/**
 * Robust zero-failure JSON cleaner and parser.
 * Handles Markdown code fences, stray text, unescaped characters, and trailing commas.
 */
export function sanitizeAndParseJson<T>(raw: string, fallbackFactory: () => T): T {
  if (!raw || typeof raw !== 'string') {
    return fallbackFactory();
  }

  // 1. First attempt: standard JSON.parse
  try {
    return JSON.parse(raw) as T;
  } catch (_) {
    // Continue to sanitization pipeline
  }

  // 2. Strip markdown code fences (e.g. ```json ... ``` or ``` ...)
  let cleaned = raw
    .replace(/^[\s\S]*?```(?:json)?\s*/i, '')
    .replace(/\s*```[\s\S]*$/, '')
    .trim();

  // 3. Extract outermost curly braces { ... }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end > start) {
    cleaned = cleaned.substring(start, end + 1);
  }

  // 4. Strip trailing commas before closing braces and brackets
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');

  // 5. Second attempt with sanitized string
  try {
    return JSON.parse(cleaned) as T;
  } catch (_) {
    // Continue to lenient line-based repair if still failing
  }

  // 6. Lenient quote and escape recovery
  try {
    const recovered = cleaned
      .replace(/[\u201C\u201D\u2018\u2019]/g, '"') // Replace smart quotes with standard double quotes
      .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"') // Convert single-quoted JSON strings to double-quoted
      .replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(recovered) as T;
  } catch (finalErr) {
    console.warn('[aiExplainer] JSON recovery failed on raw content:', raw.slice(0, 120), finalErr);
    return fallbackFactory();
  }
}

let currentAbortEpoch = 0;

/**
 * Abort/invalidate any in-flight word explanation request.
 */
export function abortActiveWordExplanation(): void {
  currentAbortEpoch++;
}

/**
 * Synchronously create instant initial word explanation for 0ms staged rendering.
 */
export function createInitialWordExplanation(
  word: string,
  contextEn: string,
  contextZh: string,
  userLevel: MasteryLevel = 'new',
  wordPosition?: string
): WordExplanation {
  const cleanWord = (word || '').toLowerCase().trim();

  // 1. Check built-in curated rich explanations
  if (OFFLINE_RICH_EXPLANATIONS[cleanWord]) {
    const offline = OFFLINE_RICH_EXPLANATIONS[cleanWord];
    return {
      word,
      phonetic: offline.phonetic || `/${cleanWord}/`,
      quickCn: offline.quickCn || '精选释义',
      contextSentenceEn: contextEn,
      contextSentenceZh: contextZh,
      contextExplanation: '', // Empty indicates AI context is generating
      contextIntent: offline.contextIntent,
      wordPosition: offline.wordPosition || wordPosition,
      definitions: offline.definitions || [{ pos: "noun", meaning: offline.quickCn || "核心词汇" }],
      examples: offline.examples || [{ en: contextEn || word, zh: contextZh || '' }],
      grammar: offline.grammar || '在当前语境中充当句子核心成分。',
      cefr: offline.cefr || "B1",
      collins: offline.collins || 3,
      sentenceComparison: offline.sentenceComparison,
      collocations: offline.collocations || [],
      source: 'offline-rich',
      isFallback: false,
      level: userLevel
    };
  }

  // 2. Check ECDICT Mini
  const entry = lookupLocalDict(cleanWord);
  const isFoundInLocal = entry && entry.trans && entry.trans !== '暂无离线释义';
  const splitDefs: WordDefinition[] = isFoundInLocal
    ? entry.trans.split(/[；;]/).map(part => part.trim()).filter(Boolean).map(part => ({
        pos: entry.pos || 'word',
        meaning: part
      }))
    : [{ pos: entry?.pos || 'word', meaning: entry?.trans || '暂无本地释义' }];

  return {
    word,
    phonetic: entry?.phonetic || `/${cleanWord}/`,
    quickCn: isFoundInLocal ? entry.trans : (entry?.trans || '暂无本地释义'),
    contextSentenceEn: contextEn,
    contextSentenceZh: contextZh,
    contextExplanation: '', // Empty indicates AI context is generating
    contextIntent: undefined,
    wordPosition: wordPosition || (entry?.pos ? `在当前句子中词性为 ${entry.pos}` : undefined),
    definitions: splitDefs,
    examples: [{ en: contextEn || word, zh: contextZh || '' }],
    grammar: isFoundInLocal
      ? `词性为 ${entry.pos || '常用词'}。在当前句中担任重要语义连接作用。`
      : '在当前句中充当重要语言成分。',
    cefr: entry?.cefr || "B1",
    collins: entry?.collins || 3,
    collocations: [],
    source: 'ecdict-mini',
    isFallback: false,
    level: userLevel
  };
}

/**
 * Build streamlined prompt for Grok 4.6 word-in-sentence context parsing.
 * Restricts output tokens to only context-specific fields for 3x speedup.
 */
export function buildGrokPrompt(
  word: string,
  contextEn: string,
  contextZh: string,
  userLevel: MasteryLevel,
  wordPosition?: string,
  targetLang: SupportedLang = 'zh-CN'
): string {
  if (targetLang === 'ja') {
    return `あなたは一流の英語講師・言語学者です。動画セリフの文脈に合わせて、対象単語の具体的な意味・ニュアンス・文法的役割を正確に解析してください。

【対象文】：${contextEn || 'なし'}
${contextZh ? `【参考字幕】：${contextZh}\n` : ''}【対象単语】：${word}
${wordPosition ? `【位置】：${wordPosition}\n` : ''}【習得度】：${userLevel}

Markdown等の装飾を一切含めず、純粋なJSONのみを出力してください：
{
  "quickCn": "現在の文脈における最も的確で簡潔な日本語訳(1〜3語)",
  "contextExplanation": "このセリフの文脈における具体的な意味・ニュアンス・意図の詳細な解説（約60文字）",
  "grammar": "この文における正確な文法役割・構文機能",
  "contextIntent": "話し手の発話意図やニュアンス"
}`;
  }

  if (targetLang === 'en') {
    return `You are a world-class English linguist and ESL educator. Analyze the target vocabulary word in the context of this video subtitle sentence.

【Sentence】: ${contextEn || 'None'}
${contextZh ? `【Reference Subtitle】: ${contextZh}\n` : ''}【Target Word】: ${word}
${wordPosition ? `【Position】: ${wordPosition}\n` : ''}【Mastery Level】: ${userLevel}

Output strict JSON only without markdown code fences or conversational text:
{
  "quickCn": "Most accurate concise English definition in this context (1-4 words)",
  "contextExplanation": "Contextual meaning, referent, and nuance in this specific sentence (approx. 30-50 words)",
  "grammar": "Exact grammatical role and syntactic function in this sentence",
  "contextIntent": "Speaker's pragmatic tone and communication intent"
}`;
  }

  return `你是一位顶级英语教师。请针对此句视频台词语境，精准解析目标生词在当前句中的具体含义与句法功能。

【句子】：${contextEn || '无'}
【中译】：${contextZh || '无'}
【目标词】：${word}
${wordPosition ? `【位置说明】：${wordPosition}\n` : ''}【掌握度】：${userLevel}

请直接输出紧凑严格的 JSON（不要包含任何 markdown 外部文字）：
{
  "quickCn": "当前句最贴切的简明中文释义(1-3个词)",
  "contextExplanation": "结合此句台词语境深度解析该词的具体含义、修饰指代与意图(约50字)",
  "grammar": "在当前句中的确切语法角色与句法功能(如复合名词定语/宾补等)",
  "contextIntent": "说话者当前语境下的真实语气与表达意图"
}`;
}

/**
 * Fetch word explanation via AI LLM API (Grok 4.6) or 5-layer defensive fallback pipeline
 */
export async function explainWordInContext(
  word: string,
  contextEn: string,
  contextZh: string,
  settings: AppSettings,
  userLevel: MasteryLevel = 'new',
  wordPosition?: string
): Promise<WordExplanation> {
  const cleanWord = word.toLowerCase().trim();
  const epoch = currentAbortEpoch;

  // 1. Check 0ms persistent smart cache
  try {
    const cached = await getWordExplanationCache(cleanWord, contextEn);
    if (cached) {
      return cached;
    }
  } catch (err) {
    console.warn('[aiExplainer] Cache lookup error:', err);
  }

  // Generate initial base dictionary representation for local fallback/merge
  const base = createInitialWordExplanation(word, contextEn, contextZh, userLevel, wordPosition);
  let fallbackReason: string | undefined = undefined;

  // Determine target language from user settings
  const targetLang: SupportedLang = settings.uiLanguage || (settings.secondaryLang === 'ja' ? 'ja' : settings.secondaryLang === 'en' ? 'en' : 'zh-CN');

  // =========================================================================
  // Layer 1 & 2: Grok 4.6 LLM Deep Linguistic Analysis with JSON Sanitization
  // =========================================================================
  if (settings.apiKey && settings.apiKey.trim() !== '') {
    try {
      const prompt = buildGrokPrompt(cleanWord, contextEn, contextZh, userLevel, wordPosition, targetLang);
      const provider = settings.aiProvider || 'google';
      const defaultBaseUrl = AI_PRESETS[provider]?.apiBaseUrl || AI_PRESETS.google.apiBaseUrl;
      const defaultModel = AI_PRESETS[provider]?.modelName || AI_PRESETS.google.modelName;

      const rawLlmResponse = await callLlmChat(
        {
          apiBaseUrl: settings.apiBaseUrl || defaultBaseUrl,
          apiKey: settings.apiKey,
          modelName: settings.modelName || defaultModel,
          timeoutMs: 12000 // 12s timeout protection
        },
        {
          messages: [
            {
              role: 'system',
              content: 'You are an expert English linguist and ESL educator. You only respond with strictly valid JSON.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.3,
          maxTokens: 800,
          responseFormatJson: true
        }
      );

      // If user aborted or clicked another word during this in-flight request, discard
      if (epoch !== currentAbortEpoch) {
        return base;
      }

      // Layer 2: Zero-failure JSON sanitizer & parser
      const parsed = sanitizeAndParseJson<any>(rawLlmResponse, () => null);

      if (parsed && typeof parsed === 'object' && (parsed.quickCn || parsed.contextExplanation || parsed.definitions)) {
        const definitions: WordDefinition[] = Array.isArray(parsed.definitions) && parsed.definitions.length > 0
          ? parsed.definitions.map((d: any) => ({
              pos: String(d.pos || 'word'),
              meaning: String(d.meaning || '')
            }))
          : base.definitions;

        const examples: WordExample[] = Array.isArray(parsed.examples) && parsed.examples.length > 0
          ? parsed.examples.map((eg: any) => ({
              en: String(eg.en || ''),
              zh: String(eg.zh || ''),
              highlightWord: eg.highlightWord ? String(eg.highlightWord) : undefined
            }))
          : base.examples;

        const collocations: WordCollocation[] = Array.isArray(parsed.collocations)
          ? parsed.collocations.map((c: any) => ({
              phrase: String(c.phrase || ''),
              translation: String(c.translation || '')
            }))
          : base.collocations;

        const sentenceComparison: WordSentenceComparison | undefined = parsed.sentenceComparison && typeof parsed.sentenceComparison === 'object'
          ? {
              currentUsage: String(parsed.sentenceComparison.currentUsage || ''),
              contrastUsage: String(parsed.sentenceComparison.contrastUsage || ''),
              nuanceTip: String(parsed.sentenceComparison.nuanceTip || '')
            }
          : base.sentenceComparison;

        const result: WordExplanation = {
          word: word,
          phonetic: parsed.phonetic || base.phonetic,
          quickCn: parsed.quickCn || base.quickCn,
          contextSentenceEn: contextEn,
          contextSentenceZh: contextZh,
          contextExplanation: parsed.contextExplanation || `在当前句中，"${word}" 是关键词。`,
          contextIntent: parsed.contextIntent || undefined,
          wordPosition: parsed.wordPosition || base.wordPosition || wordPosition || undefined,
          definitions,
          examples,
          grammar: parsed.grammaticalRole || parsed.grammar || base.grammar,
          cefr: (parsed.cefr && ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].includes(parsed.cefr.toUpperCase()))
            ? parsed.cefr.toUpperCase()
            : base.cefr,
          collins: typeof parsed.collins === 'number' ? Math.max(1, Math.min(5, parsed.collins)) : base.collins,
          sentenceComparison,
          collocations,
          source: settings.aiProvider === 'google' ? 'google' : 'grok-ai',
          aiModel: (settings.modelName || defaultModel).trim(),
          isFallback: false,
          level: userLevel
        };

        // Cache successful explanation for instant 0ms hits on replay
        setWordExplanationCache(cleanWord, contextEn, result).catch(e =>
          console.warn('[aiExplainer] Failed to save word explanation cache:', e)
        );

        return result;
      } else {
        fallbackReason = 'AI 响应格式解析异常，已自动切换本地词库';
      }
    } catch (err: any) {
      fallbackReason = err?.message || 'AI 服务请求异常或超时 (12s)';
      console.warn('[aiExplainer] AI call failed, falling back gracefully:', fallbackReason);
    }
  } else {
    fallbackReason = '未配置 AI API Key，已切换为本地离线模式';
  }

  // =========================================================================
  // Layer 3: Built-in High-Value Curated Offline Rich Explanations
  // =========================================================================
  if (OFFLINE_RICH_EXPLANATIONS[cleanWord]) {
    const offline = OFFLINE_RICH_EXPLANATIONS[cleanWord];
    return {
      word: word,
      phonetic: offline.phonetic || `/${cleanWord}/`,
      quickCn: offline.quickCn || '',
      contextSentenceEn: contextEn,
      contextSentenceZh: contextZh,
      contextExplanation: offline.contextExplanation || `在当前句中，"${word}" 是关键词。`,
      contextIntent: offline.contextIntent,
      wordPosition: offline.wordPosition || wordPosition,
      definitions: offline.definitions || [{ pos: "noun", meaning: offline.quickCn || "" }],
      examples: offline.examples || [{ en: contextEn || word, zh: contextZh || '' }],
      grammar: offline.grammar || `在当前语境中充当句子核心成分。`,
      cefr: offline.cefr || "B1",
      collins: offline.collins || 3,
      sentenceComparison: offline.sentenceComparison,
      collocations: offline.collocations || [],
      source: 'offline-rich',
      isFallback: true,
      fallbackReason: fallbackReason || '离线精选释义',
      level: userLevel
    };
  }

  // =========================================================================
  // Layer 4: Expanded ECDICT Mini Core Offline Dictionary (2,800+ Words)
  // =========================================================================
  const entry = lookupLocalDict(cleanWord);
  const isFoundInLocal = entry && entry.trans && entry.trans !== '暂无离线释义';

  if (isFoundInLocal) {
    // Parse definition into pos items if comma or semicolon separated
    const splitDefs: WordDefinition[] = entry.trans
      .split(/[；;]/)
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => ({
        pos: entry.pos || 'word',
        meaning: part
      }));

    return {
      word: word,
      phonetic: entry.phonetic || `/${cleanWord}/`,
      quickCn: entry.trans,
      contextSentenceEn: contextEn,
      contextSentenceZh: contextZh,
      contextExplanation: `在当前句子中，"${word}" 对应释义为「${entry.trans}」。可结合整句台词 “${contextEn || word}” 进行深入理解。`,
      contextIntent: '离线模式：暂无语境发言意图解析，可通过配置 AI Key 解锁深度意图分析。',
      wordPosition: wordPosition || `在当前句子中词性为 ${entry.pos || '通用词'}。`,
      definitions: splitDefs.length > 0 ? splitDefs : [{ pos: entry.pos || 'word', meaning: entry.trans }],
      examples: [
        { en: contextEn || `Example sentence with ${word}.`, zh: contextZh || `包含 ${word} 的台词语境。`, highlightWord: word }
      ],
      grammar: `词性为 ${entry.pos || '核心词'}。在当前句中担任重要语义连接作用。`,
      cefr: entry.cefr || "B1",
      collins: entry.collins || 3,
      sentenceComparison: {
        currentUsage: `当前台词语境使用：对应释义「${entry.trans}」`,
        contrastUsage: `词性分类：${entry.pos || '常用实词'}`,
        nuanceTip: `配置 Grok 4.6 密钥后可查看该词在当前语境下的近义辨析与细微语感差异。`
      },
      collocations: [
        { phrase: `${cleanWord} usage`, translation: `${word} 的常规搭配用法` }
      ],
      source: 'ecdict-mini',
      isFallback: true,
      fallbackReason: fallbackReason || '本地离线词库释义',
      level: userLevel
    };
  }

  // =========================================================================
  // Layer 5: Safe Universal Fallback (Guaranteed Non-Empty Result)
  // =========================================================================
  return {
    word: word,
    phonetic: entry?.phonetic || `/${cleanWord}/`,
    quickCn: entry?.trans || '暂无离线释义',
    contextSentenceEn: contextEn,
    contextSentenceZh: contextZh,
    contextExplanation: `在当前台词中点击了 "${word}"。上下文：\"${contextEn || word}\"。建议连接网络并配置 Grok 4.6 API Key 获取词根词源与深度语境精析。`,
    contextIntent: '离线未收录词汇：建议开启 AI 解析获取讲话者语境意图。',
    wordPosition: wordPosition || '待解析句法位置',
    definitions: [
      { pos: entry?.pos || 'word', meaning: entry?.trans || '暂无本地释义' }
    ],
    examples: [
      { en: contextEn || word, zh: contextZh || '当前视频台词' }
    ],
    grammar: `词性为 ${entry?.pos || '待解析'}。在当前句子中作为语言单元出现。`,
    cefr: entry?.cefr || 'B1',
    collins: entry?.collins || 1,
    source: 'ecdict-mini',
    isFallback: true,
    fallbackReason: fallbackReason || '未收录词汇离线兜底',
    level: userLevel
  };
}

/**
 * Generate 3 AI extended example sentences for a selected word,
 * including grammatical structure and word meaning explanations for ESL learners.
 */
export async function generateWordExtendedExamples(
  word: string,
  contextEn: string,
  contextZh: string,
  settings: AppSettings
): Promise<WordExample[]> {
  const cleanWord = (word || '').trim();
  if (!cleanWord) return [];

  // Check if API key is configured
  if (!settings.apiKey || settings.apiKey.trim() === '') {
    return [];
  }

  const prompt = `你是一位世界顶级英语教育专家与语言学导师。
请针对英语生词 "${cleanWord}"（其在当前视频台词中出现于："${contextEn || cleanWord}"），专门为英语学习者生成 3 个地道、生动且场景多元的拓展例句。

【要求】：
1. 生成 3 个互不相同、由浅入深的实用例句（涵盖日常口语、职场/学术或情感表达等不同场景）。
2. 每条例句必须包含：
   - "en": 英文完整例句，自然包含 "${cleanWord}"（或其规则变体）。
   - "zh": 自然地道、对齐语义的中文译文。
   - "highlightWord": 句中对应的单词（便于高亮标注，如 "${cleanWord}"）。
   - "meaningExplanation": 深入的【词义用法解析】（约20-40字，点明该词在当前例句中的具体释义、语境色彩及所处短语含义）。
   - "grammarExplanation": 详尽的【语法结构解析】（约20-40字，剖析该词在句子中的句法功能、搭配关系、时态语态或句型结构）。

请严格输出合法的 JSON 格式（不要输出任何多余的 markdown 外部文字）：
{
  "examples": [
    {
      "en": "英文例句1",
      "zh": "中文翻译1",
      "highlightWord": "${cleanWord}",
      "meaningExplanation": "词义解析1",
      "grammarExplanation": "语法解析1"
    },
    {
      "en": "英文例句2",
      "zh": "中文翻译2",
      "highlightWord": "${cleanWord}",
      "meaningExplanation": "词义解析2",
      "grammarExplanation": "语法解析2"
    },
    {
      "en": "英文例句3",
      "zh": "中文翻译3",
      "highlightWord": "${cleanWord}",
      "meaningExplanation": "词义解析3",
      "grammarExplanation": "语法解析3"
    }
  ]
}`;

  try {
    const provider = settings.aiProvider || 'google';
    const defaultBaseUrl = AI_PRESETS[provider]?.apiBaseUrl || AI_PRESETS.google.apiBaseUrl;
    const defaultModel = AI_PRESETS[provider]?.modelName || AI_PRESETS.google.modelName;

    const rawResponse = await callLlmChat(
      {
        apiBaseUrl: settings.apiBaseUrl || defaultBaseUrl,
        apiKey: settings.apiKey,
        modelName: settings.modelName || defaultModel,
        timeoutMs: 25000
      },
      {
        messages: [
          {
            role: 'system',
            content: 'You are an elite ESL English teacher and linguist. You output strictly valid JSON conforming to the requested schema.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        responseFormatJson: true
      }
    );

    const parsed = sanitizeAndParseJson<any>(rawResponse, () => null);
    const examplesList = Array.isArray(parsed?.examples)
      ? parsed.examples
      : Array.isArray(parsed)
      ? parsed
      : [];

    if (examplesList.length > 0) {
      const results: WordExample[] = examplesList.slice(0, 3).map((item: any) => ({
        en: String(item.en || '').trim(),
        zh: String(item.zh || '').trim(),
        highlightWord: String(item.highlightWord || cleanWord).trim(),
        meaningExplanation: item.meaningExplanation ? String(item.meaningExplanation).trim() : undefined,
        grammarExplanation: item.grammarExplanation ? String(item.grammarExplanation).trim() : undefined
      }));

      // If valid examples obtained, also update persistent cache
      try {
        const cached = await getWordExplanationCache(cleanWord.toLowerCase(), contextEn);
        if (cached) {
          cached.aiExtendedExamples = results;
          await setWordExplanationCache(cleanWord.toLowerCase(), contextEn, cached);
        }
      } catch (_) {}

      return results;
    }
  } catch (err) {
    console.warn('[aiExplainer] Failed to generate AI extended examples:', err);
  }

  return [];
}
