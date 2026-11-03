// Os mesmos casos (cases.json) no Zod e no JSON Schema: os dois têm de aceitar e recusar igual.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import {
  MAX_PROFILE_BYTES,
  parseProfileFile,
  parseProfileText,
  serializeProfileFile,
} from '../src/index.ts';

const root = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

interface Case {
  name: string;
  code?: string;
  profile?: unknown;
  file?: unknown;
}
const cases: { valid: Case[]; invalid: Case[] } = JSON.parse(read('cases.json'));
const fileOf = (c: Case) =>
  c.file ?? { format: 'macitrun-profile', version: 1, profile: c.profile, testedOn: { app: '0.5.2' } };

const jsonSchema = new Ajv2020({ allErrors: true, strict: true }).compile(
  JSON.parse(read('profile.schema.json')),
);

describe('perfis válidos', () => {
  for (const c of cases.valid) {
    test(c.name, () => {
      const result = parseProfileFile(fileOf(c));
      assert.ok(result.ok, JSON.stringify(!result.ok && result.issues));
      assert.ok(jsonSchema(fileOf(c)), JSON.stringify(jsonSchema.errors));
    });
  }
});

describe('perfis inseguros ou inválidos são recusados', () => {
  for (const c of cases.invalid) {
    test(c.name, () => {
      const result = parseProfileFile(fileOf(c));
      assert.equal(result.ok, false);
      assert.ok(
        !result.ok && result.issues.some((issue) => issue.code === c.code),
        `esperava ${c.code}, veio ${JSON.stringify(!result.ok && result.issues)}`,
      );
      assert.equal(jsonSchema(fileOf(c)), false, 'o JSON Schema também tem de recusar');
    });
  }
});

describe('arquivo', () => {
  const example = read('examples/dark-souls-3.macitrun-profile');

  test('o exemplo é válido e volta igual, byte a byte', () => {
    const result = parseProfileText(example);
    assert.ok(result.ok);
    assert.equal(serializeProfileFile(result.file), example);
  });

  test('a validação devolve as chaves na ordem do formato', () => {
    const shuffled = JSON.parse(example);
    const reordered = {
      testedOn: shuffled.testedOn,
      profile: Object.fromEntries(Object.entries(shuffled.profile).reverse()),
      version: 1,
      format: 'macitrun-profile',
    };
    const result = parseProfileFile(reordered);
    assert.ok(result.ok);
    assert.equal(serializeProfileFile(result.file), example);
  });

  test(`recusa mais de ${MAX_PROFILE_BYTES} bytes`, () => {
    const file = JSON.parse(example);
    file.profile.notes = 'n'.repeat(2000);
    file.profile.arguments = Array.from({ length: 20 }, () => 'a'.repeat(256));
    file.profile.environment = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`DXVK_OPTION_${i}`, 'a'.repeat(256)]),
    );
    const text = JSON.stringify(file);
    assert.ok(text.length > MAX_PROFILE_BYTES);
    assert.ok(parseProfileFile(file).ok, 'cada campo está no limite');
    assert.deepEqual(parseProfileText(text), { ok: false, issues: [{ path: '', code: 'too_large' }] });
  });

  test('recusa texto que não é JSON', () => {
    assert.deepEqual(parseProfileText('{"format":'), {
      ok: false,
      issues: [{ path: '', code: 'invalid_json' }],
    });
  });

  test('aponta o campo do problema', () => {
    const result = parseProfileFile(
      fileOf({ name: '', profile: { id: 'x', name: 'X', executables: ['X.exe'], environment: { DYLD_INSERT_LIBRARIES: '/a' } } }),
    );
    assert.ok(!result.ok);
    assert.deepEqual(result.issues, [
      { path: 'profile.environment.DYLD_INSERT_LIBRARIES', code: 'environment_not_allowed' },
    ]);
  });
});
