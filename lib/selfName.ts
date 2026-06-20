// Self-name matching — shared by fact extraction (lib/facts.ts) and calendar
// attendee filtering (lib/relationships.ts). Pure, zero-I/O, fully unit-testable.
//
// Problem it solves: the user's own name leaks into "person" facts and the
// "people you meet with" list under nickname / STT / initial variants the old
// exact-match guard missed ("derek" for "Derrick", "Fung", "D. Fung").
//
// Strategy: exact forms first (full name, first name, last name, initial+last),
// then a phonetic (Soundex) fallback on the first name so STT/nickname variants
// like "Derek"≈"Derrick" are caught without dropping genuinely different people.

/**
 * American Soundex. Maps a word to a letter + 3 digits (e.g. "Derek"/"Derrick"
 * → "D620"). Used to catch phonetic spellings of the same name.
 */
export function soundex(input: string): string {
  const s = (input || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!s) return '';
  const codeOf: Record<string, string> = {
    B: '1', F: '1', P: '1', V: '1',
    C: '2', G: '2', J: '2', K: '2', Q: '2', S: '2', X: '2', Z: '2',
    D: '3', T: '3',
    L: '4',
    M: '5', N: '5',
    R: '6',
  };
  const first = s[0];
  let result = first;
  let prev = codeOf[first] ?? '';
  for (let i = 1; i < s.length && result.length < 4; i++) {
    const c = s[i];
    const code = codeOf[c] ?? '';
    if (code && code !== prev) result += code;
    // Vowels (and any non-coded letter except H/W) reset the "previous code"
    // so a repeated consonant separated by a vowel is counted twice.
    if (c !== 'H' && c !== 'W') prev = code;
  }
  return (result + '000').slice(0, 4);
}

/**
 * True when `entity` refers to the user themselves (the owner named `userName`).
 * Case-insensitive. Matches: full name, first name, last name, "initial last"
 * / "initial. last" forms, and phonetic first-name variants (Derek ≈ Derrick).
 */
export function matchesSelfName(
  entity: string | null | undefined,
  userName: string | null | undefined,
): boolean {
  if (!entity || !userName) return false;
  const e = entity.trim().toLowerCase().replace(/\.+$/, '');
  const u = userName.trim().toLowerCase();
  if (!e || !u) return false;

  const parts = u.split(/\s+/).filter(Boolean);
  const first = parts[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1] : '';

  // Direct forms.
  if (e === u) return true;
  if (first && e === first) return true;
  if (last && last.length >= 3 && e === last) return true;

  // Initial + last name: "d fung", "d. fung", "d.fung".
  if (first && last) {
    const init = first[0];
    const eNoDot = e.replace(/\./g, '').replace(/\s+/g, ' ').trim();
    if (eNoDot === `${init} ${last}` || eNoDot === `${init}${last}`) return true;
  }

  // Phonetic first-name variant (Derek ≈ Derrick). Guard against short tokens and
  // multi-word entities to avoid dropping genuinely different single-name people.
  if (first.length >= 4 && e.length >= 4 && !e.includes(' ')) {
    if (soundex(e) === soundex(first)) return true;
  }

  return false;
}
