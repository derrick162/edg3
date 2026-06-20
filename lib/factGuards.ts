// Anti-hallucination guards for fact extraction (Core-owned). Pure, zero-I/O.
//
// Problem it solves: the extractor surfaced a health metric ("Derrick weighs
// 122 lbs") the user never stated on that call — the LLM inferred it from
// ambient context. Health/body numbers are sensitive and must be GROUNDED:
// only stored when the exact number appears in the source text the user
// actually produced (transcript / inbox digest).

// Statement looks like a health/body measurement that carries a number.
const HEALTH_METRIC_RE =
  /\b(weigh|weighs|weighed|weight|lbs?|pounds|kilograms?|kgs?|blood\s*pressure|heart\s*rate|resting\s*heart|bmi|body\s*fat|cholesterol|waist|height|tall)\b/i;

/** Extract bare numbers (ints/decimals) from a string. */
export function numbersIn(s: string): string[] {
  return s.match(/\d+(?:\.\d+)?/g) ?? [];
}

/** True if the statement is a numeric health/body-measurement claim. */
export function isHealthMetricStatement(statement: string): boolean {
  return HEALTH_METRIC_RE.test(statement) && /\d/.test(statement);
}

/**
 * True when EVERY number in `statement` also appears in `source`.
 * A statement with no numbers is trivially grounded.
 */
export function isGroundedInSource(statement: string, source: string | null | undefined): boolean {
  const nums = numbersIn(statement);
  if (nums.length === 0) return true;
  const src = source ?? '';
  return nums.every(n => src.includes(n));
}

/**
 * True when a fact should be DROPPED as an ungrounded health metric:
 * it reads like a body measurement with a number, but that number is not
 * present in the source text the user actually produced.
 */
export function isUngroundedHealthFact(statement: string, source: string | null | undefined): boolean {
  return isHealthMetricStatement(statement) && !isGroundedInSource(statement, source);
}
