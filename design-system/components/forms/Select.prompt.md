Native dropdown styled for the dark canvas with a custom chevron; feed it `options` as `{label, value}` pairs (used for timezone / call-time pickers).

```jsx
<Select label="Timezone" value={tz} onChange={e => setTz(e.target.value)}
  options={[
    { label: 'New York / Toronto (ET)', value: 'America/New_York' },
    { label: 'London (GMT)', value: 'Europe/London' },
  ]}
/>
```

The menu uses the elevated `--edg-bg-select` fill so it reads above the page.
