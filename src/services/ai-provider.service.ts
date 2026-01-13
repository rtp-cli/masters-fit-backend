import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatDeepSeek } from "@langchain/deepseek";
import { ChatGroq } from "@langchain/groq";
import { ChatXAI } from "@langchain/xai";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  AIProvider,
  AI_PROVIDERS,
  getProviderConfig,
  getModelConfig
} from "@/constants/ai-providers";
import { ProviderStatus, LLMInstance } from "@/types/ai-provider/types";
import { logger } from "@/utils/logger";

export class AIProviderService {
  private static instance: AIProviderService;
  private providerStatuses: Map<AIProvider, ProviderStatus> = new Map();
  private llmInstances: Map<string, LLMInstance> = new Map(); // key: provider:model

  private constructor() {
    this.initializeProviders();
  }

  public static getInstance(): AIProviderService {
    if (!AIProviderService.instance) {
      AIProviderService.instance = new AIProviderService();
    }
    return AIProviderService.instance;
  }

  private initializeProviders(): void {
    Object.values(AIProvider).forEach(provider => {
      const config = getProviderConfig(provider);
      if (!config) return;

      const apiKey = process.env[config.envKeyName];
      const keyPresent = !!apiKey && apiKey.length > 0;

      this.providerStatuses.set(provider, {
        provider,
        available: keyPresent,
        keyPresent,
        displayName: config.displayName,
        models: config.models,
        defaultModel: config.defaultModel,
        error: !keyPresent ? `Missing ${config.envKeyName} environment variable` : undefined
      });
    });

    logger.info('AI Provider Service initialized', {
      availableProviders: Array.from(this.providerStatuses.entries())
        .filter(([_, status]) => status.available)
        .map(([provider, _]) => provider)
    });
  }

  public getProviderStatuses(): Record<AIProvider, ProviderStatus> {
    const result = {} as Record<AIProvider, ProviderStatus>;

    for (const [provider, status] of this.providerStatuses.entries()) {
      result[provider] = { ...status };
    }

    return result;
  }

  public getAvailableProviders(): AIProvider[] {
    return Array.from(this.providerStatuses.entries())
      .filter(([_, status]) => status.available)
      .map(([provider, _]) => provider);
  }

  public isProviderAvailable(provider: AIProvider): boolean {
    return this.providerStatuses.get(provider)?.available || false;
  }


  public createLLMInstance(provider: AIProvider, model: string): BaseChatModel {
    if (!provider) {
      throw new Error("Provider is required");
    }
    if (!model) {
      throw new Error("Model is required");
    }

    const cacheKey = `${provider}:${model}`;

    // Return cached instance if available
    const cached = this.llmInstances.get(cacheKey);
    if (cached) {
      return cached.instance;
    }

    const instance = this.createProviderInstance(provider, model);

    // Cache the instance
    this.llmInstances.set(cacheKey, {
      provider,
      model,
      instance
    });

    logger.info(`Created LLM instance for ${provider}/${model}`);
    return instance;
  }

  private createProviderInstance(provider: AIProvider, model: string): BaseChatModel {
    const providerConfig = getProviderConfig(provider);
    if (!providerConfig) {
      throw new Error(`Unsupported provider: ${provider}`);
    }

    const modelConfig = getModelConfig(provider, model);
    if (!modelConfig) {
      throw new Error(`Unsupported model: ${model} for provider: ${provider}`);
    }

    const apiKey = process.env[providerConfig.envKeyName];
    if (!apiKey) {
      throw new Error(`Missing API key for provider: ${provider}. Please set ${providerConfig.envKeyName} in environment variables.`);
    }

    const commonConfig = {
      streaming: true,
    };

    switch (provider) {
      case AIProvider.ANTHROPIC:
        return new ChatAnthropic({
          model: model,
          anthropicApiKey: apiKey,
          ...commonConfig,
          temperature: 0.1,
          maxTokens: modelConfig.maxTokens,
          invocationKwargs: {
            top_p: undefined,
          },
        });

      case AIProvider.OPENAI:
        // Check if it's a GPT-5 model that needs different parameters
        const isGPT5Model = model.startsWith('gpt-5');

        const openAIConfig: any = {
          model: model,
          openAIApiKey: apiKey,
          ...commonConfig,
          // Set temperature based on model type
          temperature: isGPT5Model ? 1 : 0.1,
        };

        if (isGPT5Model) {
          // GPT-5 models use max_completion_tokens and temperature: 1
          openAIConfig.maxCompletionTokens = modelConfig.maxTokens;
          logger.info(`Using GPT-5 configuration for model: ${model}`, {
            temperature: 1,
            maxCompletionTokens: modelConfig.maxTokens
          });
        } else {
          // GPT-4.1 and older models use max_tokens and temperature: 0.1
          openAIConfig.maxTokens = modelConfig.maxTokens;
          logger.info(`Using GPT-4.x configuration for model: ${model}`, {
            temperature: 0.1,
            maxTokens: modelConfig.maxTokens
          });
        }

        return new ChatOpenAI(openAIConfig);

      case AIProvider.GOOGLE:
        // Check if it's a Gemini 3 model that supports thinking configuration
        const isGemini3Model = model.startsWith('gemini-3');

        const googleConfig: any = {
          model: model,
          apiKey: apiKey,
          ...commonConfig,
          maxOutputTokens: modelConfig.maxTokens,
        };

        if (isGemini3Model) {
          // Gemini 3 models default to high thinking which uses ~30k extra tokens
          // Set to "low" for better token efficiency while maintaining quality
          googleConfig.temperature = 1; // Gemini 3 recommends temperature 1 with thinking
          googleConfig.thinkingConfig = {
            thinkingLevel: "low",
          };
          logger.info(`Using Gemini 3 configuration for model: ${model}`, {
            thinkingLevel: "low",
            temperature: 1,
            maxOutputTokens: modelConfig.maxTokens
          });
        } else {
          // Gemini 2.x models use standard temperature
          googleConfig.temperature = 0.1;
        }

        return new ChatGoogleGenerativeAI(googleConfig);

      case AIProvider.DEEPSEEK:
        return new ChatDeepSeek({
          model: model,
          apiKey: apiKey,
          ...commonConfig,
          temperature: 0.1,
          maxTokens: modelConfig.maxTokens,
        });

      case AIProvider.GROQ:
        return new ChatGroq({
          model: model,
          apiKey: apiKey,
          ...commonConfig,
          temperature: 0.1,
          maxTokens: modelConfig.maxTokens,
        });

      case AIProvider.XAI:
        return new ChatXAI({
          model: model,
          apiKey: apiKey,
          ...commonConfig,
          temperature: 0.1,
          maxTokens: modelConfig.maxTokens,
        });

      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }


  public getProviderDisplayName(provider: AIProvider): string {
    return this.providerStatuses.get(provider)?.displayName || provider;
  }

  public getModelDisplayName(provider: AIProvider, model: string): string {
    const modelConfig = getModelConfig(provider, model);
    return modelConfig?.displayName || model;
  }


  // Clear cached instances (useful for tests or config changes)
  public clearCache(): void {
    this.llmInstances.clear();
    logger.info('Cleared LLM instance cache');
  }

  // Refresh provider statuses (useful if environment changes)
  public refreshProviderStatuses(): void {
    this.providerStatuses.clear();
    this.clearCache();
    this.initializeProviders();
    logger.info('Refreshed provider statuses');
  }
}

// Export singleton instance
export const aiProviderService = AIProviderService.getInstance();