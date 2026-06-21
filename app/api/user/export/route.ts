// R17 T2 — export consolidation. `/api/user/export` and `/api/account/export` were two GDPR
// export endpoints that would drift. `/api/account/export` is the canonical, comprehensive one
// (now also carries callFeedback / notificationLog / whoopConnected / pushSubscriptionsCount,
// merged from here). This route is kept as a thin alias that delegates to it, so any existing
// caller of /api/user/export keeps working and returns the same complete export.
export { GET } from '../../account/export/route';
