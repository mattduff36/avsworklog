import { createHash } from 'crypto';
import { redactSensitiveText } from './logger';

export function hashIdentifier(value: string | null | undefined): string {
  const normalized = typeof value === 'string' && value.trim() ? value.trim() : 'unavailable';
  return createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}

export function sanitizeEvidenceLabel(label: string): string {
  return redactSensitiveText(label)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[REDACTED_EMAIL]')
    .replace(/[A-Za-z]:\\[^\s"']+/gu, '[REDACTED_PATH]')
    .replace(/\/(?:Users|home)\/[^\s"']+/gu, '[REDACTED_PATH]')
    .replace(/agent-transcripts[^\s"']*/giu, '[REDACTED_TRANSCRIPT_REF]');
}

export function assertNoForbiddenPayload(payload: unknown): string[] {
  const serialized = JSON.stringify(payload);
  const violations: string[] = [];
  if (/"user_email"\s*:/u.test(serialized)) violations.push('user_email must not be persisted');
  if (/agent-transcripts/iu.test(serialized)) violations.push('raw transcript path must not be persisted');
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(serialized)) {
    violations.push('email address must not be persisted');
  }
  return violations;
}
