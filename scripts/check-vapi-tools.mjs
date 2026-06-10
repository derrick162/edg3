#!/usr/bin/env node
/*
 * Safety check for Edg3's Vapi voice tools — a pre-flight checklist that catches the
 * exact mistakes that have broken ALL calls in production:
 *   1. An invalid parameter-key (e.g. a trailing space) → the AI model rejects EVERY call.
 *   2. A type-mismatched default (e.g. empty-string default on a boolean) → same.
 *   3. A missing server URL → the tool "returns no result" and the call stalls.
 *
 * These are configured in the Vapi dashboard (outside the repo), so a typo there can ship
 * without any code change. Run this after editing tools in Vapi — or wire it into deploy.
 *
 *   VAPI_API_KEY=...  ANTHROPIC_API_KEY=...  npm run check:vapi
 *
 * VAPI_API_KEY is required (it lives in Railway). ANTHROPIC_API_KEY is optional but adds the
 * DEFINITIVE check: it replays the whole tool set against the AI model exactly as a call does.
 * Exits non-zero if anything would break calls (so it can gate a deploy / run in CI).
 */

const VAPI_KEY = process.env.VAPI_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.VAPI_TOOLS_MODEL || 'claude-haiku-4-5-20251001';
const KEY_RE = /^[a-zA-Z0-9_.-]{1,64}$/; // Anthropic's allowed property-key pattern.

if (!VAPI_KEY) {
  console.error('❌ VAPI_API_KEY is not set. It lives in your Railway variables — set it and re-run.');
  process.exit(2);
}

const errors = [];
const warnings = [];

// Recursively validate a JSON-schema "properties" object (handles nested objects + array items).
function checkProps(toolName, props, path = 'parameters.properties') {
  if (!props || typeof props !== 'object') return;
  for (const [key, val] of Object.entries(props)) {
    if (!KEY_RE.test(key)) {
      errors.push(`${toolName}: invalid parameter name "${key}" (at ${path}). Names may only contain letters, digits, "_", ".", "-" and no spaces. THIS BREAKS EVERY CALL.`);
    }
    if (val && typeof val === 'object') {
      if ('default' in val && val.default === '' && val.type && val.type !== 'string') {
        errors.push(`${toolName}: parameter "${key}" is type ${val.type} but has an empty-text default — invalid; breaks calls.`);
      } else if ('default' in val && val.default === '') {
        warnings.push(`${toolName}: parameter "${key}" has an empty default (""). Harmless but it's Vapi-editor cruft — recommend removing.`);
      }
      if (val.properties) checkProps(toolName, val.properties, `${path}.${key}.properties`);
      if (val.items && val.items.properties) checkProps(toolName, val.items.properties, `${path}.${key}.items.properties`);
    }
  }
}

async function main() {
  console.log('🔎 Fetching Edge\'s tools from Vapi…');
  const res = await fetch('https://api.vapi.ai/tool', { headers: { Authorization: 'Bearer ' + VAPI_KEY } });
  if (!res.ok) {
    console.error(`❌ Could not fetch Vapi tools (HTTP ${res.status}). Check VAPI_API_KEY.`);
    process.exit(2);
  }
  const tools = await res.json();
  if (!Array.isArray(tools)) { console.error('❌ Unexpected response from Vapi.'); process.exit(2); }
  console.log(`   Found ${tools.length} tools.\n`);

  for (const t of tools) {
    const fn = t.function || {};
    const name = fn.name || t.id || '(unnamed)';
    if (fn.name && !KEY_RE.test(fn.name)) errors.push(`Tool name "${fn.name}" is invalid (spaces/special chars not allowed).`);
    checkProps(name, fn.parameters && fn.parameters.properties);
    if (t.type === 'function' && !(t.server && t.server.url)) {
      warnings.push(`${name}: no Server URL set — the model can call it but Vapi has nowhere to send it ("No result returned"). Set the Server URL if this tool talks to our backend.`);
    }
  }

  // Definitive check: send the whole tool set to the AI model exactly like a call does.
  if (ANTHROPIC_KEY) {
    console.log('🤖 Replaying the full tool set against the AI model (the real "will a call work" test)…');
    const toolDefs = tools
      .map(t => ({ name: t.function?.name, description: t.function?.description, input_schema: t.function?.parameters }))
      .filter(t => t.name && t.input_schema);
    const ar = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 16, messages: [{ role: 'user', content: 'hi' }], tools: toolDefs }),
    });
    if (ar.status === 200) {
      console.log('   ✅ The AI model accepts all tools — calls will work.\n');
    } else {
      const j = await ar.json().catch(() => ({}));
      errors.push(`The AI model REJECTED the tool set (HTTP ${ar.status}): ${JSON.stringify(j.error || j).slice(0, 300)} — calls would fail.`);
    }
  } else {
    console.log('ℹ️  ANTHROPIC_API_KEY not set — skipped the definitive AI-model check (static checks still ran).\n');
  }

  if (warnings.length) {
    console.log('⚠️  Warnings (review, not call-breaking):');
    for (const w of warnings) console.log('   - ' + w);
    console.log('');
  }
  if (errors.length) {
    console.log('❌ ERRORS — these will break calls. Fix them in the Vapi dashboard before deploying:');
    for (const e of errors) console.log('   - ' + e);
    console.log(`\n${errors.length} error(s) found.`);
    process.exit(1);
  }
  console.log('✅ All tools pass. Calls are safe.');
}

main().catch((e) => { console.error('check failed:', e.message); process.exit(2); });
