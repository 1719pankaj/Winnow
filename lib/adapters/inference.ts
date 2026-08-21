import OpenAI from 'openai';
import { ModelConfig, InferenceProviderConfig } from '../config/models';
import { getProviderRateLimiter, getProviderSemaphore } from '../limits';
import { store } from '../store';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
}

export class InferenceAdapter {
  private client?: OpenAI;
  private providerConfig: InferenceProviderConfig;
  private modelConfig: ModelConfig;

  constructor(providerConfig: InferenceProviderConfig, modelConfig: ModelConfig) {
    this.providerConfig = providerConfig;
    this.modelConfig = modelConfig;

    if (providerConfig.name !== 'gemini') {
      this.client = new OpenAI({
        baseURL: providerConfig.base_url,
        apiKey: providerConfig.api_key,
        timeout: providerConfig.timeout_ms,
        defaultHeaders: providerConfig.extra_headers || {},
      });
    }
  }

  get modelId(): string {
    return this.modelConfig.id;
  }

  get modelString(): string {
    return this.modelConfig.model_string;
  }

  get capabilities() {
    return this.modelConfig.capabilities;
  }

  async complete(
    messages: ChatMessage[],
    options: {
      temperature?: number;
      maxTokens?: number;
      responseFormatJson?: boolean;
    } = {}
  ): Promise<string> {
    const rateLimiter = getProviderRateLimiter(
      this.providerConfig.name,
      this.providerConfig.limits.rpm
    );
    const semaphore = getProviderSemaphore(
      this.providerConfig.name,
      this.providerConfig.limits.concurrent
    );

    await rateLimiter.acquire();
    const release = await semaphore.acquire();

    try {
      await store.incrementUsage(this.providerConfig.name);

      // 1. Google Gemini Native Protocol
      if (this.providerConfig.name === 'gemini') {
        const systemMsg = messages.find((m) => m.role === 'system');
        const nonSystemMsgs = messages.filter((m) => m.role !== 'system');

        const contents = nonSystemMsgs.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));

        const body: any = {
          contents,
          generationConfig: {
            temperature: options.temperature ?? 0.1,
            maxOutputTokens: options.maxTokens ?? 3000,
            ...(this.modelConfig.capabilities.thinking_budget !== undefined
              ? { thinkingConfig: { thinkingBudget: this.modelConfig.capabilities.thinking_budget } }
              : {}),
            ...(options.responseFormatJson ? { responseMimeType: 'application/json' } : {}),
          },
        };

        if (systemMsg) {
          body.systemInstruction = {
            parts: [{ text: systemMsg.content }],
          };
        }

        const modelStr = this.modelConfig.model_string;
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelStr}:generateContent?key=${this.providerConfig.api_key}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        );

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Gemini API Error (${res.status}): ${errText}`);
        }

        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      }

      // 2. OpenAI-compatible Protocol (Groq, Cerebras, NIM, OpenRouter)
      if (!this.client) {
        throw new Error(`OpenAI client not initialized for provider ${this.providerConfig.name}`);
      }

      const params: any = {
        model: this.modelConfig.model_string,
        messages: messages as any,
        temperature: options.temperature ?? 0.1,
        max_tokens: options.maxTokens ?? 2000,
      };

      if (this.modelConfig.capabilities.reasoning_effort) {
        params.reasoning_effort = this.modelConfig.capabilities.reasoning_effort;
      }

      if (options.responseFormatJson && this.modelConfig.capabilities.supports_json_schema) {
        params.response_format = { type: 'json_object' };
      }

      const res = await this.client.chat.completions.create(params);
      return res.choices[0]?.message?.content || '';
    } finally {
      release();
    }
  }
}
