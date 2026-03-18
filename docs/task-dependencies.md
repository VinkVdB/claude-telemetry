# Task Dependency & Parallelization Map

## Mermaid Diagram

```mermaid
graph TD
    classDef wave1 fill:#003864,stroke:#003864,color:#fff
    classDef wave2 fill:#00a2e0,stroke:#00a2e0,color:#fff
    classDef wave3 fill:#0088c0,stroke:#0088c0,color:#fff
    classDef wave4 fill:#bdd72d,stroke:#bdd72d,color:#003864
    classDef wave5 fill:#8fb820,stroke:#8fb820,color:#fff
    classDef wave6 fill:#6a9a10,stroke:#6a9a10,color:#fff

    T1["T1: Scaffolding + Config"]:::wave1

    T2["T2: Database Layer"]:::wave2
    T3["T3: JSONL Parser"]:::wave2
    T4["T4: Cost Calculator"]:::wave2
    T6["T6: SSE Broadcaster"]:::wave2
    T10["T10: Frontend Scaffolding"]:::wave2

    T5["T5: Ingestion Processor"]:::wave3
    T8["T8: REST API"]:::wave3
    T11["T11: Projects Page"]:::wave3
    T12["T12: Session List/Detail"]:::wave3
    T13["T13: Agent Timeline"]:::wave3
    T14["T14: Trace View"]:::wave3
    T15["T15: Agent Graph"]:::wave3
    T16["T16: Raw Explorer"]:::wave3

    T7["T7: File Watcher"]:::wave4
    T17["T17: OTEL Receiver"]:::wave4

    T9["T9: Server Entry"]:::wave5
    T19["T19: Seed Script"]:::wave5

    T18["T18: Docker Setup"]:::wave6
    T20["T20: Integration"]:::wave6

    T1 --> T2
    T1 --> T3
    T1 --> T4
    T1 --> T6
    T1 --> T10

    T2 --> T5
    T3 --> T5
    T4 --> T5

    T2 --> T8
    T5 --> T8

    T5 --> T7
    T6 --> T7

    T2 --> T17
    T8 --> T17

    T10 --> T11
    T10 --> T12
    T10 --> T13
    T10 --> T14
    T10 --> T15
    T10 --> T16

    T7 --> T9
    T8 --> T9

    T9 --> T19
    T9 --> T18
    T16 --> T18

    T18 --> T20
    T19 --> T20
```

## Execution Waves

| Wave | Tasks | Agents Needed | Notes |
|------|-------|---------------|-------|
| **1** | T1 | 1 | Sequential — sets up package.json, tsconfig, config |
| **2** | T2, T3, T4, T6, T10 | **5 parallel** | All independent. Backend core + frontend scaffolding |
| **3** | T5, T8, T11-T16 | **8 parallel** | Processor + API + all 6 frontend pages/components |
| **4** | T7, T17 | **2 parallel** | Watcher + OTEL receiver |
| **5** | T9, T19 | **2 parallel** | Server entry + seed script |
| **6** | T18, T20 | 1 (sequential) | Docker + final integration |

## Practical Agent Allocation

Given context limits and merge complexity, recommended grouping:

### Agent A: Backend Core (T1 → T2 → T5 → T7 → T9)
Critical path — scaffolding through working server

### Agent B: Backend Utilities (T3, T4, T6)
Parser, pricing, broadcaster — all independent, merge into Agent A's work

### Agent C: REST API + OTEL (T8 → T17)
API routes then OTEL receiver

### Agent D: Frontend Shell + Pages (T10 → T11 → T12 → T16)
Scaffolding, projects, sessions, raw explorer

### Agent E: Frontend Visualizations (T13, T14, T15)
Agent timeline, trace view, agent graph — can start after T10

### Agent F: Infrastructure (T18 → T19 → T20)
Docker, seed, integration — runs last

**Max parallelism: 5 agents in Wave 2, but practically 3-4 agents is the sweet spot** to avoid merge conflicts (Agents A+B share `src/server/`, Agents D+E share `src/client/`).
