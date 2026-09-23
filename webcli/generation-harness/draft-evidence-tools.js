import fs from 'node:fs';
import path from 'node:path';
import { assertManagedFile } from '../adapter-package-files.js';
import { isPackageDraft, packageDraftBundle, readGenerationEvidence } from './package-inspection.js';

export function createDraftEvidenceTools(getAdapterDir, onWrite = () => {}) {
  return [{
    name: 'inspect_generation_evidence',
    description: '读取 v2 草稿的结构化来源证据与独立 mock 用例；来源证据不可修改。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => {
      const dir = getAdapterDir();
      if (!isPackageDraft(dir)) throw new Error('Historical drafts use inline verification fixtures.');
      return { source: readGenerationEvidence(dir), writeVerification: readGenerationEvidence(dir, 'write-verification.json', { optional: true }) };
    },
  }, {
    name: 'write_generation_fixture',
    description: '保存 v2 草稿某个写命令的本地 mock 用例；独立于可安装包，只使用虚构参数。',
    parameters: { type: 'object', properties: { commandId: { type: 'string' }, fixture: { type: 'object', additionalProperties: true } }, required: ['commandId', 'fixture'], additionalProperties: false },
    execute: async ({ commandId, fixture }) => {
      const dir = getAdapterDir();
      const { manifest } = packageDraftBundle(dir);
      if (!manifest.commands.some(command => command.id === commandId && command.safety === 'write')) throw new Error('Fixture requires a declared write command.');
      if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)) throw new Error('Fixture must be an object.');
      const data = readGenerationEvidence(dir, 'write-verification.json', { optional: true }) || { format: 2, commands: {} };
      data.commands[commandId] = fixture;
      const content = JSON.stringify(data, null, 2) + '\n';
      if (content.length > 50_000) throw new Error('Generation fixtures exceed size limit.');
      const file = assertManagedFile(path.dirname(dir), `.generation/${manifest.name}/write-verification.json`);
      fs.writeFileSync(file, content);
      onWrite(commandId);
      return { written: true, commandId };
    },
  }];
}
