# Project: Glean (拾句)

## Architecture
- **Transport & Storage Layer**:
  - `src/core/api/llmClient.ts`: Core transport layer handling Bearer auth, `/v1/models` and `/v1/chat/completions` requests. In browser content scripts, transparently proxies requests through `chrome.runtime.sendMessage` to `src/entrypoints/background.ts` to bypass web origin CORS / preflight restrictions. In test environments (Bun/Node), falls back to direct `fetch()`.
  - `src/entrypoints/background.ts`: MV3 background service worker with host permissions handling `TEST_AI_CONNECTION` and `LLM_CHAT_REQUEST`.
  - `src/store/useAppStore.ts`: Zustand store backed by `chrome.storage.local` with real-time `chrome.storage.onChanged` cross-context synchronization between popup, in-page settings, and content scripts.
- **Word Context & Dictionary Engine (R2 & R4)**:
  - `src/core/dictionary/ecdictMini.ts`: Expanded offline high-frequency vocabulary (~1,500 core words) with authentic IPA, POS, Chinese definitions, CEFR ratings (A1-C2), and Collins stars.
  - `src/core/dictionary/aiExplainer.ts`: Grok 4.6 word-in-sentence context prompt, JSON sanitizer, and 5-layer defensive exception isolation fallback (Grok 4.6 -> JSON cleaner -> offline rich -> expanded ECDICT Mini -> safe universal fallback).
  - `src/ui/components/WordPopup.tsx`: Enhanced 3-tab UI (语境精析, 语法与辨析, 拓展例句), CEFR/Collins badges, speaker intent highlight, offline fallback indicator, and retry action.
- **Sentence Deep Analysis Engine (R3)**:
  - `src/core/ai/sentenceAnalyzer.ts`: Grok 4.6 prompt and parser extracting 4 linguistic dimensions: Authentic Translation & Context Tone, Syntactic Breakdown, Idioms & Phrases, Spoken Pronunciation & Listening Tips.
  - `src/ui/components/SubtitleOverlay.tsx`: Sparkles "AI 单句精讲" action button adjacent to the AP switch.
  - `src/ui/components/TranscriptPanel.tsx`: Sparkles "AI 单句精讲" action button on each subtitle line item.
  - `src/ui/components/SentenceAnalysisCard.tsx`: Shadow DOM encapsulated glassmorphism card/drawer displaying multi-dimensional sentence breakdown.
  - `src/ui/components/AppOverlay.tsx`: Mounting point inside `<language-reactor-overlay>` shadowRoot.
- **UI & Settings Presets (R1)**:
  - `src/entrypoints/popup/App.tsx`: Provider preset selector with dedicated presets (Google Gemini, DeepSeek, OpenAI, Grok, Custom Gateway), instant connection test button with latency feedback, and persistent save.
  - `src/ui/components/QuarkControlBar.tsx`: In-page settings modal with provider presets and connection test.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | AI Provider Presets | Endpoints for Gemini, DeepSeek, OpenAI, Grok & Custom Gateway with instant test | M1 | ORIGINAL_REQUEST §1 |
| 2 | Instant Connection Test | Test Bearer auth via `/v1/models` and `/v1/chat/completions` with latency reporting | M1 | ORIGINAL_REQUEST §1 |
| 3 | MV3 Background CORS Proxy | Route LLM fetch through background service worker to prevent content-script CORS blocks | M1 | Survey 1 Investigation |
| 4 | Chrome Storage Local Persistence & Sync | Persist settings to `chrome.storage.local` and sync across popup & content scripts | M1 | Survey 1 Investigation |
| 5 | Grok 4.6 Word in Context Deep Parsing | Extract word position, context meaning/intent, IPA, definitions, grammar role, CEFR/Collins | M2 | ORIGINAL_REQUEST §2 |
| 6 | Sentence Comparison & Extended Examples | Compare sentence usage vs alternatives, provide collocations and bilingual examples | M2 | ORIGINAL_REQUEST §2 |
| 7 | WordPopup Enhanced 3-Tab UI | Render 语境精析, 语法与辨析, 拓展例句 tabs with badges, intent strip, and audio button | M2 | ORIGINAL_REQUEST §2 |
| 8 | Expanded ECDICT Mini Core Vocabulary | Enriched offline vocabulary (~1,500 words) with authentic IPA, POS, and CEFR | M2 | ORIGINAL_REQUEST §4 |
| 9 | 5-Layer Exception Isolation & Fallback | 10s timeout, JSON recovery, ECDICT fallback, offline indicator badge, retry button | M2 | ORIGINAL_REQUEST §4 |
| 10 | Floating Subtitle Overlay "AI 单句精讲" Button | Sparkles icon button placed adjacent to AP switch in SubtitleOverlay | M3 | ORIGINAL_REQUEST §3 |
| 11 | Sidebar Subtitle List "AI 单句精讲" Button | Sparkles icon button on hover/active on each subtitle row in TranscriptPanel | M3 | ORIGINAL_REQUEST §3 |
| 12 | Sentence Deep Analysis Data Model & Engine | Call Grok2API for authentic translation, tone, syntax breakdown, idioms, pronunciation tips | M3 | ORIGINAL_REQUEST §3 |
| 13 | SentenceAnalysisCard UI Component | High-contrast glassmorphism card/drawer mounted inside Shadow DOM | M3 | ORIGINAL_REQUEST §3 |
| 14 | E2E & Automated Test Suite Verification | Comprehensive unit & integration tests covering R1-R4, passing `bun test tests/` | M4 | ORIGINAL_REQUEST Acceptance |
| 15 | Zero-Warning Build Verification | Clean build with `bun run build` producing valid Chrome MV3 bundle with 0 errors | M4 | ORIGINAL_REQUEST Acceptance |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Grok2API Client, Background Transport & Persistent Settings | Types, llmClient, background proxy, useAppStore storage sync, popup & in-page settings UI | none | DONE |
| M2 | Word in Context AI Deep Parsing & WordPopup with ECDICT Fallback | Expanded ecdictMini, aiExplainer Grok prompt & 5-layer fallback, WordPopup 3-tab UI | M1 | DONE |
| M3 | Subtitle Overlay & Sidebar "AI Sentence Deep Analysis" UI & Drawer | sentenceAnalyzer, useAppStore actions, SubtitleOverlay & TranscriptPanel buttons, SentenceAnalysisCard | M1 | IN_PROGRESS |
| M4 | Final Milestone: E2E Test Suite & Adversarial Hardening & Build Verification | Run full E2E test suite (Tiers 1-4), adversarial tests (Tier 5), `bun test tests/` (100% pass), `bun run build` (clean) | M1, M2, M3 | PLANNED |

## Interface Contracts

### llmClient ↔ UI / Explainer Modules
```typescript
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
}

export interface LlmChatParams {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
  responseFormatJson?: boolean;
}

export async function testAiConnection(config: LlmConfig): Promise<ConnectionTestResult>;
export async function callLlmChat(config: LlmConfig, params: LlmChatParams): Promise<string>;
```

### aiExplainer ↔ WordPopup
```typescript
export interface WordExplanation {
  word: string;
  phonetic: string;
  quickCn: string;
  contextSentenceEn: string;
  contextSentenceZh: string;
  contextExplanation: string;
  contextIntent?: string;
  wordPosition?: string;
  definitions: WordDefinition[];
  examples: WordExample[];
  grammar: string;
  sentenceComparison?: WordSentenceComparison;
  collocations?: WordCollocation[];
  level: MasteryLevel;
  cefr?: CEFRLevel;
  collins?: number;
  source?: 'grok-ai' | 'offline-rich' | 'ecdict-mini';
  isFallback?: boolean;
  fallbackReason?: string;
}
```

### sentenceAnalyzer ↔ SentenceAnalysisCard
```typescript
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
  source?: 'grok-ai' | 'offline-fallback';
  isFallback?: boolean;
}
```

## Code Layout
- `src/types/index.ts` — Shared data contracts, settings types, preset constants, explanation models
- `src/core/api/llmClient.ts` — Unified transport layer, Bearer auth, CORS proxying, connection test
- `src/entrypoints/background.ts` — MV3 background message routing for cross-origin API calls
- `src/store/useAppStore.ts` — Reactive state, storage persistence & sync, word & sentence selection
- `src/entrypoints/popup/App.tsx` — Extension popup settings UI with presets and connection test
- `src/ui/components/QuarkControlBar.tsx` — In-page settings modal with presets and connection test
- `src/core/dictionary/ecdictMini.ts` — Expanded offline dictionary & lemmatization
- `src/core/dictionary/aiExplainer.ts` — Word in context parsing engine & fallback pipeline
- `src/ui/components/WordPopup.tsx` — 3-tab word popup with badges, intent, and error boundary
- `src/core/ai/sentenceAnalyzer.ts` — Sentence deep analysis engine & parser
- `src/ui/components/SubtitleOverlay.tsx` — Floating subtitle bar with AP switch & Sparkles button
- `src/ui/components/TranscriptPanel.tsx` — Sidebar subtitle list with hover Sparkles button
- `src/ui/components/SentenceAnalysisCard.tsx` — Sentence deep analysis card/drawer
- `src/ui/components/AppOverlay.tsx` — Shadow DOM host mounting point
- `tests/` — Test suites for bun test
