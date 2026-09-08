import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
  FEEDBACK_LAYER_CONTRACT_MAX_BYTES, FEEDBACK_LAYER_SDK_MAX_BYTES,
  FEEDBACK_LAYER_CONTRACT_ROUTE, FEEDBACK_LAYER_SDK_ROUTE,
  FEEDBACK_LAYER_EXPECTED_ORIGIN, FEEDBACK_LAYER_PROTOCOL,
  FeedbackLayerPilotConfigurationError, FeedbackLayerServiceUnavailable,
  fetchVerifiedFeedbackLayerSdk,
} from '../desktop/vite.feedback-layer-pilot.ts';

const sdk = Buffer.from('export const pilot = true;\n');
const config = {
  serviceUrl: 'http://127.0.0.1:3178', projectId: `project_${'a'.repeat(32)}`,
  expectedOrigin: FEEDBACK_LAYER_EXPECTED_ORIGIN, contract: FEEDBACK_LAYER_PROTOCOL,
};
function contract(byteLength = sdk.length) {
  return {
    protocol: FEEDBACK_LAYER_PROTOCOL, protocolVersion: 1,
    application: { name: 'Feedback Layer', version: '0.3.0' },
    sdk: { route: FEEDBACK_LAYER_SDK_ROUTE, global: 'FeedbackLayer', byteLength,
      sha256: createHash('sha256').update(sdk).digest('hex') },
    methods: { install: 'install', completeResolutionChallenge: 'completeResolutionChallenge' },
    requirements: { activeProject: true, developmentOnly: true, exactOrigin: true,
      loopbackService: true, minimumConsumerProtocol: 1 },
    attributes: { applicationAnchor: 'data-feedback-anchor', private: 'data-feedback-private',
      redact: 'data-feedback-redact', semanticId: 'data-feedback-id' },
    limits: { attachmentBytes: 5_242_880, resolutionCandidates: 200, resolutionScanElements: 2_000 },
  };
}
function headers(route) {
  return { 'Content-Type': route === 'contract' ? 'application/json' : 'text/javascript',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
}
function service(overrides = {}, metadata = contract()) {
  const calls = [];
  const fetchImpl = async (input, init) => {
    const route = String(input).endsWith(FEEDBACK_LAYER_CONTRACT_ROUTE) ? 'contract' : 'sdk';
    calls.push(route);
    if (overrides[route]) return overrides[route](init);
    return new Response(route === 'contract' ? JSON.stringify(metadata) : sdk, { headers: headers(route) });
  };
  return { fetchImpl, calls };
}
async function within(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Transport exceeded the test watchdog.')), 1_000);
    })]);
  } finally { clearTimeout(timer); }
}
function verify(fetchImpl) {
  return within(fetchVerifiedFeedbackLayerSdk(config, { fetchImpl, timeoutMs: 40 }));
}

export function registerTransportTests(test) {
test('accepts complete, bounded, verified responses', async () => {
  const { fetchImpl, calls } = service();
  assert.deepEqual((await verify(fetchImpl)).bytes, sdk);
  assert.deepEqual(calls, ['contract', 'sdk']);
});
test('bounds header waits even when fetch ignores AbortSignal', async () => {
  await assert.rejects(verify(() => new Promise(() => {})), FeedbackLayerServiceUnavailable);
});
for (const route of ['contract', 'sdk']) {
  test(`${route}: deadline includes stalled body and nonsettling cancellation`, async () => {
    let canceled = false;
    let signal;
    const { fetchImpl } = service({ [route]: (init) => {
      signal = init.signal;
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(Uint8Array.of(123)); },
        cancel() { canceled = true; return new Promise(() => {}); },
      }), { headers: headers(route) });
    } });
    await assert.rejects(verify(fetchImpl), FeedbackLayerServiceUnavailable);
    assert.equal(signal.aborted, true);
    assert.equal(canceled, true);
  });
  for (const declared of [undefined, '1']) {
    test(`${route}: rejects streamed overflow with ${declared ? 'false' : 'absent'} Content-Length`, async () => {
      let canceled = false;
      const limit = route === 'contract' ? FEEDBACK_LAYER_CONTRACT_MAX_BYTES : sdk.length;
      const { fetchImpl } = service({ [route]: () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(limit));
          controller.enqueue(Uint8Array.of(1));
        },
        cancel() { canceled = true; },
      }), { headers: { ...headers(route), ...(declared ? { 'Content-Length': declared } : {}) } }) });
      await assert.rejects(verify(fetchImpl), (error) =>
        error instanceof FeedbackLayerPilotConfigurationError && /byte limit/.test(error.message));
      assert.equal(canceled, true);
    });
  }
  test(`${route}: rejects oversized declared length before consuming body`, async () => {
    let canceled = false;
    const limit = route === 'contract' ? FEEDBACK_LAYER_CONTRACT_MAX_BYTES : sdk.length;
    const { fetchImpl } = service({ [route]: () => new Response(new ReadableStream({
      cancel() { canceled = true; },
    }), { headers: { ...headers(route), 'Content-Length': String(limit + 1) } }) });
    await assert.rejects(verify(fetchImpl), FeedbackLayerPilotConfigurationError);
    assert.equal(canceled, true);
  });
  test(`${route}: stream read errors remain temporary and redact underlying details`, async () => {
    const { fetchImpl } = service({ [route]: () => new Response(new ReadableStream({
      start(controller) { controller.error(new Error('private network detail')); },
    }), { headers: headers(route) }) });
    await assert.rejects(verify(fetchImpl), (error) =>
      error instanceof FeedbackLayerServiceUnavailable && !error.message.includes('private'));
  });
}
test('rejects over-cap SDK metadata before requesting SDK bytes', async () => {
  const { fetchImpl, calls } = service({}, contract(FEEDBACK_LAYER_SDK_MAX_BYTES + 1));
  await assert.rejects(verify(fetchImpl), FeedbackLayerPilotConfigurationError);
  assert.deepEqual(calls, ['contract']);
});
test('short SDK bytes still fail exact length/hash verification', async () => {
  const { fetchImpl } = service({ sdk: () => new Response(sdk.subarray(1), { headers: headers('sdk') }) });
  await assert.rejects(verify(fetchImpl), /byte length or SHA-256/);
});
test('malformed bounded JSON remains a configuration error', async () => {
  const { fetchImpl } = service({ contract: () => new Response('{', { headers: headers('contract') }) });
  await assert.rejects(verify(fetchImpl), /not valid JSON/);
});
test('classifies HTTP failure before reading its potentially stalled body', async () => {
  for (const [status, ErrorClass] of [[503, FeedbackLayerServiceUnavailable], [403, FeedbackLayerPilotConfigurationError]]) {
    const { fetchImpl } = service({ contract: () => new Response(new ReadableStream(), {
      status, headers: headers('contract'),
    }) });
    await assert.rejects(verify(fetchImpl), ErrorClass);
  }
});
test('rejects invalid timeout values without starting a request', async () => {
  for (const timeoutMs of [0, -1, NaN, Infinity, 2_147_483_648]) {
    await assert.rejects(fetchVerifiedFeedbackLayerSdk(config, {
      timeoutMs, fetchImpl: () => { throw new Error('must not fetch'); },
    }), FeedbackLayerPilotConfigurationError);
  }
});
for (const stalledRoute of ['contract', 'sdk']) {
  test(`${stalledRoute}: native fetch aborts a real loopback response stalled after headers`, async () => {
    let sentPartialBody = false;
    const server = createServer((request, response) => {
      const route = request.url === FEEDBACK_LAYER_CONTRACT_ROUTE ? 'contract' : 'sdk';
      response.writeHead(200, headers(route));
      if (route === stalledRoute) {
        response.flushHeaders();
        response.write('{');
        sentPartialBody = true;
      } else response.end(route === 'contract' ? JSON.stringify(contract()) : sdk);
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const address = server.address();
      const realConfig = { ...config, serviceUrl: `http://127.0.0.1:${address.port}` };
      await assert.rejects(within(fetchVerifiedFeedbackLayerSdk(realConfig, { timeoutMs: 200 })), FeedbackLayerServiceUnavailable);
      assert.equal(sentPartialBody, true);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
}
test('preserves Response.json UTF-8 BOM handling', async () => {
  const { fetchImpl } = service({ contract: () => new Response('\uFEFF' + JSON.stringify(contract()), {
    headers: headers('contract'),
  }) });
  assert.deepEqual((await verify(fetchImpl)).bytes, sdk);
});
}
