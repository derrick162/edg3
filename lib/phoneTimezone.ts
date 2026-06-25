/**
 * Infer an IANA timezone from a NANP (North American Numbering Plan, +1) phone number's area code.
 *
 * Used as a fallback in effectiveTimezone (lib/db.ts) BEFORE the America/Los_Angeles default, so a
 * user who connects via a Vapi call before ever setting a timezone in the dashboard still gets a
 * sensible local zone (e.g. a Toronto 416 number → America/Toronto, not LA). An unmapped/non-NANP
 * number returns null and the caller keeps its existing default — this only ever improves accuracy.
 *
 * Background: greeting + scheduling are computed in the user's local hour. With no stored tz the LA
 * default shifted an Eastern user's 7:37 PM into the afternoon bucket → "Good afternoon" at night.
 *
 * The map covers the common NANP area codes per zone. Area codes that legitimately straddle two
 * zones within a state are assigned to the dominant metro zone; the dashboard browser-detect
 * (Core R35) is the precise source — this is the no-data safety net.
 */

// area code → IANA timezone. Grouped by zone for maintainability.
const AREA_CODE_TZ: Record<string, string> = {};
function add(tz: string, codes: string[]) { for (const c of codes) AREA_CODE_TZ[c] = tz; }

// ── United States ────────────────────────────────────────────────────────────
// Eastern
add('America/New_York', [
  '201','202','203','207','212','215','216','220','223','227','234','239','240','267','272','276',
  '301','302','304','315','321','330','332','339','347','351','352','364','380','386','401','404',
  '407','410','412','413','419','434','440','443','445','464','470','475','478','484','502','513',
  '516','517','518','540','551','557','561','567','570','571','585','586','594','607','610',
  '614','615','616','617','629','631','646','667','680','681','689','703','704','706','716','717',
  '718','724','727','732','740','743','754','757','762','770','772','774','781','786','787','802',
  '803','804','810','813','814','828','839','843','845','848','856','857','859','860','862','863',
  '864','865','878','904','906','908','910','912','914','917','919','929','934','937','939',
  '947','954','959','978','980','984','989',
]);
// Central
add('America/Chicago', [
  '205','210','214','217','218','219','224','225','228','251','254','256','262','270','309','312',
  '314','316','318','319','331','334','337','361','414','417','430','432','469','479','501',
  '504','507','512','515','563','573','580','601','608','618','620','630','636','641','651','660',
  '662','682','708','712','713','737','763','769','773','779','785','815','816','830','832','847',
  '870','872','901','903','913','915','918','920','936','940','952','956','972','979','985',
]);
// Mountain
add('America/Denver', [
  '303','307','308','385','406','435','505','575','719','720','970','801',
]);
// Arizona (no DST)
add('America/Phoenix', ['480','520','602','623','928']);
// Pacific
add('America/Los_Angeles', [
  '209','213','253','279','310','323','341','350','360','408','415','424','425','442','458','503',
  '510','530','541','559','562','564','619','626','628','650','657','661','669','707','714',
  '747','760','805','818','820','831','840','858','909','916','925','949','951','971',
]);
// Alaska / Hawaii
add('America/Anchorage', ['907']);
add('Pacific/Honolulu', ['808']);

// ── Canada ───────────────────────────────────────────────────────────────────
add('America/Toronto', [ // Ontario + Quebec (America/Montreal == America/Toronto)
  '226','249','289','343','365','416','437','519','548','613','647','705','807','905', // ON
  '418','438','450','468','514','579','581','819','873', // QC
]);
add('America/Halifax', ['902','782','428']); // NS + NB
add('America/St_Johns', ['709']); // Newfoundland
add('America/Winnipeg', ['204','431','584']); // Manitoba
add('America/Regina', ['306','639','474']); // Saskatchewan (no DST)
add('America/Edmonton', ['403','587','780','825','368']); // Alberta
add('America/Vancouver', ['236','250','257','604','672','778']); // BC

/**
 * Returns the IANA timezone for a NANP phone number, or null when the number isn't a usable +1
 * 10-digit NANP number or its area code isn't mapped.
 */
export function timezoneFromPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  let areaCode: string | null = null;
  if (digits.length === 11 && digits.startsWith('1')) areaCode = digits.slice(1, 4);
  else if (digits.length === 10) areaCode = digits.slice(0, 3);
  if (!areaCode) return null;
  return AREA_CODE_TZ[areaCode] ?? null;
}
