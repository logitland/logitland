import { APPEALED_LABELS, PolicyCode, type AdminAppeal } from '@logitland/contracts';
import { POLICY_LABELS } from './labels';

/**
 * What an appeal is against: the decision it recorded when it was made (not the target's state now, which overturning changes),
 * and from the subject the relay attaches, a message's text and the reason. `kind` is the decision's badge, `undone` its noun.
 */
export function appealed({ target_type, subject, decision }: Pick<AdminAppeal, 'target_type' | 'subject' | 'decision'>) {
  const field = (key: string) => (typeof subject?.[key] === 'string' ? subject[key] : null);
  const policy = PolicyCode.safeParse(subject?.policy_code).data;
  const reason = target_type === 'status' ? field('status_reason') : (field('reason') ?? (policy ? POLICY_LABELS[policy] : field('status_reason')));
  const content = target_type === 'message' ? field('content') : null;
  // Only appeals decided before decisions were recorded have none.
  return { kind: decision ? APPEALED_LABELS[decision] : 'Appeal', reason, content, undone: decision ?? 'decision' };
}
