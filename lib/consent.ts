/**
 * Data consent enforcement.
 *
 * Edg3 offers two settings (stored in users.data_consent by Core):
 *   'improve'  — user opts in to product-improvement use of their data
 *   'privacy'  — data used only to power their own experience (inference-only)
 *
 * DEFAULT: When the column doesn't exist yet (Core hasn't landed it) or is null,
 * we treat the user as Privacy Mode ('privacy'). This means the safe default is
 * NOT to include data in any improvement pathway until the user explicitly opts in.
 *
 * Callers:
 *   if (!isImproveConsented(user)) return; // skip improvement path
 *
 * See content/security-audit.md §"Data consent and Privacy Mode" for CASA details.
 */

export type DataConsent = 'improve' | 'privacy';

/**
 * Returns true only when the user has explicitly opted into product-improvement
 * use of their data (data_consent === 'improve').
 *
 * Degrades safely: null / undefined / any other value → false (Privacy Mode).
 * This means the system defaults to the privacy-preserving path until the user
 * actively opts in — consistent with the CASA compliance posture.
 */
export function isImproveConsented(user: { data_consent?: DataConsent | null }): boolean {
  return user.data_consent === 'improve';
}

/**
 * Returns true when Privacy Mode is in effect: either explicitly set or not yet chosen.
 * Complement of isImproveConsented; use whichever reads more naturally at the call site.
 */
export function isPrivacyMode(user: { data_consent?: DataConsent | null }): boolean {
  return !isImproveConsented(user);
}
