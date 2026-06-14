The frosted-glass surface nearly every piece of content sits on — near-black fill, hairline border, soft blur. The brand's default container.

```jsx
<Card>Briefing history…</Card>
<Card hover onClick={open}>Clickable briefing row</Card>
<Card accent>Chat with Edge — used in next briefing</Card>
```

`hover` adds the indigo border + glow lift for clickable cards; `accent` gives a persistent indigo-tinted border for "Edge is speaking" emphasis. `padding` defaults to 24 (use 32 for comfortable / hero cards). Cards rest flat — depth comes from the border and the ambient orbs behind them, not drop shadows.
