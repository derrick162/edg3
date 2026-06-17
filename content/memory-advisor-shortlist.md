# Memory moat advisor shortlist
_Research compiled June 2026. Goal: technical advisors who can help build the episodic store, knowledge graph, and pattern memory layers._

---

## How to use this

These are people who have *built* the exact architecture Edge needs — not just thought about it. Priority: Tier 1 first. One warm intro is worth ten cold DMs. Check mutual connections on LinkedIn before reaching out.

**What to offer:** Equity in the 0.1–0.25% range (standard early advisor), a genuine problem to solve, and a clear reason why you picked them specifically. Don't send a generic pitch.

---

## Tier 1 — Highest signal, directly relevant, startup-accessible

### 1. Daniel Chalef
**Who:** Founder & CEO, [Zep AI](https://www.getzep.com/) (YC W24)
**LinkedIn:** linkedin.com/company/zep-ai (search Daniel Chalef)
**Why:** Zep's Graphiti engine is a temporal knowledge graph with timestamped nodes and edges — exactly what Edge's relationship and pattern memory layers need. Daniel is a fellow early-stage founder (Zep raised their seed in 2024), which makes him approachable and means he's still close to the technical details.
**What he brings:** Knowledge graph architecture for AI memory, temporal fact storage, the "yesterday vs today" memory problem that Edge will hit when pattern memory ships.
**Approach:** "We've been following Zep's Graphiti work — the timestamped edge approach is exactly the right model for relationship memory in a personal context. We're building Edge's pattern/relationship layers now and would love 30 minutes with you."
**Potential conflict:** Zep is an enterprise-focused infrastructure layer; Edge is a consumer product. Different market — low conflict risk.

---

### 2. Charles Packer
**Who:** Co-founder & CEO, [Letta](https://www.letta.com/) (formerly MemGPT), UC Berkeley PhD
**LinkedIn:** [linkedin.com/in/charles-packer](https://www.linkedin.com/in/charles-packer/)
**Personal site:** charlespacker.com
**GitHub:** github.com/cpacker
**Why:** Charles *wrote* the MemGPT paper — the research that defined the three-tier memory architecture (in-context + episodic + semantic) that Edge's memory moat is built around. He's a startup founder at roughly the same stage (Letta raised $10M seed in 2024). His PhD was specifically on long-term memory management for LLMs.
**What he brings:** The definitive architecture for episodic memory + how to make it production-grade. Would give Edge's memory moat credibility with technical investors.
**Approach:** "We've read the MemGPT paper closely and built our memory architecture around the three-tier model. We're working on the ground-truth episode store now and hitting some real design decisions — would love your perspective."
**Potential conflict:** Letta is developer infrastructure (agents API); Edge is a consumer product using those patterns. Different market — low conflict.

---

### 3. Sarah Wooders
**Who:** Co-founder & CTO, [Letta](https://www.letta.com/), UC Berkeley PhD (Systems)
**LinkedIn:** [linkedin.com/in/wooders](https://www.linkedin.com/in/wooders/)
**Personal site:** swooders.com
**Twitter/X:** @sarahwooders
**Why:** Sarah is the systems architect behind Letta — her PhD was specifically on distributed systems for AI. While Charles focuses on memory algorithms, Sarah focuses on making memory systems production-reliable at scale. That's the layer Edge needs help with: making episodic memory work correctly under real user load, not just in a demo.
**What she brings:** Production systems architecture for AI memory — durability, retrieval correctness, latency. The "does it actually work" layer.
**Approach:** Direct and technical. "We're building an episodic store for user call history and hitting design decisions around retrieval — when to surface raw episodes vs. extracted facts. You've shipped this in production. Would love 20 minutes."
**Note:** She's more systems/engineering than product — pitch the technical problem, not the vision.

---

## Tier 2 — Relevant, slightly less accessible (founder-stage or senior researcher)

### 4. Suman Kanuganti
**Who:** Co-founder & CEO, [Personal AI](https://www.personal.ai/)
**LinkedIn:** [linkedin.com/in/kanugantisuman](https://www.linkedin.com/in/kanugantisuman)
**Why:** Suman is building exactly what Edge is building — a personal AI with memory that becomes more valuable over time ("own your own AI, transform personal knowledge into a digital asset"). His framing — memory as personal ownership — maps directly onto Edge's memory moat thesis. He's a two-time venture-backed founder, Forbes 40 Under 40, 10 patents.
**What he brings:** Product and go-to-market intuition for consumer AI memory products. Has already hit and solved problems Edge will hit in the next 12 months.
**Potential conflict:** Personal.ai is a direct competitor in concept, though their target market and UX are different (they're more B2B/enterprise-facing). Worth a conversation to see if there's genuine alignment. If he sees Edge as complementary, great. If not, he'll say so.
**Approach:** "We're building a voice-first Chief of Staff for founders. The memory moat thesis is the same as yours — value compounds the longer you use it. Different product surface, potentially complementary. Would you be open to a conversation?"

---

### 5. Deshraj Yadav
**Who:** Co-founder & CTO, [Mem0](https://mem0.ai/) (YC S24)
**LinkedIn:** [linkedin.com/in/deshrajdry](https://www.linkedin.com/in/deshrajdry/)
**Personal site:** deshraj.ai
**Why:** Deshraj led the AI Platform at Tesla Autopilot (large-scale training + monitoring infrastructure) before building Mem0. He's one of the deepest engineers working on AI memory in production at scale — 48K GitHub stars, exclusive memory provider for AWS's Agent SDK.
**What he brings:** Production memory engineering at scale. The operational layer — how memory pipelines work under load, how retrieval stays accurate over time, evaluation frameworks for memory quality.
**Potential conflict:** Mem0 is infrastructure that Edge could theoretically *use* rather than build. If Derrick decides to buy vs. build on memory, talking to Deshraj first is smart — could be a partnership conversation, not an advisor conversation.
**Approach:** Frame it as "we're deciding whether to build or use a library like Mem0 for our memory layer, and we'd love your honest take on the tradeoffs." This positions it as a legitimate technical question rather than a pitch for his time.

---

## Tier 3 — Longer shots (senior / well-known, worth noting if you have a warm intro)

### 6. Ion Stoica
**Who:** Professor of Computer Science, UC Berkeley; Co-founder of Databricks, Anyscale, LMArena; Advisor to Letta
**LinkedIn:** [linkedin.com/in/ionstoica](https://www.linkedin.com/in/ionstoica/)
**Why:** Stoica is the academic godfather of distributed AI systems — Spark, Ray, vLLM all came out of his lab. He's already an advisor to Letta, meaning he has direct context on the memory architecture problem. His portfolio companies are worth north of $100B combined.
**Realistic assessment:** Too senior and too busy to advise a seed-stage startup without a warm intro. But if you have a Berkeley connection or can get introduced through Charles Packer or Sarah Wooders, worth asking.
**Approach:** Only via warm intro. "Charles/Sarah suggested I reach out — we're building on the three-tier memory model and Ion's perspective on the systems layer would be invaluable."

---

## Outreach priority order

1. **Daniel Chalef** — most accessible, direct product relevance (knowledge graphs + temporal memory), fellow early-stage founder. Message him on LinkedIn.
2. **Charles Packer** — highest technical credibility for the memory moat narrative. Start on LinkedIn or his personal site contact form.
3. **Sarah Wooders** — direct technical problem (systems architecture for episodic store). Twitter/X or LinkedIn.
4. **Deshraj Yadav** — might turn into a "use vs. build" conversation. LinkedIn + frame as a technical Q.
5. **Suman Kanuganti** — product/market intuition, potentially a strategic conversation. LinkedIn.
6. **Ion Stoica** — warm intro only.

---

## What to say in the first message (template)

> Hi [Name],
>
> I'm building Edge — a voice AI that calls founders every morning, integrates calendar/email/health data, and acts as a Chief of Staff with memory. The core bet: the moat is years of accumulated structured context, not the AI model itself.
>
> [One specific sentence about their work that shows you've actually read it — reference Graphiti / the MemGPT paper / Personal AI's memory ownership framing / etc.]
>
> I'd love 20 minutes to get your read on [specific technical decision we're facing — episode store schema / temporal fact retrieval / pattern detection]. Not a pitch — a genuine technical question from someone building in the same space.
>
> Happy to share what we've built so far if it's useful context.
>
> Derrick Fung, Founder — Edg3

**Keep it under 150 words. Specific beats impressive. One clear ask.**

---

_Research: Esther (CoS), June 2026. Sources: LinkedIn, TechCrunch, Felicis blog, Mem0 press releases, Letta about page._
