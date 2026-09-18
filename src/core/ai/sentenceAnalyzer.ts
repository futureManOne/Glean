import {
  SubtitleCue,
  AppSettings,
  SentenceDeepAnalysis,
  SentenceSyntacticBreakdown,
  SentenceIdiomOrPhrase,
  SentencePronunciationTip,
  SupportedLang,
  AI_PRESETS
} from '@/types';
import { callLlmChat, callLlmChatStream } from '@/core/api/llmClient';

/**
 * Robust zero-failure JSON cleaner and parser for sentence analysis.
 * Handles Markdown code fences, stray text, unescaped characters, smart quotes, and trailing commas.
 */
export function sanitizeAndParseJson<T>(raw: string, fallbackFactory: () => T): T {
  if (!raw || typeof raw !== 'string') {
    return fallbackFactory();
  }

  // 1. Direct parse attempt
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
    // Continue to lenient quote and escape recovery
  }

  // 6. Lenient quote and escape recovery
  try {
    const recovered = cleaned
      .replace(/[\u201C\u201D\u2018\u2019]/g, '"') // Replace smart quotes with standard double quotes
      .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"') // Convert single-quoted JSON strings to double-quoted
      .replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(recovered) as T;
  } catch (finalErr) {
    console.warn('[sentenceAnalyzer] JSON recovery failed on raw content:', raw.slice(0, 120), finalErr);
    return fallbackFactory();
  }
}

/**
 * Build prompt for Grok 4.6 linguistic sentence deep analysis.
 */
export function buildSentencePrompt(
  sentenceEn: string,
  sentenceZh?: string,
  targetLang: SupportedLang = 'zh-CN'
): string {
  if (targetLang === 'ja') {
    return `あなたは世界トップクラスの英語言語学専門家・映画スピーチコーチ・同時通訳者です。
以下の動画セリフ文に対して、多角的で深い言語学的解説と発音・構文分析を行ってください。

【英語台詞】：${sentenceEn}
${sentenceZh ? `【参考字幕】：${sentenceZh}\n` : ''}
Markdown等の装飾を一切含めず、純粋なJSONのみを出力してください：
{
  "authenticTranslation": "文脈に即した自然で高品質な日本語意訳（機械翻訳調を完全に排した自然な表現）",
  "contextTone": "話し手の感情・ニュアンス・トーン（例：自信、親しみやすさ、提案、ユーモアなど）",
  "syntacticBreakdown": [
    {
      "clause": "主要な節/句/意味のまとまり（例：figured why don't I）",
      "role": "文法機能や構文上の役割（例：主語省略の主文述語 + 疑問否定従属節）",
      "explanation": "文中での主要な構文作用と理解のポイント"
    }
  ],
  "idiomsAndPhrases": [
    {
      "phrase": "文中の重要イディオム・動詞コロケーション（例：why don't I...）",
      "meaning": "自然な日本語訳（例：〜してみようか / 私も〜してはどうか）",
      "usageNote": "語法・ニュアンス・日常会話での使われ方"
    }
  ],
  "pronunciationTips": [
    {
      "phenomenon": "音声現象の分類（例：連結（リンキング）/ 脱落 / 弱化 / リズムアクセント）",
      "detail": "単語間の具体的な音変化と発音のコツ"
    }
  ]
}`;
  }

  if (targetLang === 'en') {
    return `You are an elite English linguist, ESL speech coach, and simultaneous interpreter.
Provide an in-depth linguistic, syntactic, and phonological breakdown of the following video subtitle sentence.

【Original Sentence】: ${sentenceEn}
${sentenceZh ? `【Reference Subtitle】: ${sentenceZh}\n` : ''}
Output strict JSON only without any markdown formatting or commentary:
{
  "authenticTranslation": "Natural idiomatic English paraphrasing or native register expression",
  "contextTone": "Speaker's pragmatic tone and attitude (e.g. casual self-reflection, persuasive, collaborative)",
  "syntacticBreakdown": [
    {
      "clause": "Key clause or semantic chunk (e.g. figured why don't I)",
      "role": "Syntactic function or clause role (e.g. elliptical main clause with omitted subject + negative question)",
      "explanation": "Linguistic function and structural nuance"
    }
  ],
  "idiomsAndPhrases": [
    {
      "phrase": "Key collocation, phrasal verb, or idiom (e.g. why don't I)",
      "meaning": "Natural meaning and pragmatic intent",
      "usageNote": "Usage notes and conversational frequency"
    }
  ],
  "pronunciationTips": [
    {
      "phenomenon": "Phonological classification (e.g. Liaison, Flapping, Weak Form)",
      "detail": "Precise phonetic transition between words and native speech mechanics"
    }
  ]
}`;
  }

  return `你是一位世界顶级的英语语言学专家、影视口语专家和同声传译导师。
请对以下视频台词句子进行多维度的深度语言学精讲与语音拆解。

【原声台词】：${sentenceEn}
${sentenceZh ? `【参考字幕】：${sentenceZh}\n` : ''}
请直接输出严格合规的 JSON 数据（不要包含任何 markdown 说明文字或外部注释），字段定义与规范如下：
{
  "authenticTranslation": "地道母语级高质量中文意译（结合上下文，传神生动、符合母语表达习惯，坚决摒弃机器翻译或生硬直译）",
  "contextTone": "说话人语境语气与情感色彩（如：自嘲幽默、诚恳建议、探讨启发、自信分享、委婉商榷等）",
  "syntacticBreakdown": [
    {
      "clause": "核心分句/从句/意群片段（如：figured why don't I）",
      "role": "句法功能或从句角色（如：省略主语的主句谓语 + 疑问否定从句）",
      "explanation": "该片段在句中的核心句法作用与理解要点（如：口语自述中省略主语 I，引出行动提议）"
    }
  ],
  "idiomsAndPhrases": [
    {
      "phrase": "句中核心短语、动词搭配或惯用表达（如：why don't I...）",
      "meaning": "中文地道释义（如：为什么不...呢 / 不如我也...）",
      "usageNote": "用法说明、语用场景或搭配拓展（如：常用于提出非正式口语建议或引出个人展示）"
    }
  ],
  "pronunciationTips": [
    {
      "phenomenon": "语音现象分类（如：连读与弱读 / 失去爆破 / 闪音T / 节奏重音）",
      "detail": "具体的词间音变细节与发音技巧（如：don't I 发生连读形成 /doʊn.taɪ/；also 处于非重读位置弱化）"
    }
  ]
}`;
}

/**
 * Build high-value pedagogical Markdown prompt for real-time streaming sentence analysis.
 * Generates a friendly, fixed-format 4-dimension template.
 */
export function buildSentenceMarkdownPrompt(
  sentenceEn: string,
  sentenceZh?: string,
  targetLang: SupportedLang = 'zh-CN'
): string {
  if (targetLang === 'ja') {
    return `あなたはトップレベルの英語言語学専門家・映画スピーチコーチ・同時通訳者です。
以下の動画セリフに対して、以下の固定Markdownフォーマットで分かりやすく魅力的な解説を出力してください：

【原語セリフ】：${sentenceEn}
${sentenceZh ? `【参考字幕】：${sentenceZh}\n` : ''}

必ず以下の4つのセクション見出しと箇条書きフォーマットをそのまま厳格に守って出力してください：

### 🎯 地道意訳与語境トーン
- **自然な意訳**：(文脈に即した自然で高品質な日本語意訳。直訳や機械翻訳調を完全に排す)
- **語境トーン**：(話者の感情、ニュアンス、口調)

### 🔍 核心構文構造の解読
- **構文構造**：(主文・従属節・省略等の主要な文法骨格)
- **理解の要点**：(なぜこのように表現するのか、日常会話における重要性)

### 💡 必須熟語・重要表現
- **[重要表現 1]**：自然な訳 · 口語での使われ方やコロケーション
- **[重要表現 2]**：自然な訳 · 口語での使われ方やコロケーション

### 🎙️ 発音とリスニングのコツ
- **音変化テクニック**：(リンキング、弱形、フラップT、脱落等の具体的な発音ポイント)
- **リズムとアクセント**：(強勢の位置と抑揚のコツ)`;
  }

  if (targetLang === 'en') {
    return `You are an elite English linguist, Hollywood speech coach, and simultaneous interpreter.
Provide an in-depth linguistic, syntactic, and phonological breakdown of the following subtitle sentence using this exact Markdown template:

【Original Line】：${sentenceEn}
${sentenceZh ? `【Reference Subtitle】：${sentenceZh}\n` : ''}

Strictly adhere to the following 4 section headers and bullet formats:

### 🎯 Contextual Nuance & Pragmatic Tone
- **Idiomatic Paraphrase**: (Natural, native-register English paraphrasing reflecting real-world conversation)
- **Tone & Mood**: (Speaker's subtle attitude, emotion, and pragmatic intent)

### 🔍 Syntactic Breakdown & Structure
- **Sentence Architecture**: (Core clause structure, ellipsis, dependent clauses, or idioms)
- **Key Takeaway**: (Why the speaker structured it this way and common learner pitfalls)

### 💡 Core Collocations & Idiomatic Phrasing
- **[Phrase/Collocation 1]**: Meaning · Real-world conversational context and usage
- **[Phrase/Collocation 2]**: Meaning · Real-world conversational context and usage

### 🎙️ Native Phonetics & Listening Mechanics
- **Sound Transitions**: (Liaison, flapping, reductions, weak forms, or elision)
- **Rhythm & Stress**: (Tonic stress and cadence tips to sound natural)`;
  }

  return `你是一位世界顶级的影视英语语言学专家、好莱坞口语教练和同传导师。
请对以下视频原声台词进行多维度的深度精讲与语音拆解。

【原声台词】：${sentenceEn}
${sentenceZh ? `【参考字幕】：${sentenceZh}\n` : ''}

请严格按照以下友好的 4 大固定结构与 Markdown 模板逐项直接输出（保持标题与加粗前缀完全一致，内容具体精炼、紧贴影视语境，直接输出结构化解析，无需前置思考独白）：

### 🎯 地道意译与语境基调
- **地道意译**：(结合原片语境与口语习惯，给出极为传神生动的母语翻译，坚决拒绝生硬机翻)
- **语境基调**：(透析说话人此时的真实情绪、潜台词与语用意图，如自嘲、启发、随和分享、诚恳建议等)

### 🔍 核心句法结构拆解
- **句型结构**：(清晰拆解句子主干，指出省略主语、从句类型、惯用搭配等核心语法骨架)
- **理解要点**：(解释该句型在母语口语中的核心作用与中国学习者最容易混淆的理解卡点)

### 💡 核心短语与高频表达
- **[短语/生词 1]**：地道中文释义 · 口语实战语境与搭配用法
- **[短语/生词 2]**：地道中文释义 · 口语实战语境与搭配用法

### 🎙️ 口语发音与听力秘诀
- **连读/弱读/音变**：(明确指出具体的词间发音技巧，如连读 Linking、闪音 Flap T、失去爆破、功能词弱读等)
- **节奏与重音**：(指出核心重音节拍与语调起伏，传授如何像母语者一样地道跟读)`;
}


/**
 * Common English idioms & collocations repository for accurate offline pattern matching.
 */
interface CommonPhraseRule {
  pattern: RegExp;
  phrase: string;
  meaning: string;
  usageNote: string;
}

const COMMON_PHRASE_RULES: CommonPhraseRule[] = [
  {
    pattern: /\bwhy don't (?:I|you|we)\b/i,
    phrase: "why don't (I/you/we)...",
    meaning: "为什么不...呢 / 不如我也/我们...",
    usageNote: "英语口语中提出非正式建议、行动提议或自然引出展示的极其地道的句型。"
  },
  {
    pattern: /\bshow (?:you|us|them|me)\b/i,
    phrase: "show someone something",
    meaning: "向某人展示/演示某事",
    usageNote: "典型双宾语结构 (show sb sth)，在分享、教学和演讲场景中极高频使用。"
  },
  {
    pattern: /\bcontent creator\b/i,
    phrase: "content creator",
    meaning: "内容创作者 / 自媒体博主",
    usageNote: "数字时代的固定职业称谓，泛指独立制作视频、图文与多媒体教学内容的创作者。"
  },
  {
    pattern: /\brun an? (?:[a-z]+\s+)?company\b/i,
    phrase: "run a company",
    meaning: "经营/管理一家公司",
    usageNote: "run 在口语和商务表达中常表示“运营、管理、经营”，比 operate 更加地道自然。"
  },
  {
    pattern: /\bfigure(?:d)? out\b/i,
    phrase: "figure out",
    meaning: "弄明白，搞清楚，想出解决办法",
    usageNote: "核心动词短语，口语与书面语中表示经过思考后得出结论或解决方案。"
  },
  {
    pattern: /\bdeal(?:t)? with\b/i,
    phrase: "deal with",
    meaning: "处理，应对，应付",
    usageNote: "广泛用于应对复杂工作任务、挑战或人际协调场景。"
  },
  {
    pattern: /\bfocus(?:ed)? on\b/i,
    phrase: "focus on",
    meaning: "专注于，聚焦于",
    usageNote: "强调将注意力、资源或目标集中在某一方面，后常接名词或动名词。"
  },
  {
    pattern: /\btake care of\b/i,
    phrase: "take care of",
    meaning: "处理好，照顾，负责落实",
    usageNote: "多义短语，既可表示照顾人，也可表示承揽并圆满处理工作事务。"
  },
  {
    pattern: /\bmake sure\b/i,
    phrase: "make sure",
    meaning: "确保，设法确信",
    usageNote: "用于叮嘱或自我确认，后接 that 从句或省略 that 的完整陈述句。"
  },
  {
    pattern: /\bwork(?:ed|ing)? on\b/i,
    phrase: "work on",
    meaning: "致力于，从事于，改进",
    usageNote: "常用于表示正在持续推进的项目、技能提升或难题攻关。"
  },
  {
    pattern: /\bas well as\b/i,
    phrase: "as well as",
    meaning: "不仅...而且... / 以及，还",
    usageNote: "连接并列成分的常用短语，语意重心通常更倾向于前面的核心部分。"
  },
  {
    pattern: /\bin terms of\b/i,
    phrase: "in terms of",
    meaning: "就...而言，在...方面",
    usageNote: "界定论述视角或考量维度的经典表达。"
  }
];

/**
 * Generate intelligent, rule-based offline sentence analysis fallback.
 * Ensures genuine, non-empty multi-dimensional analysis even without network or AI key.
 */
export function generateOfflineSentenceAnalysis(cue: SubtitleCue): SentenceDeepAnalysis {
  const textEn = (cue.textEn || '').trim();
  const textZh = (cue.textZh || '').trim();

  // 1. Authentic Translation & Context Tone
  const authenticTranslation = textZh || textEn || '暂无字幕';
  let contextTone = '客观自然的原声陈述语调，传达清晰明确的事实信息与语境逻辑。';

  if (textEn.includes('?')) {
    contextTone = '启发式探讨与疑问语气，旨在引导听众思考、引发共鸣并建立亲近的互动感。';
  } else if (textEn.includes('!')) {
    contextTone = '情绪饱满的强调与激发语气，传达出强烈的表达热情与观点感召力。';
  } else if (/why don't (?:I|you|we)/i.test(textEn)) {
    contextTone = '诚恳亲切的行动建议与自述语气，通过互动提议自然拉近与听众的心理距离。';
  } else if (/\b(?:I think|I believe|in my opinion|figured|feel like)\b/i.test(textEn)) {
    contextTone = '诚恳的经验分享与思索口吻，以个人视角平实展开叙述。';
  } else if (/\b(?:please|make sure|remember to|let's|check)\b/i.test(textEn)) {
    contextTone = '清晰明确的行动指引与教学口吻，条理分明且具有良好示范性。';
  }

  // 2. Syntactic Breakdown (Rule-based clause & fragment segmentation)
  const syntacticBreakdown: SentenceSyntacticBreakdown[] = [];

  // Split by clauses using punctuation or strong conjunction boundaries
  const rawSegments = textEn
    .split(/([,;!?]|\s+(?:and|but|or|so|because|although|since|while|when|if|that|which)\s+)/i)
    .map(s => s.trim())
    .filter(Boolean);

  // Re-assemble segments into meaningful linguistic clauses
  const clauses: string[] = [];
  let tempBuffer = '';
  for (const part of rawSegments) {
    if (/^[,;!?]$/.test(part)) {
      if (tempBuffer) {
        clauses.push(tempBuffer + part);
        tempBuffer = '';
      }
    } else if (/^(?:and|but|or|so|because|although|since|while|when|if|that|which)$/i.test(part)) {
      if (tempBuffer) {
        clauses.push(tempBuffer);
      }
      tempBuffer = part;
    } else {
      tempBuffer = tempBuffer ? `${tempBuffer} ${part}` : part;
    }
  }
  if (tempBuffer) {
    clauses.push(tempBuffer);
  }

  // If segmentation resulted in no clauses, use the entire sentence
  const finalClauses = clauses.length > 0 ? clauses : [textEn];

  finalClauses.forEach((cl, idx) => {
    let role = idx === 0 ? '主句核心主干 (Main Clause)' : '并列/从属延续从句 (Subordinate Clause)';
    let explanation = '构建句子核心陈述骨架，传递主要动作与语用意图。';

    if (/^(?:if|when|while|because|since|although|as)\b/i.test(cl)) {
      role = '状语从句 (Adverbial Clause)';
      explanation = '交代主句动作发生的背景前提、时间序列、因果关联或让步条件。';
    } else if (/^(?:that|which|who|whose)\b/i.test(cl)) {
      role = '关系/定语从句 (Attributive Clause)';
      explanation = '紧随先行词之后，补充提供具体限定与细节修饰信息。';
    } else if (/^(?:why|how|what|where|whether)\b/i.test(cl) || /why don't/i.test(cl)) {
      role = '疑问/宾语从句 (Interrogative / Noun Clause)';
      explanation = '承接前述动词引导核心议题，提出疑问或明确行动目标。';
    } else if (/^(?:and|but|so|yet|or)\b/i.test(cl)) {
      role = '并列连接分句 (Coordinate Clause)';
      explanation = '以并列或转折逻辑顺承前文意群，拓展句子信息层次。';
    } else if (idx === 0 && /\bfigured\b/i.test(cl)) {
      role = '省略主语的主句谓语 (Elliptical Main Clause)';
      explanation = '口语自述中常用省略形式 (I figured)，使语气更加随意自然、平易近人。';
    } else if (idx > 0) {
      role = '宾语短语与修饰成分 (Complementary Phrase)';
      explanation = '充当动词的直接宾语或补充修饰成分，完善动作的具体指向。';
    }

    syntacticBreakdown.push({
      clause: cl,
      role,
      explanation
    });
  });

  // 3. Idioms and Key Collocations
  const idiomsAndPhrases: SentenceIdiomOrPhrase[] = [];
  for (const rule of COMMON_PHRASE_RULES) {
    if (rule.pattern.test(textEn)) {
      idiomsAndPhrases.push({
        phrase: rule.phrase,
        meaning: rule.meaning,
        usageNote: rule.usageNote
      });
    }
  }

  // Fallback: If no predefined idiom matched, dynamically extract verb/noun phrases from words
  if (idiomsAndPhrases.length === 0) {
    const words = textEn.replace(/[^a-zA-Z\s]/g, '').split(/\s+/).filter(w => w.length > 2);
    if (words.length >= 2) {
      const phraseCandidate = `${words[0]} ${words[1]}`;
      idiomsAndPhrases.push({
        phrase: phraseCandidate,
        meaning: `“${phraseCandidate}” 核心语境搭配`,
        usageNote: '句子中的核心词汇组合，建议结合上下文朗读以培养语感。'
      });
    } else {
      idiomsAndPhrases.push({
        phrase: textEn,
        meaning: textZh || '核心语句表达',
        usageNote: '完整原声音调表达，适合作为跟读练习的完整单元。'
      });
    }
  }

  // 4. Pronunciation & Listening Tips (Liaison, Reductions, Stress)
  const pronunciationTips: SentencePronunciationTip[] = [];

  // Tip A: Consonant-to-Vowel Liaison detection
  const wordsForPhonetics = textEn.replace(/[^a-zA-Z\s']/g, '').split(/\s+/).filter(Boolean);
  let liaisonFound = false;
  for (let i = 0; i < wordsForPhonetics.length - 1; i++) {
    const w1 = wordsForPhonetics[i].toLowerCase();
    const w2 = wordsForPhonetics[i + 1].toLowerCase();
    const endsWithConsonant = /[bcdfghjklmnpqrstvwxyz]$/i.test(w1);
    const startsWithVowel = /^[aeiou]/i.test(w2);

    if (endsWithConsonant && startsWithVowel) {
      pronunciationTips.push({
        phenomenon: '辅音接元音连读 (Consonant-to-Vowel Linking)',
        detail: `“${w1}” 词尾辅音与 “${w2}” 词首元音自然拼合连读（如 /${w1.slice(-1)}.${w2.slice(0, 2)}/），避免在词与词之间停顿。`
      });
      liaisonFound = true;
      break;
    }
  }

  if (!liaisonFound) {
    pronunciationTips.push({
      phenomenon: '连贯语流连读 (Smooth Flow Linking)',
      detail: '口语中前后相邻单词在语流中保持气流连续不断，前词末音与后词首音平滑过渡。'
    });
  }

  // Tip B: Function Word Reduction (弱读与略读)
  const weakWordMatches = wordsForPhonetics.filter(w =>
    ['to', 'for', 'and', 'of', 'you', 'a', 'the', 'that', 'in', 'at'].includes(w.toLowerCase())
  );
  if (weakWordMatches.length > 0) {
    const sampleWeak = Array.from(new Set(weakWordMatches)).slice(0, 2).join('、');
    pronunciationTips.push({
      phenomenon: '功能词弱读与中央元音化 (Weak Forms & Schwa)',
      detail: `句中文法功能词（如 “${sampleWeak}”）在正常语速下元音弱化为轻柔短促的 /ə/，不占用主要节拍，使重读实词更加突出。`
    });
  } else {
    pronunciationTips.push({
      phenomenon: '非重读音节弱化 (Unstressed Syllable Reduction)',
      detail: '多音节词的非重读音节及语法助词需轻读短读，形成明暗交替的韵律节拍。'
    });
  }

  // Tip C: Stop T / Flap T / Elision (失去爆破与闪音)
  if (/\b\w+t\b/i.test(textEn) || /\b\w+d\b/i.test(textEn)) {
    pronunciationTips.push({
      phenomenon: '失去爆破与闪音T (Stop T & Flap T)',
      detail: '词尾 /t/ 或 /d/ 在辅音前只做口型成阻而不爆破出声（失去爆破）；在两个元音之间常轻弹为齿龈闪音 [ɾ]，使语流更轻快流畅。'
    });
  } else {
    pronunciationTips.push({
      phenomenon: '核心信息重音与语调曲线 (Tonic Syllable & Intonation)',
      detail: textEn.includes('?')
        ? '疑问句末尾根据互动语气采用微扬或微降语调，核心疑问信息词承担最大音高与重音。'
        : '陈述句末尾通常采用平稳降调，句中关键实词赋予清晰的时长与音高重音。'
    });
  }

  return {
    sentenceEn: textEn,
    sentenceZh: textZh,
    authenticTranslation,
    contextTone,
    syntacticBreakdown,
    idiomsAndPhrases,
    pronunciationTips,
    source: 'offline-fallback',
    isFallback: true
  };
}

/**
 * Main function: Analyze a subtitle sentence in context using Grok 4.6 with graceful 4-dimension fallback.
 */
export async function analyzeSentenceInContext(
  cue: SubtitleCue,
  settings: AppSettings
): Promise<SentenceDeepAnalysis> {
  const sentenceEn = (cue.textEn || '').trim();
  const sentenceZh = (cue.textZh || '').trim();

  // If no API key configured, immediately return offline fallback
  if (!settings.apiKey || settings.apiKey.trim() === '') {
    return generateOfflineSentenceAnalysis(cue);
  }

  try {
    const targetLang: SupportedLang = settings.uiLanguage || (settings.secondaryLang === 'ja' ? 'ja' : settings.secondaryLang === 'en' ? 'en' : 'zh-CN');
    const prompt = buildSentencePrompt(sentenceEn, sentenceZh, targetLang);
    const provider = settings.aiProvider || 'google';
    const defaultBaseUrl = AI_PRESETS[provider]?.apiBaseUrl || AI_PRESETS.google.apiBaseUrl;
    const defaultModel = AI_PRESETS[provider]?.modelName || AI_PRESETS.google.modelName;

    const rawResponse = await callLlmChat(
      {
        apiBaseUrl: settings.apiBaseUrl || defaultBaseUrl,
        apiKey: settings.apiKey,
        modelName: settings.modelName || defaultModel,
        timeoutMs: 12000 // 12s timeout for sentence analysis
      },
      {
        messages: [
          {
            role: 'system',
            content: 'You are an expert English linguist, phonetics specialist, and bilingual educator. You only respond with strictly valid JSON.'
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

    // Multi-stage JSON sanitization
    const parsed = sanitizeAndParseJson<any>(rawResponse, () => null);

    if (parsed && typeof parsed === 'object') {
      const authenticTranslation = String(parsed.authenticTranslation || sentenceZh || sentenceEn);
      const contextTone = String(parsed.contextTone || '客观自然原声叙述');

      const syntacticBreakdown: SentenceSyntacticBreakdown[] = Array.isArray(parsed.syntacticBreakdown) && parsed.syntacticBreakdown.length > 0
        ? parsed.syntacticBreakdown.map((item: any) => ({
            clause: String(item.clause || ''),
            role: String(item.role || '核心成分'),
            explanation: String(item.explanation || '')
          }))
        : generateOfflineSentenceAnalysis(cue).syntacticBreakdown;

      const idiomsAndPhrases: SentenceIdiomOrPhrase[] = Array.isArray(parsed.idiomsAndPhrases) && parsed.idiomsAndPhrases.length > 0
        ? parsed.idiomsAndPhrases.map((item: any) => ({
            phrase: String(item.phrase || ''),
            meaning: String(item.meaning || ''),
            usageNote: item.usageNote ? String(item.usageNote) : undefined
          }))
        : generateOfflineSentenceAnalysis(cue).idiomsAndPhrases;

      const pronunciationTips: SentencePronunciationTip[] = Array.isArray(parsed.pronunciationTips) && parsed.pronunciationTips.length > 0
        ? parsed.pronunciationTips.map((item: any) => ({
            phenomenon: String(item.phenomenon || '地道发音技巧'),
            detail: String(item.detail || '')
          }))
        : generateOfflineSentenceAnalysis(cue).pronunciationTips;

      return {
        sentenceEn,
        sentenceZh,
        authenticTranslation,
        contextTone,
        syntacticBreakdown,
        idiomsAndPhrases,
        pronunciationTips,
        source: settings.aiProvider === 'google' ? 'google' : 'grok-ai',
        isFallback: false
      };
    } else {
      console.warn('[sentenceAnalyzer] Failed to parse valid JSON from LLM response, using offline fallback');
      return generateOfflineSentenceAnalysis(cue);
    }
  } catch (err: any) {
    console.warn('[sentenceAnalyzer] AI call failed, gracefully falling back:', err?.message || err);
    return generateOfflineSentenceAnalysis(cue);
  }
}

/**
 * Parse structured sections from the friendly Markdown response.
 */
export function parseMarkdownAnalysis(markdown: string, cue: SubtitleCue): SentenceDeepAnalysis {
  const textEn = (cue.textEn || '').trim();
  const textZh = (cue.textZh || '').trim();

  let authenticTranslation = '';
  let contextTone = '';
  const syntacticBreakdown: SentenceSyntacticBreakdown[] = [];
  const idiomsAndPhrases: SentenceIdiomOrPhrase[] = [];
  const pronunciationTips: SentencePronunciationTip[] = [];

  // Extract translation
  const transMatch = markdown.match(/(?:-\s*\*\*地道意译\*\*|自然な意訳|Idiomatic Paraphrase)[：:]\s*(.+)/i);
  if (transMatch) {
    authenticTranslation = transMatch[1].replace(/^[（(](?:.*?)[）)]\s*/, '').trim();
  }

  // Extract tone
  const toneMatch = markdown.match(/(?:-\s*\*\*语境基调\*\*|語境トーン|Tone & Mood)[：:]\s*(.+)/i);
  if (toneMatch) {
    contextTone = toneMatch[1].replace(/^[（(](?:.*?)[）)]\s*/, '').trim();
  }

  // Extract sections by headers
  const sections = markdown.split(/###\s+/);
  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;

    // Syntactic section
    if (trimmed.includes('句法') || trimmed.includes('構文') || trimmed.includes('Syntactic')) {
      const lines = trimmed.split('\n').filter(l => l.trim().startsWith('-'));
      for (const line of lines) {
        const match = line.match(/^-\s*\*\*(.+?)\*\*[：:]\s*(.+)/);
        if (match) {
          syntacticBreakdown.push({
            clause: match[1].trim(),
            role: '句法结构',
            explanation: match[2].trim()
          });
        }
      }
    }

    // Idioms section
    if (trimmed.includes('短语') || trimmed.includes('熟語') || trimmed.includes('Collocation') || trimmed.includes('Phrasing')) {
      const lines = trimmed.split('\n').filter(l => l.trim().startsWith('-'));
      for (const line of lines) {
        const match = line.match(/^-\s*\*\*(?:\[)?(.+?)(?:\])?\*\*[：:]\s*(.+)/);
        if (match) {
          const phrase = match[1].replace(/^\[|\]$/g, '').trim();
          const detail = match[2].trim();
          const parts = detail.split(/[·•]/);
          idiomsAndPhrases.push({
            phrase,
            meaning: parts[0]?.trim() || detail,
            usageNote: parts[1]?.trim()
          });
        }
      }
    }

    // Pronunciation section
    if (trimmed.includes('发音') || trimmed.includes('発音') || trimmed.includes('Phonetic') || trimmed.includes('Listening')) {
      const lines = trimmed.split('\n').filter(l => l.trim().startsWith('-'));
      for (const line of lines) {
        const match = line.match(/^-\s*\*\*(.+?)\*\*[：:]\s*(.+)/);
        if (match) {
          pronunciationTips.push({
            phenomenon: match[1].trim(),
            detail: match[2].trim()
          });
        }
      }
    }
  }

  return {
    sentenceEn: textEn,
    sentenceZh: textZh,
    authenticTranslation: authenticTranslation || textZh || textEn,
    contextTone: contextTone || '结合语境的自然真实口调',
    syntacticBreakdown,
    idiomsAndPhrases,
    pronunciationTips,
    rawMarkdown: markdown,
    source: 'grok-ai',
    isFallback: false
  };
}

/**
 * Real-time streaming sentence analysis using the friendly Markdown template.
 * Strictly verifies API key and throws an error if missing, completely eliminating canned dummy data.
 */
export async function streamSentenceAnalysis(
  cue: SubtitleCue,
  settings: AppSettings,
  onChunk: (delta: string, accumulated: string) => void,
  abortSignal?: AbortSignal
): Promise<string> {
  const sentenceEn = (cue.textEn || '').trim();
  const sentenceZh = (cue.textZh || '').trim();

  const apiKey = (settings.apiKey || '').trim();
  if (!apiKey) {
    const err: any = new Error('MISSING_API_KEY');
    err.isMissingApiKey = true;
    throw err;
  }

  const targetLang: SupportedLang = settings.uiLanguage || (settings.secondaryLang === 'ja' ? 'ja' : settings.secondaryLang === 'en' ? 'en' : 'zh-CN');
  const prompt = buildSentenceMarkdownPrompt(sentenceEn, sentenceZh, targetLang);
  const provider = settings.aiProvider || 'google';
  const defaultBaseUrl = AI_PRESETS[provider]?.apiBaseUrl || AI_PRESETS.google.apiBaseUrl;
  const defaultModel = AI_PRESETS[provider]?.modelName || AI_PRESETS.google.modelName;

  const result = await callLlmChatStream(
    {
      apiBaseUrl: settings.apiBaseUrl || defaultBaseUrl,
      apiKey: settings.apiKey,
      modelName: settings.modelName || defaultModel,
      timeoutMs: 60000 // 60s generous timeout for streaming deep reasoning models
    },
    {
      messages: [
        {
          role: 'system',
          content: 'You are an elite English linguistics professor, Hollywood speech coach, and bilingual interpreter. Provide direct, highly practical, and structured analysis following the exact markdown structure without internal chain-of-thought monologue.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      maxTokens: 1200
    },
    onChunk,
    abortSignal
  );

  return result;
}
