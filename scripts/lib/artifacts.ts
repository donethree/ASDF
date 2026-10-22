import { resolve } from 'node:path';
import { itemPath } from './items.ts';
import { fail } from './util.ts';
import { inside, physical } from './localState.ts';
export { atomicJson, atomicText, check, inside, object, optionalJson, physical, stat, text, time, uuid } from './localState.ts';

export function artifactPath(id: number, ...parts: string[]): string {
  const folder = itemPath(id);
  if (!folder) fail('ASDF_ITEM_NOT_FOUND', String(id));
  const root = physical(folder, 'ASDF_ARTIFACT_PATH');
  const requested = resolve(folder, ...parts);
  if (!inside(resolve(folder), requested) && !inside(root, requested)) {
    fail('ASDF_ARTIFACT_PATH', `${requested} is outside item ${id}'s artifact folder`);
  }
  const path = physical(requested, 'ASDF_ARTIFACT_PATH');
  if (!inside(root, path)) fail('ASDF_ARTIFACT_PATH', `${path} is outside item ${id}'s artifact folder`);
  return path;
}
