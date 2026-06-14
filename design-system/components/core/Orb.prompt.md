Ambient blurred light orbs that give the dark canvas its depth — the brand's signature background treatment. Render them behind your content.

```jsx
<div style={{ position: 'relative', minHeight: '100vh', background: 'var(--surface-page)' }}>
  <Orb variant={1} />
  <Orb variant={2} />
  <div style={{ position: 'relative', zIndex: 1 }}>…page content…</div>
</div>
```

`variant={1}` is the large indigo orb (top-right); `variant={2}` is the smaller violet orb (bottom-left). They are `position:fixed`, `pointer-events:none`. Use the pair on every full-page surface (landing, auth, dashboard). Never put more than two — restraint keeps it calm.
