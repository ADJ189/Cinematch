import { expect, test } from '@playwright/test';
import { buildCandidates, MODELS, validateExplanation, validateSmoke, type ResourceSnapshot } from '../src/lib/ai-policy';

const strong: ResourceSnapshot = { deviceMemoryGb: 8, cores: 8, mobile: false, webgpuAdapter: true, crossOriginIsolated: true };
const keys = (mode: Parameters<typeof buildCandidates>[0], r: ResourceSnapshot) => buildCandidates(mode, r).map((c) => c.key);

test.describe('local AI policy (pure)', () => {
  test('pinned revisions and approximate sizes match the policy', () => {
    expect(MODELS['qwen2.5-0.5b'].revision).toBe('516c8d04add8a80c5228f32102b57953b8d421a9');
    expect(MODELS['smollm2-360m'].revision).toBe('fe7c7db4c8921c9e3fa1c65cfd296fb3b1b1a8f9');
    expect(MODELS['smollm2-135m'].revision).toBe('b8a5c0f183b78c55955a5364f610c36668b5e681');
    expect(MODELS['qwen2.5-0.5b'].webgpu).toEqual({ dtype: 'q4f16', approxMb: 483 });
    expect(MODELS['qwen2.5-0.5b'].wasm).toEqual({ dtype: 'q8', approxMb: 512 });
    expect(MODELS['smollm2-360m'].webgpu.approxMb).toBe(272);
    expect(MODELS['smollm2-360m'].wasm.approxMb).toBe(363);
    expect(MODELS['smollm2-135m'].webgpu.approxMb).toBe(117);
    expect(MODELS['smollm2-135m'].wasm.approxMb).toBe(136);
  });

  test('lightweight never yields a candidate', () => {
    expect(keys('lightweight', strong)).toEqual([]);
  });

  test('mode priority order', () => {
    expect(keys('best', strong).slice(0, 3)).toEqual(['qwen2.5-0.5b:webgpu', 'smollm2-360m:webgpu', 'smollm2-135m:webgpu']);
    expect(keys('balanced', strong)[0]).toBe('smollm2-360m:webgpu');
    expect(keys('fastest', strong)[0]).toBe('smollm2-135m:webgpu');
  });

  test('low-resource or unknown-memory devices never attempt Qwen', () => {
    for (const r of [
      { ...strong, deviceMemoryGb: undefined },
      { ...strong, deviceMemoryGb: 4 },
      { ...strong, cores: 2 },
      { ...strong, mobile: true },
    ]) {
      expect(keys('best', r).some((k) => k.startsWith('qwen'))).toBe(false);
      expect(keys('fastest', r).some((k) => k.startsWith('qwen'))).toBe(false);
    }
  });

  test('constrained devices only get the smallest model', () => {
    const phone = { ...strong, mobile: true, webgpuAdapter: false };
    expect(keys('balanced', phone)).toEqual(['smollm2-135m:wasm']);
  });

  test('explanations: accepts one short sentence, rejects the rest', () => {
    expect(validateExplanation('A tense, well-rated thriller that matches your dark mood.')).not.toBeNull();
    expect(validateExplanation('"Mr. Robot is a tense, dark drama that fits your mood."')).toBe('Mr. Robot is a tense, dark drama that fits your mood.');
    for (const bad of [
      '',
      '   ',
      undefined,
      'Great.',
      "Sure! Here is a sentence about it.",
      "I'm sorry, I can't help with that request today.",
      'It is dark. It is also very tense and rewarding.',
      'A dark thriller.\nAnd more here.',
      '- a dark tense thriller for you',
      '**Dark** thriller that fits you well',
      Array.from({ length: 21 }, () => 'word').join(' '),
    ]) {
      expect(validateExplanation(bad)).toBeNull();
    }
    expect(validateExplanation(Array.from({ length: 20 }, () => 'word').join(' '))).not.toBeNull();
  });

  test('smoke check needs only short usable text', () => {
    expect(validateSmoke('Ready.')).toBe(true);
    for (const bad of ['', '123', null, 'x'.repeat(201)]) expect(validateSmoke(bad)).toBe(false);
  });
});
