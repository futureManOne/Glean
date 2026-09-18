import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ChevronDown, Search, Check, RefreshCw, Loader2, Sparkles } from 'lucide-react';
import { AiProvider, AI_PRESETS, SupportedLang } from '@/types';
import {
  EXTENSION_CONTEXT_INVALIDATED_MESSAGE,
  fetchAvailableModelsDetailed,
  isExtensionContextInvalidatedError,
  FetchedModel
} from '@/core/api/llmClient';

export const PROVIDER_PRESET_MODELS: Record<AiProvider, string[]> = {
  sub2api: [
    'gpt-4o',
    'gpt-4o-mini',
    'o3-mini',
    'o1-mini',
    'o1',
    'gpt-4-turbo',
    'claude-3-5-sonnet',
    'claude-3-7-sonnet',
    'claude-3-5-haiku',
    'deepseek-chat',
    'deepseek-reasoner',
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'grok-4.6',
    'grok-chat-fast',
    'grok-latest'
  ],
  google: [
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
    'gemini-1.5-flash-8b'
  ],
  deepseek: [
    'deepseek-chat',
    'deepseek-coder',
    'deepseek-reasoner'
  ],
  openai: [
    'gpt-4o-mini',
    'gpt-4o',
    'o3-mini',
    'o1-mini',
    'gpt-4-turbo',
    'gpt-3.5-turbo'
  ],
  grok: [
    'grok-4.6',
    'grok-beta',
    'grok-vision-beta'
  ],
  custom: [
    'gpt-4o',
    'gpt-4o-mini',
    'o3-mini',
    'o1-mini',
    'claude-3-5-sonnet',
    'deepseek-chat',
    'gemini-2.5-flash'
  ]
};

interface SearchableModelSelectProps {
  value: string;
  onChange: (model: string) => void;
  provider: AiProvider;
  apiKey?: string;
  apiBaseUrl?: string;
  fetchedModels?: (string | FetchedModel)[];
  placeholder?: string;
  uiLanguage?: SupportedLang;
  onBeforeFetch?: () => Promise<boolean>;
  id?: string;
  ariaLabel?: string;
  className?: string;
}

const MODEL_SELECT_LABELS: Record<SupportedLang, {
  fetchModels: string;
  fetchingModels: string;
  fetchSuccess: (count: number) => string;
  fetchEmpty: string;
  fetchFailed: string;
  apiKeyRequired: string;
  authFailed: string;
  endpointNotFound: string;
  permissionRequired: string;
  searchPlaceholder: string;
  chooseModel: string;
  customModel: string;
  noMatch: string;
  browseHint: string;
  liveModels: string;
  recommended: string;
  presetGroup: string;
  otherGroup: string;
  selectedGroup: string;
}> = {
  'zh-CN': {
    fetchModels: '获取模型',
    fetchingModels: '获取中...',
    fetchSuccess: count => `已获取 ${count} 个可用模型`,
    fetchEmpty: '未获取到模型，请检查 API Key 与 Base URL',
    fetchFailed: '获取模型失败',
    apiKeyRequired: '请先输入 API Key',
    authFailed: 'API Key 无效或无权限',
    endpointNotFound: '未找到模型列表端点 (/v1/models)',
    permissionRequired: '需要授权访问当前 AI 服务域名',
    searchPlaceholder: '搜索模型名称或厂商...',
    chooseModel: '选择或输入模型',
    customModel: '使用自定义模型',
    noMatch: '未匹配到模型',
    browseHint: '可滚动浏览或输入关键字检索',
    liveModels: '个可用',
    recommended: '预设',
    presetGroup: '预设推荐',
    otherGroup: 'Other',
    selectedGroup: '当前选中'
  },
  en: {
    fetchModels: 'Fetch Models',
    fetchingModels: 'Fetching...',
    fetchSuccess: count => `Found ${count} available models`,
    fetchEmpty: 'No models returned. Check API Key and Base URL.',
    fetchFailed: 'Failed to fetch models',
    apiKeyRequired: 'Enter API Key first',
    authFailed: 'API Key invalid or unauthorized',
    endpointNotFound: 'Model endpoint not found (/v1/models)',
    permissionRequired: 'Authorization required for AI host',
    searchPlaceholder: 'Search models or vendor...',
    chooseModel: 'Choose or enter model',
    customModel: 'Use custom model',
    noMatch: 'No matching models',
    browseHint: 'Scroll or type to search',
    liveModels: 'available',
    recommended: 'Preset',
    presetGroup: 'Presets',
    otherGroup: 'Other',
    selectedGroup: 'Selected'
  },
  ja: {
    fetchModels: 'モデル取得',
    fetchingModels: '取得中...',
    fetchSuccess: count => `${count} 件のモデルを取得しました`,
    fetchEmpty: 'モデルを取得できません。API キーと Base URL を確認してください。',
    fetchFailed: 'モデルの取得に失敗しました',
    apiKeyRequired: '先に API キーを入力してください',
    authFailed: 'API キーが無効か権限がありません',
    endpointNotFound: 'モデル一覧エンドポイントが見つかりません',
    permissionRequired: 'AI ホストへのアクセス許可が必要です',
    searchPlaceholder: 'モデル名またはプロバイダーを検索...',
    chooseModel: 'モデルを選択または入力',
    customModel: 'カスタムモデルを使用',
    noMatch: '一致するモデルがありません',
    browseHint: 'スクロールまたはキーワードで検索',
    liveModels: '件利用可能',
    recommended: '推奨',
    presetGroup: 'プリセット推奨',
    otherGroup: 'Other',
    selectedGroup: '現在選択'
  }
};

export const SearchableModelSelect: React.FC<SearchableModelSelectProps> = ({
  value,
  onChange,
  provider,
  apiKey,
  apiBaseUrl,
  fetchedModels,
  placeholder,
  uiLanguage = 'zh-CN',
  onBeforeFetch,
  id,
  ariaLabel,
  className = ''
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [liveModels, setLiveModels] = useState<FetchedModel[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [fetchStatus, setFetchStatus] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const mainInputRef = useRef<HTMLInputElement>(null);
  const labels = MODEL_SELECT_LABELS[uiLanguage] || MODEL_SELECT_LABELS['zh-CN'];

  // Sync with fetchedModels from external test connection if provided
  useEffect(() => {
    if (fetchedModels && fetchedModels.length > 0) {
      const mapped: FetchedModel[] = fetchedModels.map(m =>
        typeof m === 'string' ? { id: m, ownedBy: null } : m
      );
      setLiveModels(prev => {
        const seen = new Set(prev.map(p => p.id));
        const additions = mapped.filter(m => !seen.has(m.id));
        return [...prev, ...additions];
      });
    }
  }, [fetchedModels]);

  // Reset live models when provider or base URL changes
  useEffect(() => {
    setLiveModels([]);
    setFetchStatus(null);
    setFetchError(false);
  }, [provider, apiBaseUrl]);

  // Group models by vendor (cc-switch style)
  const groupedModels = useMemo(() => {
    // If live models were fetched from the API key, prioritize them exclusively!
    let pool: FetchedModel[] = [];
    if (liveModels.length > 0) {
      pool = [...liveModels];
    } else {
      const presets = PROVIDER_PRESET_MODELS[provider] || [];
      pool = presets.map(id => ({ id, ownedBy: null }));
    }

    // Ensure currently selected value is present in pool
    const currentId = value.trim();
    if (currentId && !pool.some(m => m.id === currentId)) {
      pool.unshift({ id: currentId, ownedBy: labels.selectedGroup });
    }

    const term = searchTerm.trim().toLowerCase();
    const filtered = pool.filter(m => {
      if (!term) return true;
      const matchId = m.id.toLowerCase().includes(term);
      const matchVendor = (m.ownedBy || '').toLowerCase().includes(term);
      return matchId || matchVendor;
    });

    const groups: Record<string, FetchedModel[]> = {};
    for (const m of filtered) {
      const vendor = m.ownedBy || (liveModels.length > 0 ? labels.otherGroup : labels.presetGroup);
      if (!groups[vendor]) groups[vendor] = [];
      groups[vendor].push(m);
    }

    // Sort vendors alphabetically, but keep selectedGroup and presets at predictable locations
    const sortedVendors = Object.keys(groups).sort((a, b) => {
      if (a === labels.selectedGroup) return -1;
      if (b === labels.selectedGroup) return 1;
      if (a === labels.otherGroup) return 1;
      if (b === labels.otherGroup) return -1;
      return a.localeCompare(b);
    });

    const result: Record<string, FetchedModel[]> = {};
    for (const v of sortedVendors) {
      result[v] = groups[v];
    }
    return result;
  }, [liveModels, provider, value, searchTerm, labels]);

  const totalFilteredCount = useMemo(() => {
    return Object.values(groupedModels).reduce((sum, items) => sum + items.length, 0);
  }, [groupedModels]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      if (containerRef.current) {
        if (path.length > 0) {
          if (!path.includes(containerRef.current)) {
            setIsOpen(false);
          }
        } else if (!containerRef.current.contains(e.target as Node)) {
          setIsOpen(false);
        }
      }
    };
    if (isOpen) {
      document.addEventListener('click', handleClickOutside);
    }
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [isOpen]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen) {
      if (document.activeElement !== mainInputRef.current) {
        setTimeout(() => {
          searchInputRef.current?.focus();
        }, 50);
      }
    } else {
      setSearchTerm('');
    }
  }, [isOpen]);

  // Query live official models from provider using cc-switch rules
  const handleFetchOfficialModels = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (isFetching) return;

    if (!apiKey || !apiKey.trim()) {
      setFetchError(true);
      setFetchStatus(labels.apiKeyRequired);
      setIsOpen(true);
      return;
    }

    setIsOpen(true);
    setIsFetching(true);
    setFetchError(false);
    setFetchStatus(labels.fetchingModels);

    try {
      if (onBeforeFetch && !(await onBeforeFetch())) {
        setFetchError(true);
        setFetchStatus(labels.permissionRequired);
        return;
      }

      const defaultBaseUrl = AI_PRESETS[provider]?.apiBaseUrl || '';
      const models = await fetchAvailableModelsDetailed({
        apiKey: apiKey.trim(),
        apiBaseUrl: (apiBaseUrl || defaultBaseUrl).trim(),
        modelName: value,
        timeoutMs: 15000
      });

      if (models && models.length > 0) {
        setLiveModels(models);
        setFetchError(false);
        setFetchStatus(labels.fetchSuccess(models.length));
        // If current value is empty, auto-select the first model or a recommended model
        if (!value.trim()) {
          const preferred = models.find(m => m.id.includes('gpt-4o') || m.id.includes('claude') || m.id.includes('deepseek')) || models[0];
          onChange(preferred.id);
        }
      } else {
        setFetchError(true);
        setFetchStatus(labels.fetchEmpty);
      }
    } catch (err: any) {
      setFetchError(true);
      const msg = err?.message || String(err);
      if (isExtensionContextInvalidatedError(err)) {
        setFetchStatus(EXTENSION_CONTEXT_INVALIDATED_MESSAGE);
      } else if (msg.includes('401') || msg.includes('403') || msg.includes('无权限')) {
        setFetchStatus(labels.authFailed);
      } else if (msg.includes('404') || msg.includes('405') || msg.includes('未找到')) {
        setFetchStatus(labels.endpointNotFound);
      } else {
        setFetchStatus(msg.length > 80 ? `${msg.slice(0, 80)}...` : msg);
      }
    } finally {
      setIsFetching(false);
    }
  };

  const currentDisplayValue = value || AI_PRESETS[provider]?.modelName || placeholder || labels.chooseModel;

  return (
    <div ref={containerRef} className={`relative select-none ${className}`}>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            ref={mainInputRef}
            id={id}
            aria-label={ariaLabel || labels.chooseModel}
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            value={value}
            placeholder={currentDisplayValue}
            onFocus={() => setIsOpen(true)}
            onClick={() => setIsOpen(true)}
            onChange={(event) => {
              onChange(event.target.value);
              setSearchTerm(event.target.value);
            }}
            onBlur={(event) => {
              const trimmed = event.target.value.trim();
              if (trimmed !== event.target.value) {
                onChange(trimmed);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setIsOpen(false);
              } else if (event.key === 'Enter') {
                const finalVal = (event.currentTarget.value || searchTerm).trim();
                if (finalVal) {
                  onChange(finalVal);
                }
                setIsOpen(false);
              }
            }}
            className="w-full select-text bg-[#141416] border border-[#383842] hover:border-blue-500/80 rounded px-2.5 py-1.5 pr-24 text-gray-200 placeholder-gray-500 font-mono text-[11px] transition-colors shadow-sm focus:outline-none focus:border-blue-500/80"
            title={labels.chooseModel}
          />
          <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1 text-gray-400">
            {liveModels.length > 0 && (
              <span className="text-[10px] text-emerald-300 font-sans px-1.5 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/50">
                {liveModels.length} {labels.liveModels}
              </span>
            )}
            <ChevronDown size={14} className={`transition-transform duration-150 ${isOpen ? 'rotate-180 text-blue-400' : ''}`} />
          </span>
        </div>

        <button
          type="button"
          aria-label={labels.fetchModels}
          disabled={isFetching}
          onClick={handleFetchOfficialModels}
          className="inline-flex shrink-0 items-center gap-1 rounded border border-blue-800/60 bg-blue-950/60 px-2 py-1.5 text-[10px] text-blue-300 transition-colors hover:bg-blue-900/70 disabled:cursor-not-allowed disabled:opacity-40"
          title={apiKey ? labels.fetchModels : labels.apiKeyRequired}
        >
          {isFetching ? <Loader2 size={13} className="animate-spin text-blue-400" /> : <RefreshCw size={13} />}
          <span>{isFetching ? labels.fetchingModels : labels.fetchModels}</span>
        </button>
      </div>

      {/* Dropdown Menu (cc-switch style) */}
      {isOpen && (
        <div className="mt-1.5 w-full bg-[#18181b] border border-[#383842] rounded-lg shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-100 z-50">
          {/* Search Header */}
          <div className="p-2 border-b border-[#2e2e38] bg-[#141416] flex items-center space-x-2">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-2.5 top-2.5 text-gray-500" />
              <input
                aria-label={labels.searchPlaceholder}
                ref={searchInputRef}
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && searchTerm.trim()) {
                    onChange(searchTerm.trim());
                    setIsOpen(false);
                  }
                }}
                placeholder={labels.searchPlaceholder}
                className="w-full pl-7 pr-2.5 py-1.5 bg-[#1f1f24] text-gray-200 text-xs rounded border border-[#383842] focus:outline-none focus:border-blue-500 placeholder-gray-500 font-mono text-[11px]"
              />
            </div>
          </div>

          {/* Query Status Bar */}
          {fetchStatus && (
            <div
              className={`px-2.5 py-1.5 border-b text-[10px] leading-tight flex items-center justify-between ${
                fetchError
                  ? 'bg-red-950/70 border-red-900/60 text-red-300'
                  : 'bg-emerald-950/70 border-emerald-900/60 text-emerald-300'
              }`}
            >
              <span>{fetchStatus}</span>
              {fetchError && !apiKey && (
                <span className="text-[9px] text-red-400 underline cursor-pointer" onClick={() => mainInputRef.current?.focus()}>
                  请填写 API Key
                </span>
              )}
            </div>
          )}

          {/* Grouped Model Options List */}
          <div className="max-h-56 overflow-y-auto divide-y divide-[#26262e] text-xs font-mono">
            {totalFilteredCount > 0 ? (
              Object.entries(groupedModels).map(([vendor, items]) => (
                <div key={vendor} className="py-0.5">
                  <div className="px-3 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider bg-[#141416]/80 flex items-center justify-between sticky top-0 backdrop-blur-sm z-10 border-b border-[#26262e]/50">
                    <span className="text-cyan-400/90">{vendor}</span>
                    <span className="text-[9px] text-gray-500 font-mono">{items.length}</span>
                  </div>
                  {items.map((m) => {
                    const isSelected = value.trim() === m.id;
                    return (
                      <div
                        key={m.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onChange(m.id);
                          setIsOpen(false);
                        }}
                        className={`px-3 py-1.5 cursor-pointer flex items-center justify-between transition-colors ${
                          isSelected
                            ? 'bg-blue-600/25 text-blue-300 font-medium'
                            : 'text-gray-300 hover:bg-[#27272e] hover:text-white'
                        }`}
                      >
                        <div className="flex items-center space-x-2 truncate">
                          <span className="truncate">{m.id}</span>
                        </div>
                        {isSelected && <Check size={14} className="text-blue-400 shrink-0 ml-2" />}
                      </div>
                    );
                  })}
                </div>
              ))
            ) : (
              <div className="p-4 text-center text-gray-500 text-[11px] font-sans">
                {labels.noMatch}
              </div>
            )}

            {/* Custom Input Option if search term is typed and doesn't exactly match */}
            {searchTerm.trim() && !Object.values(groupedModels).flat().some(m => m.id.toLowerCase() === searchTerm.trim().toLowerCase()) && (
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(searchTerm.trim());
                  setIsOpen(false);
                }}
                className="px-3 py-2 bg-indigo-950/40 hover:bg-indigo-900/60 text-indigo-200 cursor-pointer flex items-center space-x-2 border-t border-indigo-900/50"
              >
                <Sparkles size={13} className="text-indigo-400 shrink-0" />
                <span className="truncate">{labels.customModel}: <strong className="font-mono text-white">{searchTerm.trim()}</strong></span>
              </div>
            )}
          </div>

          {/* Footer Info */}
          <div className="px-2.5 py-1.5 bg-[#141416] border-t border-[#2e2e38] text-[10px] text-gray-500 flex items-center justify-between">
            <span>{labels.browseHint}</span>
            <span className="font-mono text-gray-400">
              {liveModels.length > 0 ? `${liveModels.length} ${labels.liveModels}` : `${totalFilteredCount} 款`}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

