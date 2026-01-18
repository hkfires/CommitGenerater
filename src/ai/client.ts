import * as vscode from 'vscode';
import { getConfig } from '../config';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface ErrorResponse {
  error?: {
    message: string;
    type: string;
    code: string;
  };
}

export class AIClient {
  private baseUrl: string;
  private apiKey: string;
  private model: string;

  constructor() {
    const config = getConfig();
    this.baseUrl = config.apiBaseUrl;
    this.apiKey = config.apiKey;
    this.model = config.model;
  }

  async chat(messages: ChatMessage[], token?: vscode.CancellationToken): Promise<string> {
    if (!this.apiKey) {
      throw new Error('API Key not configured. Please set commitGenerater.apiKey in settings.');
    }

    const controller = new AbortController();
    
    if (token) {
      token.onCancellationRequested(() => {
        controller.abort();
      });
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.7,
        max_tokens: 500,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorData = await response.json() as ErrorResponse;
      const errorMessage = errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`;
      throw new Error(`API request failed: ${errorMessage}`);
    }

    const data = await response.json() as ChatCompletionResponse;
    
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('No response content from API');
    }

    return content.trim();
  }
}
