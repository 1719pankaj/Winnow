import OpenAI from 'openai';
import { ModelConfig, InferenceProviderConfig } from '../config/models';
import { getProviderRateLimiter, getProviderSemaphore } from '../limits';
import { store } from '../store';
import { TokenUsage } from '../types';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
}

export class InferenceAdapter {
  private client?: OpenAI;
  private providerConfig: InferenceProviderConfig;
  private modelConfig: ModelConfig;
  public lastUsage?: TokenUsage;

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
      timeoutMs?: number;
      signal?: AbortSignal;
      onToken?: (token: string, type?: 'content' | 'thought') => void;
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

    const abortController = new AbortController();
    const effectiveTimeoutMs = options.timeoutMs || this.providerConfig.timeout_ms || 20000;
    const timeoutTimer = setTimeout(() => {
      abortController.abort(new Error(`Inference timeout of ${effectiveTimeoutMs}ms exceeded for ${this.modelConfig.id}`));
    }, effectiveTimeoutMs);

    if (options.signal) {
      options.signal.addEventListener('abort', () => abortController.abort(options.signal?.reason));
    }

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

        // Streaming branch
        if (options.onToken) {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${modelStr}:streamGenerateContent?alt=sse&key=${this.providerConfig.api_key}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
              signal: abortController.signal,
            }
          );

          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Gemini API Error (${res.status}): ${errText}`);
          }

          const reader = res.body?.getReader();
          const decoder = new TextDecoder();
          let fullText = '';
          let buffer = '';
          let usageMetadata: any = null;

          if (reader) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';
              for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('data: ')) {
                  const jsonStr = trimmed.slice(6).trim();
                  if (jsonStr === '[DONE]') continue;
                  try {
                    const parsed = JSON.parse(jsonStr);
                    const partText = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (partText) {
                      fullText += partText;
                      options.onToken(partText, 'content');
                    }
                    if (parsed.usageMetadata) {
                      usageMetadata = parsed.usageMetadata;
                    }
                  } catch {}
                }
              }
            }
          }

          this.lastUsage = {
            prompt_tokens: usageMetadata?.promptTokenCount || Math.ceil(JSON.stringify(body).length / 4),
            completion_tokens: usageMetadata?.candidatesTokenCount || Math.ceil(fullText.length / 4),
            total_tokens: usageMetadata?.totalTokenCount || ((usageMetadata?.promptTokenCount || 0) + (usageMetadata?.candidatesTokenCount || 0)),
          };

          return fullText;
        }

        // Non-streaming branch
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelStr}:generateContent?key=${this.providerConfig.api_key}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: abortController.signal,
          }
        );

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Gemini API Error (${res.status}): ${errText}`);
        }

        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

        this.lastUsage = {
          prompt_tokens: data.usageMetadata?.promptTokenCount || Math.ceil(JSON.stringify(body).length / 4),
          completion_tokens: data.usageMetadata?.candidatesTokenCount || Math.ceil(text.length / 4),
          total_tokens: data.usageMetadata?.totalTokenCount || ((data.usageMetadata?.promptTokenCount || 0) + (data.usageMetadata?.candidatesTokenCount || 0)),
        };

        return text;
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

      // Streaming branch
      if (options.onToken) {
        const stream = (await this.client.chat.completions.create(
          {
            ...params,
            stream: true,
            stream_options: { include_usage: true },
          },
          { signal: abortController.signal }
        )) as any;

        let fullText = '';
        let usage: TokenUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

        for await (const chunk of stream) {
          const delta = chunk.choices?.[0]?.delta;
          if (delta?.content) {
            fullText += delta.content;
            options.onToken(delta.content, 'content');
          }
          if ((delta as any)?.reasoning_content) {
            options.onToken((delta as any).reasoning_content, 'thought');
          }
          if (chunk.usage) {
            usage = {
              prompt_tokens: chunk.usage.prompt_tokens || 0,
              completion_tokens: chunk.usage.completion_tokens || 0,
              total_tokens: chunk.usage.total_tokens || 0,
            };
          }
        }

        if (usage.total_tokens === 0) {
          usage = {
            prompt_tokens: Math.ceil(JSON.stringify(messages).length / 4),
            completion_tokens: Math.ceil(fullText.length / 4),
            total_tokens: Math.ceil((JSON.stringify(messages).length + fullText.length) / 4),
          };
        }

        this.lastUsage = usage;
        return fullText;
      }

      // Non-streaming branch
      const res = await this.client.chat.completions.create(params, { signal: abortController.signal });
      const text = res.choices[0]?.message?.content || '';

      this.lastUsage = {
        prompt_tokens: res.usage?.prompt_tokens || Math.ceil(JSON.stringify(messages).length / 4),
        completion_tokens: res.usage?.completion_tokens || Math.ceil(text.length / 4),
        total_tokens: res.usage?.total_tokens || Math.ceil((JSON.stringify(messages).length + text.length) / 4),
      };

      return text;
    } finally {
      clearTimeout(timeoutTimer);
      release();
    }
  }

  /**
   * Dense vector embedding computation supporting Gemini & OpenAI-compatible endpoints
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

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

      // 1. Google Gemini Embedding Protocol
      if (this.providerConfig.name === 'gemini') {
        const modelStr = this.modelConfig.model_string.replace(/^models\//, '');
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelStr}:batchEmbedContents?key=${this.providerConfig.api_key}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              requests: texts.map((t) => ({
                model: `models/${modelStr}`,
                content: { parts: [{ text: t }] },
              })),
            }),
          }
        );

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Gemini Embedding Error (${res.status}): ${errText}`);
        }

        const data = await res.json();
        if (!Array.isArray(data.embeddings)) {
          throw new Error('Invalid Gemini embeddings response');
        }
        return data.embeddings.map((e: any) => e.values as number[]);
      }

      // 2. OpenAI-compatible Protocol (OpenRouter, OpenAI, etc.)
      if (!this.client) {
        throw new Error(`OpenAI client not initialized for provider ${this.providerConfig.name}`);
      }

      const res = await this.client.embeddings.create({
        model: this.modelConfig.model_string,
        input: texts,
      });

      if (!res.data || !Array.isArray(res.data)) {
        throw new Error('Invalid OpenAI embeddings response');
      }

      const sorted = [...res.data].sort((a, b) => a.index - b.index);
      return sorted.map((d) => d.embedding);
    } finally {
      release();
    }
  }
}
