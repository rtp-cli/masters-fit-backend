export enum AIProvider {
  ANTHROPIC = "anthropic",
  OPENAI = "openai",
  GOOGLE = "google",
  DEEPSEEK = "deepseek",
  GROQ = "groq",
  XAI = "xai",
}

export interface ModelConfig {
  id: string;
  name: string;
  displayName: string;
  maxTokens: number;
  costTier: "low" | "medium" | "high";
  description: string;
}

export interface ProviderConfig {
  id: AIProvider;
  name: string;
  displayName: string;
  models: ModelConfig[];
  defaultModel: string;
  envKeyName: string;
}

// Anthropic Models
export const ANTHROPIC_MODELS: ModelConfig[] = [
  {
    id: "claude-haiku-4-5-20251001",
    name: "claude-haiku-4-5-20251001",
    displayName: "Claude Haiku 4.5",
    maxTokens: 30000,
    costTier: "low",
    description: "Fastest model with near-frontier intelligence",
  },
  {
    id: "claude-sonnet-4-5-20250929",
    name: "claude-sonnet-4-5-20250929",
    displayName: "Claude Sonnet 4.5",
    maxTokens: 30000,
    costTier: "high",
    description: "Smartest model for complex agents and coding",
  },
];

// OpenAI Models
export const OPENAI_MODELS: ModelConfig[] = [
  {
    id: "gpt-5.2-2025-12-11",
    name: "gpt-5.2-2025-12-11",
    displayName: "GPT-5.2",
    maxTokens: 30000,
    costTier: "high",
    description: "OpenAI's flagship model with advanced reasoning",
  },
  {
    id: "gpt-5-mini",
    name: "gpt-5-mini",
    displayName: "GPT-5 Mini",
    maxTokens: 30000,
    costTier: "medium",
    description: "Fast and capable for most tasks",
  },
  {
    id: "gpt-5-nano",
    name: "gpt-5-nano",
    displayName: "GPT-5 Nano",
    maxTokens: 30000,
    costTier: "low",
    description: "Fastest and most cost-effective option",
  },
];

// Google Models
export const GOOGLE_MODELS: ModelConfig[] = [
  {
    id: "gemini-2.5-flash",
    name: "gemini-2.5-flash",
    displayName: "Gemini 2.5 Flash",
    maxTokens: 30000,
    costTier: "medium",
    description: "Best price-performance balance",
  },
  {
    id: "gemini-2.5-pro",
    name: "gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro",
    maxTokens: 30000,
    costTier: "high",
    description: "Advanced reasoning for complex tasks",
  },
  {
    id: "gemini-3-pro-preview",
    name: "gemini-3-pro-preview",
    displayName: "Gemini 3 Pro",
    maxTokens: 30000,
    costTier: "high",
    description: "Advanced reasoning for complex tasks",
  },
  {
    id: "gemini-3-flash-preview",
    name: "gemini-3-flash-preview",
    displayName: "Gemini 3 Flash",
    maxTokens: 30000,
    costTier: "medium",
    description: "Best price-performance balance",
  },
];

// DeepSeek Models
export const DEEPSEEK_MODELS: ModelConfig[] = [
  {
    id: "deepseek-chat",
    name: "deepseek-chat",
    displayName: "DeepSeek V3.2",
    maxTokens: 8192,
    costTier: "low",
    description: "Cost-effective general purpose model",
  },
  {
    id: "deepseek-reasoner",
    name: "deepseek-reasoner",
    displayName: "DeepSeek Reasoner",
    maxTokens: 30000,
    costTier: "medium",
    description: "Advanced reasoning with thinking mode",
  },
];

// Groq Models
export const GROQ_MODELS: ModelConfig[] = [
  // Quality Tier
  {
    id: "openai/gpt-oss-120b",
    name: "openai/gpt-oss-120b",
    displayName: "GPT OSS 120B",
    maxTokens: 8192,
    costTier: "medium",
    description: "Largest model with reasoning capabilities (500 tokens/sec)",
  },
  {
    id: "llama-3.3-70b-versatile",
    name: "llama-3.3-70b-versatile",
    displayName: "Llama 3.3 70B",
    maxTokens: 8192,
    costTier: "low",
    description: "Proven instruction-following (280 tokens/sec)",
  },
  // Speed Tier
  {
    id: "openai/gpt-oss-20b",
    name: "openai/gpt-oss-20b",
    displayName: "GPT OSS 20B",
    maxTokens: 8192,
    costTier: "low",
    description: "Fastest inference available (1000 tokens/sec)",
  },
  {
    id: "llama-3.1-8b-instant",
    name: "llama-3.1-8b-instant",
    displayName: "Llama 3.1 8B",
    maxTokens: 8192,
    costTier: "low",
    description: "Fast and reliable (560 tokens/sec)",
  },
];

// xAI Grok Models
export const XAI_MODELS: ModelConfig[] = [
  // Quality Tier
  {
    id: "grok-4",
    name: "grok-4",
    displayName: "Grok 4",
    maxTokens: 30000,
    costTier: "high",
    description: "Frontier model with advanced reasoning (256K context)",
  },
  {
    id: "grok-3",
    name: "grok-3",
    displayName: "Grok 3",
    maxTokens: 30000,
    costTier: "high",
    description: "Standard high-quality model (256K context)",
  },
  // Speed/Cost Tier
  {
    id: "grok-4-1-fast-non-reasoning",
    name: "grok-4-1-fast-non-reasoning",
    displayName: "Grok 4.1 Fast",
    maxTokens: 30000,
    costTier: "low",
    description: "Ultra-fast, cost-effective (2M context, 90% cheaper)",
  },
  {
    id: "grok-3-mini",
    name: "grok-3-mini",
    displayName: "Grok 3 Mini",
    maxTokens: 30000,
    costTier: "low",
    description: "Smallest and most cost-effective option",
  },
];

// Provider Configurations
export const AI_PROVIDERS: Record<AIProvider, ProviderConfig> = {
  [AIProvider.ANTHROPIC]: {
    id: AIProvider.ANTHROPIC,
    name: "anthropic",
    displayName: "Anthropic",
    models: ANTHROPIC_MODELS,
    defaultModel: "claude-sonnet-4-5-20250929",
    envKeyName: "ANTHROPIC_API_KEY",
  },
  [AIProvider.OPENAI]: {
    id: AIProvider.OPENAI,
    name: "openai",
    displayName: "OpenAI",
    models: OPENAI_MODELS,
    defaultModel: "gpt-5-mini",
    envKeyName: "OPENAI_API_KEY",
  },
  [AIProvider.GOOGLE]: {
    id: AIProvider.GOOGLE,
    name: "google",
    displayName: "Google",
    models: GOOGLE_MODELS,
    defaultModel: "gemini-3-flash-preview",
    envKeyName: "GOOGLE_API_KEY",
  },
  [AIProvider.DEEPSEEK]: {
    id: AIProvider.DEEPSEEK,
    name: "deepseek",
    displayName: "DeepSeek",
    models: DEEPSEEK_MODELS,
    defaultModel: "deepseek-chat",
    envKeyName: "DEEPSEEK_API_KEY",
  },
  [AIProvider.GROQ]: {
    id: AIProvider.GROQ,
    name: "groq",
    displayName: "Groq",
    models: GROQ_MODELS,
    defaultModel: "llama-3.3-70b-versatile",
    envKeyName: "GROQ_API_KEY",
  },
  [AIProvider.XAI]: {
    id: AIProvider.XAI,
    name: "xai",
    displayName: "xAI",
    models: XAI_MODELS,
    defaultModel: "grok-3",
    envKeyName: "XAI_API_KEY",
  },
};

// Default provider and model
export const DEFAULT_AI_PROVIDER = AIProvider.ANTHROPIC;
export const DEFAULT_AI_MODEL = AI_PROVIDERS[DEFAULT_AI_PROVIDER].defaultModel;

// Helper functions
export function getProviderConfig(
  provider: AIProvider
): ProviderConfig | undefined {
  return AI_PROVIDERS[provider];
}

export function getModelConfig(
  provider: AIProvider,
  modelId: string
): ModelConfig | undefined {
  const providerConfig = getProviderConfig(provider);
  return providerConfig?.models.find((model) => model.id === modelId);
}

export function isValidProviderModelPair(
  provider: AIProvider,
  modelId: string
): boolean {
  const modelConfig = getModelConfig(provider, modelId);
  return !!modelConfig;
}

export function getAvailableProviders(): AIProvider[] {
  return Object.values(AIProvider);
}

export function getProviderByName(name: string): AIProvider | undefined {
  return Object.values(AIProvider).find((provider) => provider === name);
}
