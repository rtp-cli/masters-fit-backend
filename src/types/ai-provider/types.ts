import { AIProvider, ModelConfig, ProviderConfig } from "@/constants/ai-providers";

// API Request/Response types
export interface ProviderAvailabilityResponse {
  success: boolean;
  providers: {
    [key in AIProvider]: {
      available: boolean;
      displayName: string;
      models: ModelConfig[];
      defaultModel: string;
    };
  };
}

export interface UpdateProviderRequest {
  provider: AIProvider;
  model: string;
}

export interface UserProviderResponse {
  success: boolean;
  provider: AIProvider;
  model: string;
}

// Service types
export interface LLMInstance {
  provider: AIProvider;
  model: string;
  instance: any; // LangChain BaseChatModel
}

// Provider status types
export interface ProviderStatus {
  provider: AIProvider;
  available: boolean;
  keyPresent: boolean;
  displayName: string;
  models: ModelConfig[];
  defaultModel: string;
  error?: string;
}

// Export the enums and interfaces from constants for convenience
export { AIProvider, ModelConfig, ProviderConfig } from "@/constants/ai-providers";