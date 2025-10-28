export enum AIProvider {
  ANTHROPIC = "anthropic",
  OPENAI = "openai",
  GOOGLE = "google",
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
    id: "gpt-4.1",
    name: "gpt-4.1",
    displayName: "GPT-4.1",
    maxTokens: 30000,
    costTier: "medium",
    description: "Latest stable model with improved coding and 1M context",
  },
  {
    id: "gpt-5",
    name: "gpt-5",
    displayName: "GPT-5",
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
    defaultModel: "gpt-5",
    envKeyName: "OPENAI_API_KEY",
  },
  [AIProvider.GOOGLE]: {
    id: AIProvider.GOOGLE,
    name: "google",
    displayName: "Google",
    models: GOOGLE_MODELS,
    defaultModel: "gemini-2.5-flash",
    envKeyName: "GOOGLE_API_KEY",
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
