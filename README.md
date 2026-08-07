# CodeScore AI — Intelligent Code Evaluation Platform

> **AI-powered code evaluation with verified execution.** Correctness is determined by *actually running your code* against AI-generated test cases — not by an AI reading your code.

![Python](https://img.shields.io/badge/Python-FastAPI-009688?style=flat-square)
![JavaScript](https://img.shields.io/badge/Frontend-Vanilla_JS-F7DF1E?style=flat-square)
![Monaco](https://img.shields.io/badge/Editor-Monaco-007ACC?style=flat-square)
![Gemini](https://img.shields.io/badge/AI-Gemini_2.0-4285F4?style=flat-square)

---

## Why This Isn't "Just Asking an AI to Review Code"

- **Correctness = Real Execution**: Code is compiled and run via the Piston API against AI-generated test cases. Pass/fail is determined by comparing actual stdout to expected stdout — not by AI interpretation.
- **AI Receives Verified Data**: The Gemini "second" call receives real execution results (pass/fail, stdout, stderr, timing) as input. It explains and reasons about *verified* data, not invented verdicts.
- **Deterministic Scoring**: The Evaluation Profile / scoring engine is pure deterministic math — configurable weights × verified signals. No AI decision.
- **Prior Art Acknowledged**: HackerRank, Codility, and SonarQube exist as established platforms. This project's contribution is the specific integration of AI-generated tests + real multi-language execution + configurable evaluation profiles.

---

## Pipeline Diagram

```
User writes code
       │
       ▼
┌──────────────┐     ┌───────────────┐
│   Dry Run    │────▶│  Piston API   │  ← Compile/runtime check
│  (Piston)    │     │  (no stdin)   │
└──────┬───────┘     └───────────────┘
       │ pass?
       │
  ┌────┴────┐
  │  FAIL   │──▶ Show error inline (gutter marker) ──▶ STOP
  └─────────┘
       │
       ▼ PASS
┌──────────────┐     ┌───────────────┐
│ Gemini       │────▶│ AI generates  │
│ "first" call │     │ 4-8 test cases│
└──────┬───────┘     └───────────────┘
       │
       ▼
┌──────────────┐     ┌───────────────┐
│ Execute via  │────▶│ Piston API    │  ← stdin/stdout per test case
│ Piston       │     │ (with stdin)  │
└──────┬───────┘     └───────────────┘
       │
       ▼
┌──────────────┐     ┌───────────────┐
│ Gemini       │────▶│ AI analyzes   │  ← receives REAL execution results
│ "second" call│     │ code + results│
└──────┬───────┘     └───────────────┘
       │
       ▼
┌──────────────┐     ┌───────────────┐
│ Scoring      │────▶│ Deterministic │  ← profile weights × signal scores
│ Engine       │     │ final score   │
└──────────────┘     └───────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python + FastAPI (async) |
| Database | SQLite via SQLAlchemy (async) |
| Frontend | Vanilla HTML/CSS/JS + Tailwind CSS (CDN) |
| Code Editor | Monaco Editor (AMD loader via CDN) |
| Charts | Chart.js |
| Code Execution | Piston API |
| AI | Gemini 2.0 Flash |
| PDF Export | reportlab |

---

## Setup Instructions

### Prerequisites
- Python 3.10+
- A Gemini API key ([get one here](https://makersuite.google.com/app/apikey))

### Installation

```bash
# 1. Clone the repository
cd codescore-ai

# 2. Install Python dependencies
cd backend
pip install -r requirements.txt

# 3. Configure environment variables
# Edit backend/.env and set your GEMINI_API_KEY
```

### Running

```bash
# From the backend/ directory:
uvicorn main:app --reload --port 8000
```

Open http://localhost:8000 in your browser.

API documentation: http://localhost:8000/docs (Swagger UI)

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `GEMINI_API_KEY` | (required) | Google Gemini API key |
| `PISTON_URL` | `https://emkc.org/api/v2/piston/execute` | Piston API endpoint |
| `DATABASE_URL` | `sqlite+aiosqlite:///./codescore.db` | Database connection string |

---

## API Documentation

### Problems
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/problems` | Create a new problem |
| `GET` | `/api/problems` | List all problems |
| `GET` | `/api/problems/{id}` | Get problem by ID |
| `GET` | `/api/problems/{id}/leaderboard` | Get leaderboard for a problem |
| `GET` | `/api/problems/{id}/export` | Export leaderboard as PDF |

### Sessions
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/sessions?problem_id=N` | Create a new session |
| `POST` | `/api/sessions/{id}/dry-run` | Fast compile/runtime dry check via Piston |
| `POST` | `/api/sessions/{id}/submit` | Submit code for full evaluation pipeline |
| `GET` | `/api/sessions/{id}` | Get full session details |
| `GET` | `/api/sessions` | List all sessions |
| `GET` | `/api/sessions/{id}/export` | Export session report as PDF |

### Direct Evaluation (API-Only Integration)
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/evaluation` | Direct synchronous evaluation path for external CLI / CI integration |

### Evaluation Profiles
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/evaluation-profiles` | List all profiles |
| `POST` | `/api/evaluation-profiles` | Create custom profile |
| `GET` | `/api/evaluation-profiles/{id}` | Get profile by ID |

---

## Evaluation Profiles

Three default profiles ship with the app:

| Profile | Correctness | Performance | Optimization | Quality | Readability | Documentation |
|---|---|---|---|---|---|---|
| **College Default** | 50% | 20% | 15% | 10% | 0% | 5% |
| **Contest Mode** | 70% | 10% | 0% | 0% | 20% | 0% |
| **Interview Strict** | 40% | 20% | 20% | 10% | 0% | 10% |

Users can create custom profiles via the slider UI — weights must sum to 100%.

---

## Scoring Engine

The scoring formula is **deterministic and transparent**:

```
Final Score = Σ (signal_score × profile_weight) for each of 6 dimensions
```

| Signal | Source | How It's Computed |
|---|---|---|
| Correctness (0-100) | Real execution | `tests_passed / tests_total × 100` |
| Performance (0-100) | Code structure | `COMPLEXITY_SCORE_MAP[time_complexity]` |
| Optimization (0-100) | AI signal | 100 if optimal, 60 if not |
| Quality (0-100) | AI analysis | Direct AI rating |
| Readability (0-100) | AI analysis | Direct AI rating |
| Documentation (0-100) | AI analysis | Direct AI rating |

The `COMPLEXITY_SCORE_MAP` is a transparent config:

```python
COMPLEXITY_SCORE_MAP = {
    "O(1)": 100, "O(log n)": 95, "O(n)": 90, "O(n log n)": 80,
    "O(n^2)": 60, "O(n^3)": 40, "O(2^n)": 15, "O(n!)": 5,
}
```

---

## Known Limitations

- **Piston API timing is approximate**: Wall-clock round-trip, not precise CPU benchmarking. No memory metrics without self-hosting.
- **AI-generated test cases may miss edge cases**: For ambiguous problem statements, the AI may not cover all scenarios.
- **`optimization_score` is simplified**: Uses a binary optimal/non-optimal signal in v1 rather than a graded scale.
- **Evaluation Profile weights are user-configured**: Not empirically calibrated against real hiring/grading outcomes.
- **No plagiarism/AI-authorship detection**: The system does not check whether code was written by a human or AI.
- **Public Piston API rate limit**: ~5 req/sec. Self-hosting Piston is recommended for production use.

---

## Future Roadmap

- **Empirical complexity measurement**: Replace structural-analysis-only complexity detection with measured curve-fitting (multi-size execution)
- **Self-hosted Piston**: Docker deployment for precise timing, memory metrics, and no rate limits
- **Plagiarism detection**: Code similarity analysis across submissions
- **Profile-specific performance scoring**: Allow different complexity score maps per evaluation profile
- **Graded optimization score**: Replace binary optimal/non-optimal with a gap-to-optimal scale

---

## Project Structure

```
codescore-ai/
├── backend/
│   ├── main.py                 # FastAPI app entry point
│   ├── models.py               # SQLAlchemy ORM models (7 tables)
│   ├── database.py             # Async SQLite engine + session factory
│   ├── schemas.py              # Pydantic request/response schemas
│   ├── seed_data.py            # Default profiles + sample problems
│   ├── requirements.txt
│   ├── .env                    # Environment variables
│   ├── routers/
│   │   ├── problems.py         # Problem CRUD + leaderboard + PDF export
│   │   ├── sessions.py         # Session management + submit pipeline
│   │   └── evaluation_profiles.py  # Profile CRUD
│   ├── pipeline/
│   │   ├── piston_client.py    # Piston API client (dry-run + test execution)
│   │   ├── error_parser.py     # Language-specific error line extraction
│   │   ├── gemini_first.py     # AI test case generation
│   │   ├── gemini_second.py    # AI code analysis with execution results
│   │   ├── history_compressor.py  # Multi-turn context compression
│   │   └── orchestrator.py     # Full pipeline orchestrator
│   └── scoring_engine/
│       └── scorer.py           # Deterministic scoring logic
├── frontend/
│   ├── index.html              # VS Code-style 3-panel layout
│   ├── styles.css              # Dark theme CSS + animations
│   └── js/
│       ├── app.js              # Main app controller
│       ├── monaco-setup.js     # Monaco Editor initialization
│       ├── session-view.js     # Chat panel + submit flow + polling
│       ├── new-session-modal.js  # New Session creation modal
│       ├── evaluation-profile-ui.js  # Slider UI for custom profiles
│       ├── leaderboard.js      # Leaderboard table view
│       ├── charts.js           # Chart.js wrappers
│       └── api-client.js       # Fetch wrapper for all API calls
└── README.md
```

---

*Built as a demonstration of AI-augmented software evaluation — where real execution provides the ground truth and AI provides the analysis layer.*
#   v e r d i c t  
 