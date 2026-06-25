/**
 * S6 — Litestream S3 reachability helpers. Pure (probe injected), so the decision is deterministic.
 */
import { describe, it, expect } from 'vitest';
import { litestreamS3Url, checkS3Reachable } from './durability';

describe('litestreamS3Url', () => {
  it('returns null when no bucket is set', () => {
    expect(litestreamS3Url({})).toBeNull();
  });

  it('builds an AWS virtual-hosted URL from bucket + region', () => {
    expect(litestreamS3Url({ bucket: 'edg3-prod', region: 'us-west-2' })).toBe('https://edg3-prod.s3.us-west-2.amazonaws.com');
  });

  it('defaults the region to us-east-1', () => {
    expect(litestreamS3Url({ bucket: 'edg3-prod' })).toBe('https://edg3-prod.s3.us-east-1.amazonaws.com');
  });

  it('uses a custom endpoint (B2/R2/MinIO) when provided, adding https + bucket', () => {
    expect(litestreamS3Url({ bucket: 'edg3', endpoint: 's3.us-west-002.backblazeb2.com' }))
      .toBe('https://s3.us-west-002.backblazeb2.com/edg3');
    expect(litestreamS3Url({ bucket: 'edg3', endpoint: 'https://r2.example.com/' }))
      .toBe('https://r2.example.com/edg3');
  });
});

describe('checkS3Reachable', () => {
  it('checked=false when no bucket is configured (nothing to verify)', async () => {
    const r = await checkS3Reachable({}, async () => { throw new Error('should not run'); });
    expect(r.checked).toBe(false);
    expect(r.reachable).toBe(true);
  });

  it('reachable=true when the probe resolves (host answered, even a 403)', async () => {
    const r = await checkS3Reachable({ bucket: 'edg3-prod' }, async () => { /* resolved */ });
    expect(r).toMatchObject({ checked: true, reachable: true });
    expect(r.url).toContain('edg3-prod');
  });

  it('reachable=false when the probe rejects (network/DNS/TLS failure)', async () => {
    const r = await checkS3Reachable({ bucket: 'edg3-prod' }, async () => { throw new Error('ENOTFOUND'); });
    expect(r.checked).toBe(true);
    expect(r.reachable).toBe(false);
    expect(r.detail).toContain('UNREACHABLE');
  });
});
