import * as vscode from 'vscode';
import { getConfig, ReasoningEffort } from '../config';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionResponse extends ErrorResponse {
  choices?: {
    message?: {
      content?: string | null;
    };
  }[];
}

interface ChatCompletionChunk extends ErrorResponse {
  choices?: {
    index: number;
    delta?: {
      content?: string | null;
    };
  }[];
}

interface ErrorResponse {
  error?: {
    message: string;
    type: string;
    code: string | null;
  };
}

async function readChatCompletionStream(response: Response): Promise<string> {
  if (!response.body) {
    throw new Error('No response stream from API');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let skipNextLF = false;
  let dataLines: string[] = [];
  let content = '';
  let finished = false;

  const dispatchEvent = () => {
    if (dataLines.length === 0) {
      return;
    }
    const data = dataLines.join('\n');
    dataLines = [];
    if (data.trim() === '[DONE]') {
      finished = true;
      return;
    }

    const chunk = JSON.parse(data) as ChatCompletionChunk;
    if (chunk.error) {
      throw new Error(`API request failed: ${chunk.error.message}`);
    }
    const delta = chunk.choices?.find(choice => choice.index === 0)?.delta?.content;
    if (typeof delta === 'string') {
      content += delta;
    }
  };

  const processLine = (line: string) => {
    if (line === '') {
      dispatchEvent();
    } else if (line === 'data') {
      dataLines.push('');
    } else if (line.startsWith('data:')) {
      // SSE removes at most one space after the field separator.
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
    // Ignore comments/heartbeats and other SSE fields.
  };

  try {
    while (!finished) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      while (buffer.length > 0) {
        // Process CR immediately; skip its optional LF even across chunks.
        if (skipNextLF) {
          if (buffer.startsWith('\n')) {
            buffer = buffer.slice(1);
          }
          skipNextLF = false;
        }
        const lineEnd = buffer.search(/[\r\n]/);
        if (lineEnd === -1) {
          break;
        }
        const line = buffer.slice(0, lineEnd);
        skipNextLF = buffer[lineEnd] === '\r';
        buffer = buffer.slice(lineEnd + 1);
        processLine(line);
        if (finished) {
          break;
        }
      }
      if (done && !finished) {
        // SSE discards an unterminated event at EOF; only a final [DONE] proves completion.
        if (buffer) {
          processLine(buffer);
        }
        finished = dataLines.join('\n').trim() === '[DONE]';
        break;
      }
    }

    // EOF alone is not proof of completion: never return a truncated message.
    if (!finished) {
      throw new Error('API response stream ended before [DONE]; the response may be incomplete. Please try again.');
    }
    return content;
  } finally {
    try {
      await reader.cancel();
    } finally {
      // Release the lock even if cancellation rejects an errored stream.
      reader.releaseLock();
    }
  }
}

export class AIClient {
  private baseUrl: string;
  private apiKey: string;
  private model: string;
  private reasoningEffort: ReasoningEffort;

  constructor() {
    const config = getConfig();
    this.baseUrl = config.apiBaseUrl;
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.reasoningEffort = config.reasoningEffort;
  }

  async chat(messages: ChatMessage[], token?: vscode.CancellationToken): Promise<string> {
    if (!this.apiKey) {
      throw new Error('API Key not configured. Please set commitGenerater.apiKey in settings.');
    }

    const controller = new AbortController();
    const cancellation = token?.onCancellationRequested(() => controller.abort());
    if (token?.isCancellationRequested) {
      controller.abort();
    }

    try {
      controller.signal.throwIfAborted();
      const body: Record<string, unknown> = {
        model: this.model,
        messages,
        stream: true,
      };
      if (this.reasoningEffort !== 'default') {
        body.reasoning_effort = this.reasoningEffort;
      }

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json() as ErrorResponse;
        const errorMessage = errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`;
        throw new Error(`API request failed: ${errorMessage}`);
      }

      const mediaType = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
      let content: string | null | undefined;
      if (mediaType === 'text/event-stream') {
        content = await readChatCompletionStream(response);
      } else if (mediaType === 'application/json') {
        // Providers may ignore `stream` and return a complete JSON response.
        const data = await response.json() as ChatCompletionResponse;
        if (data.error) {
          throw new Error(`API request failed: ${data.error.message}`);
        }
        content = data.choices?.[0]?.message?.content;
      } else {
        await response.body?.cancel();
        throw new Error(`API returned unsupported Content-Type "${mediaType || 'none'}" for a streaming request; expected text/event-stream or application/json.`);
      }

      controller.signal.throwIfAborted();
      if (!content?.trim()) {
        throw new Error('No response content from API');
      }
      return content.trim();
    } finally {
      cancellation?.dispose();
    }
  }
}
