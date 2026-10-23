import { fail, isObject, prop } from './util.ts';

export type DesignTarget = { designId: number; version: number; requestedAt: string | null; roundPostedAt: string | null };
export type PendingFeedback = {
  feedbackId: string; target: DesignTarget; receivedAt: string;
  source: 'session' | 'ado'; recordedAt: string | null;
  consumedAt?: string | null; delegatedAt?: string | null; resolution?: string;
};
const validTime = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function validateDesignTarget(value: unknown): DesignTarget {
  if (!isObject(value) || !Number.isSafeInteger(value.designId) || value.designId <= 0
    || !Number.isSafeInteger(value.version) || value.version < 0
    || !(value.requestedAt === null || validTime(value.requestedAt))
    || !(value.roundPostedAt === null || validTime(value.roundPostedAt))) {
    fail('ASDF_DESIGN_INVALID', 'invalid design target');
  }
  return { designId: value.designId, version: value.version, requestedAt: value.requestedAt, roundPostedAt: value.roundPostedAt };
}
export function designTarget(state: unknown): DesignTarget | null {
  const id = prop(prop(state, 'ado'), 'hldId');
  if (id === null || id === undefined) return null;
  const hld = prop(state, 'hld');
  return validateDesignTarget({ designId: id, version: prop(hld, 'version') ?? 0,
    requestedAt: prop(hld, 'approvalRequestedAt') ?? null, roundPostedAt: prop(hld, 'roundPostedAt') ?? null });
}
export function sameDesignTarget(a: DesignTarget, b: DesignTarget): boolean {
  return a.designId === b.designId && a.version === b.version && a.requestedAt === b.requestedAt && a.roundPostedAt === b.roundPostedAt;
}
export function pendingDesignRevision(state: unknown): PendingFeedback | null {
  const value = prop(prop(state, 'hld'), 'pendingFeedback');
  if (value === null || value === undefined) return null;
  if (!isObject(value) || typeof value.feedbackId !== 'string' || !value.feedbackId
    || !validTime(value.receivedAt) || !['session', 'ado'].includes(value.source)
    || !(value.recordedAt === null || validTime(value.recordedAt))
    || !(value.consumedAt == null || validTime(value.consumedAt))
    || !(value.delegatedAt == null || validTime(value.delegatedAt))) fail('ASDF_DESIGN_INVALID', 'invalid pending design feedback');
  return { feedbackId: value.feedbackId, target: validateDesignTarget(value.target), receivedAt: value.receivedAt,
    source: value.source, recordedAt: value.recordedAt, consumedAt: value.consumedAt ?? null,
    delegatedAt: value.delegatedAt ?? null, resolution: typeof value.resolution === 'string' ? value.resolution : undefined };
}
export function designRevisionBlocks(state: unknown): boolean {
  const pending = pendingDesignRevision(state);
  return Boolean(pending && !(prop(prop(state, 'hld'), 'designDriver') === 'shared'
    && pending.recordedAt && pending.consumedAt && pending.delegatedAt));
}
export function assertDesignCanAdvance(state: unknown, nextStage: string): void {
  if (['approved', 'implementing', 'self-review', 'pr-ready'].includes(nextStage) && designRevisionBlocks(state)) {
    fail('ASDF_DESIGN_REVISION_PENDING', 'resolve recorded feedback and publish a revised design before advancing');
  }
}
