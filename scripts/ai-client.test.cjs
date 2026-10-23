// Run after compilation: node --test scripts/ai-client.test.cjs
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createClient(fetch, overrides = {}) {
  const filename = path.resolve(__dirname, '..', 'out', 'ai', 'client.js');
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(filename, 'utf8'), {
    module,
    exports: module.exports,
    require: name => {
      if (name === '../config') {
        return { getConfig: () => ({
          apiBaseUrl: 'https://example.test/v1',
          apiKey: 'test-key',
          model: 'test-model',
          reasoningEffort: 'default',
          ...overrides,
        }) };
      }
      assert.equal(name, 'vscode');
      return {};
    },
    fetch,
    AbortController,
    TextDecoder,
  }, { filename });
  return new module.exports.AIClient();
}

function event(content, extra = {}) {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }], ...extra })}\n\n`;
}

const SSE = { headers: { 'Content-Type': 'text/event-stream' } };

function streamResponse(parts, { close = true, cancel = () => {}, contentType = 'text/event-stream' } = {}) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(typeof part === 'string' ? Buffer.from(part) : part);
      }
      if (close) {
        controller.close();
      }
    },
    cancel,
  }), { headers: { 'Content-Type': contentType } });
}

function cancellationToken(initiallyCancelled = false) {
  const listeners = new Set();
  return {
    isCancellationRequested: initiallyCancelled,
    disposed: 0,
    onCancellationRequested(listener) {
      listeners.add(listener);
      return { dispose: () => {
        listeners.delete(listener);
        this.disposed++;
      } };
    },
    cancel() {
      this.isCancellationRequested = true;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

test('chat requests streaming and returns one complete trimmed string', async () => {
  const messages = [{ role: 'user', content: 'Generate a commit message' }];
  const token = cancellationToken();
  const client = createClient(async (url, options) => {
    assert.equal(url, 'https://example.test/v1/chat/completions');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Accept, 'text/event-stream');
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    assert.deepEqual(JSON.parse(options.body), { model: 'test-model', messages, stream: true });
    assert.equal(options.signal.aborted, false);
    return streamResponse([event('  feat: '), event('add streaming\n'), 'data: [DONE]\n\n']);
  });
  assert.equal(await client.chat(messages, token), 'feat: add streaming');
  assert.equal(token.disposed, 1);
});

test('chat preserves non-default reasoning effort', async () => {
  const client = createClient(async (url, options) => {
    assert.equal(JSON.parse(options.body).reasoning_effort, 'high');
    return streamResponse([event('done'), 'data: [DONE]\n\n']);
  }, { reasoningEffort: 'high' });
  assert.equal(await client.chat([]), 'done');
});

test('SSE handles byte-sized UTF-8 chunks, split CRLF, comments and multiple data lines', async () => {
  const payload = ': heartbeat\r\n\r\nevent: message\r\nid: 1\r\n'
    + 'data: {"choices":\r\ndata: [{"index":0,"delta":{"content":"feat: 支持流式 🚀"}}]}\r\n\r\n'
    + 'data:{"choices":[{"index":0,"delta":{"content":"\\n\\n- 保持完整返回"}}]}\r\n\r\n'
    + 'data: [DONE]\r\n\r\n';
  const bytes = Buffer.from(payload);
  const parts = Array.from(bytes, (_, index) => bytes.subarray(index, index + 1));
  const client = createClient(async () => streamResponse(parts, { contentType: 'Text/Event-Stream; charset=utf-8' }));
  assert.equal(await client.chat([]), 'feat: 支持流式 🚀\n\n- 保持完整返回');
});

test('SSE accepts CR-only lines and a final DONE marker without a newline', async () => {
  const client = createClient(async () => streamResponse([
    event('feat: generated').replace(/\n/g, '\r') + 'data: [DONE]',
  ]));
  assert.equal(await client.chat([]), 'feat: generated');
});

test('SSE accepts DONE without the final blank line at EOF', async () => {
  const client = createClient(async () => streamResponse([event('feat: generated'), 'data: [DONE]\n']));
  assert.equal(await client.chat([]), 'feat: generated');
});

for (const doneChunks of [['data: [DONE]\r\r'], ['data: [DONE]\r', '\r']]) {
  test(`CR-delimited DONE completes without EOF (${doneChunks.length} chunks)`, async t => {
    let controller;
    let cancelled = false;
    let completed = false;
    const response = new Response(new ReadableStream({
      start(value) { controller = value; },
      cancel() { cancelled = true; },
    }), SSE);
    const client = createClient(async () => response);
    const pending = client.chat([]).then(content => { completed = true; return content; });
    t.after(async () => {
      // Unblock a broken parser after the assertion without hiding the hang.
      if (!cancelled) {
        controller.close();
      }
      await pending;
    });
    controller.enqueue(Buffer.from(event('feat: CR streaming').replace(/\n/g, '\r')));
    for (const chunk of doneChunks) {
      controller.enqueue(Buffer.from(chunk));
    }
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(completed, true, 'DONE must complete while the connection is still open');
    assert.equal(await pending, 'feat: CR streaming');
    assert.equal(cancelled, true);
    assert.equal(response.body.locked, false);
  });
}

test('split CRLF does not dispatch a multiline event early, even across empty chunks', async () => {
  const client = createClient(async () => streamResponse([
    'data: {"choices":\r',
    Buffer.alloc(0),
    '\n',
    'data: [{"index":0,"delta":{"content":"feat: split CRLF"}}]}\r',
    '\n\r',
    Buffer.alloc(0),
    '\n',
    'data: [DONE]\r',
    '\n\r',
    '\n',
  ]));
  assert.equal(await client.chat([]), 'feat: split CRLF');
});

test('only content deltas from choice zero contribute to the result', async () => {
  const client = createClient(async () => streamResponse([
    'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":null}}]}\n\n',
    'data: {"choices":[{"index":0,"delta":{"reasoning_content":"hidden reasoning"}}]}\n\n',
    'data: {"choices":[{"index":1,"delta":{"content":"ignore"}},{"index":0,"delta":{"content":"feat: correct"}}]}\n\n',
    'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
    'data: {"choices":[],"usage":{"total_tokens":42}}\n\n',
    'data: [DONE]\n\n',
  ]));
  assert.equal(await client.chat([]), 'feat: correct');
});

test('chat waits for DONE, then cancels and unlocks the stream without waiting for EOF', async () => {
  let controller;
  let cancelled = false;
  let settled = false;
  const response = new Response(new ReadableStream({
    start(value) { controller = value; },
    cancel() { cancelled = true; },
  }), SSE);
  const client = createClient(async () => response);
  const pending = client.chat([]).then(content => { settled = true; return content; });
  controller.enqueue(Buffer.from(event('feat: complete')));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  controller.enqueue(Buffer.from('data: [DONE]\n\n'));
  assert.equal(await pending, 'feat: complete');
  assert.equal(cancelled, true);
  assert.equal(response.body.locked, false);
});

for (const ending of ['', 'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n']) {
  test(`EOF without DONE rejects partial content${ending ? ' even after finish_reason' : ''}`, async () => {
    const response = streamResponse([event('feat: partial'), ending]);
    const token = cancellationToken();
    const client = createClient(async () => response);
    await assert.rejects(client.chat([], token), /stream ended before \[DONE\]/);
    assert.equal(response.body.locked, false);
    assert.equal(token.disposed, 1);
  });
}

for (const [name, ending] of [
  ['inside a line', 'data: {"choices":[{"index":0,"delta":{"content":"fe'],
  ['before the blank line ending an event', 'data: {"choices":[{"index":0,"delta":{"content":"tail"}}]}\n'],
]) {
  test(`EOF ${name} reports truncation without parsing the unfinished event`, async () => {
    const client = createClient(async () => streamResponse([event('feat: partial'), ending]));
    await assert.rejects(client.chat([]), /stream ended before \[DONE\]/);
  });
}

test('transport errors reject partial content and release the reader', async () => {
  const failure = new Error('connection reset');
  let reads = 0;
  const response = new Response(new ReadableStream({
    pull(controller) {
      if (reads++ === 0) {
        controller.enqueue(Buffer.from(event('feat: partial')));
      } else {
        controller.error(failure);
      }
    },
  }), SSE);
  const client = createClient(async () => response);
  await assert.rejects(client.chat([]), error => error === failure);
  assert.equal(response.body.locked, false);
});

test('in-band API errors reject instead of returning preceding content', async () => {
  const client = createClient(async () => streamResponse([
    event('feat: partial'),
    'data: {"error":{"message":"Upstream unavailable","type":"server_error","code":"upstream"}}\n\n',
    'data: [DONE]\n\n',
  ]));
  await assert.rejects(client.chat([]), /API request failed: Upstream unavailable/);
});

test('invalid JSON fails and cancels the response body', async () => {
  let cancelled = false;
  const client = createClient(async () => streamResponse([
    event('feat: partial'), 'data: {invalid}\n\n',
  ], { close: false, cancel: () => { cancelled = true; } }));
  await assert.rejects(client.chat([]), { name: 'SyntaxError' });
  assert.equal(cancelled, true);
});

test('stream cancellation failures propagate and still release the reader', async () => {
  const failure = Object.assign(new Error('cancel failed'), { code: 'TEST_CANCEL_FAILURE' });
  const response = streamResponse([event('feat: complete'), 'data: [DONE]\n\n'], {
    close: false,
    cancel: () => { throw failure; },
  });
  const token = cancellationToken();
  const client = createClient(async () => response);
  await assert.rejects(client.chat([], token), error => error === failure);
  assert.equal(response.body.locked, false);
  assert.equal(token.disposed, 1);
});

test('empty content and a missing response body fail clearly', async () => {
  for (const response of [
    streamResponse(['data: [DONE]\n\n']),
    streamResponse([event('  \n'), 'data: [DONE]\n\n']),
    new Response(null, SSE),
  ]) {
    const client = createClient(async () => response);
    await assert.rejects(client.chat([]), /No response (content|stream) from API/);
  }
});

test('HTTP errors preserve the API message, do not retry and dispose cancellation', async () => {
  for (const [status, error] of [
    [401, { message: 'Invalid API key' }],
    [400, { message: 'Streaming is not supported', param: 'stream' }],
  ]) {
    const token = cancellationToken();
    let requests = 0;
    const client = createClient(async () => {
      requests++;
      return new Response(JSON.stringify({ error }), { status });
    });
    await assert.rejects(client.chat([], token), { message: `API request failed: ${error.message}` });
    assert.equal(requests, 1);
    assert.equal(token.disposed, 1);
  }
});

test('streaming requests accept a complete JSON response when the provider ignores stream', async () => {
  const client = createClient(async () => new Response(JSON.stringify({
    choices: [{ message: { content: 'feat: provider ignored stream' } }],
  }), { headers: { 'Content-Type': 'Application/JSON; charset=utf-8' } }));
  assert.equal(await client.chat([]), 'feat: provider ignored stream');
});

test('complete JSON responses fail loudly on API errors, invalid JSON and empty content', async () => {
  for (const [body, expected] of [
    [JSON.stringify({ error: { message: 'Quota exceeded', type: 'insufficient_quota', code: 'insufficient_quota' } }), /API request failed: Quota exceeded/],
    ['{invalid', { name: 'SyntaxError' }],
    [JSON.stringify({ choices: [{ message: { content: ' ' } }] }), /No response content from API/],
  ]) {
    const client = createClient(async () => new Response(body, { headers: { 'Content-Type': 'application/json' } }));
    await assert.rejects(client.chat([]), expected);
  }
});

test('streaming requests reject unsupported success content types without parsing them', async () => {
  for (const [headers, expected] of [[{ 'Content-Type': 'text/html; charset=utf-8' }, 'text/html'], [{}, 'none']]) {
    let cancelled = false;
    const response = new Response(new ReadableStream({
      start(controller) { controller.enqueue(Buffer.from('<html>gateway</html>')); },
      cancel() { cancelled = true; },
    }), { headers });
    const client = createClient(async () => response);
    await assert.rejects(client.chat([]), new RegExp(`unsupported Content-Type "${expected}" for a streaming request`));
    assert.equal(cancelled, true);
  }
});

test('an already cancelled token prevents the request', async () => {
  const token = cancellationToken(true);
  const client = createClient(() => assert.fail('must not fetch'));
  await assert.rejects(client.chat([], token), { name: 'AbortError' });
  assert.equal(token.disposed, 1);
});

test('cancelling while reading aborts the request without returning partial content', async () => {
  const token = cancellationToken();
  let signal;
  let controller;
  const response = new Response(new ReadableStream({
    start(value) {
      controller = value;
      controller.enqueue(Buffer.from(event('feat: partial')));
    },
  }), SSE);
  const client = createClient(async (url, options) => {
    signal = options.signal;
    // Real fetch errors its response body when the request signal is aborted.
    signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
    return response;
  });
  const pending = client.chat([], token);
  await new Promise(resolve => setImmediate(resolve));
  token.cancel();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(signal.aborted, true);
  assert.equal(response.body.locked, false);
  assert.equal(token.disposed, 1);
});

test('fetch failures dispose the cancellation subscription', async () => {
  const token = cancellationToken();
  const failure = new Error('fetch failed');
  const client = createClient(async () => { throw failure; });
  await assert.rejects(client.chat([], token), error => error === failure);
  assert.equal(token.disposed, 1);
});

test('a missing API key still fails without sending a request', async () => {
  const client = createClient(() => assert.fail('must not fetch'), { apiKey: '' });
  await assert.rejects(client.chat([]), /API Key not configured/);
});
