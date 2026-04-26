# 📚 PDF Study Assistant — v2

A full upgrade of Phase 1, adding Voice Mode, Multi-PDF support, Smart Notes, and Difficulty Levels.

## New Folder Structure

```
pdf-study-assistant/
│
├── app.py                      ← Backend (updated with all Phase 2 routes)
├── requirements.txt            ← Same dependencies — no new libraries!
├── .env / .env.example         ← OpenAI API key
│
├── data/
│   └── notes.db                ← SQLite database (auto-created on first run)
│
├── templates/
│   └── index.html              ← UI with Study tab + Notes tab
│
├── static/
│   ├── css/style.css           ← Updated styles (tabs, difficulty, voice, notes)
│   └── js/main.js              ← All new browser logic
│
└── uploads/                    ← Temp storage for uploaded PDFs
```

## What's New in Phase 2

### 1. Multi-PDF Support
- Toggle between "Single PDF" and "Multiple PDFs" mode
- In multi mode, files are sent to `/upload_multi` which processes each one
- All texts are combined with === filename === separators
- GPT gets the full combined context, so you can ask questions across all PDFs

### 2. Voice Mode
- **Mic → Text**: Click the 🎤 button to record audio. The WebM blob is sent to
  `/transcribe` which calls OpenAI Whisper. The transcribed text fills the question box.
- **Text → Audio**: Click 🔊 on any result to call `/tts`, which uses OpenAI TTS (Nova
  voice). The MP3 is streamed back and played directly in the browser.

### 3. Difficulty Levels
- Three levels: 🟢 Easy / 🟡 Medium / 🔴 Hard
- The selected level is sent with every AI request
- Backend adds level-specific instructions to the system prompt:
  - Easy → simple language, analogies, no jargon
  - Medium → balanced undergraduate level
  - Hard → expert/postgraduate depth with nuance

### 4. Smart Notes Organiser
- Click "💾 Save Note" on any AI result
- Enter a title and subject/tag (e.g. "Biology", "History")
- Stored in SQLite in data/notes.db
- Switch to the 🗂 Notes tab to see all saved notes
- Filter by subject using the dropdown
- Expand to read full content, or delete individual notes

## Setup (same as v1)

```bash
# 1. Enter the folder
cd pdf-study-assistant

# 2. Activate virtual environment
source venv/bin/activate      # Windows: venv\Scripts\activate

# 3. Install / update dependencies (no new ones needed!)
pip install -r requirements.txt

# 4. Make sure your .env file has OPENAI_API_KEY=sk-...

# 5. Run
python app.py
# → http://127.0.0.1:5000
```

## Upgrading from v1

If you already have v1 running, replace these files:
| File | Action |
|------|--------|
| app.py | Replace entirely |
| templates/index.html | Replace entirely |
| static/css/style.css | Replace entirely |
| static/js/main.js | Replace entirely |
| requirements.txt | Replace (no new installs needed) |

New additions:
- data/ folder — created automatically on startup
- data/notes.db — SQLite database, created automatically

## New API Endpoints

| Method | Route | Purpose |
|--------|-------|---------|
| POST | /upload_multi | Upload 1-N PDFs at once |
| POST | /transcribe | Audio blob → text (Whisper) |
| POST | /tts | Text → MP3 audio (TTS) |
| POST | /notes/save | Save a note to SQLite |
| GET  | /notes/list | Get all notes (optional ?subject= filter) |
| DELETE | /notes/delete/<id> | Delete one note |
| GET  | /notes/subjects | List all distinct subjects |

## Notes Storage — SQLite vs alternatives

SQLite is perfect for this project:
- Zero config, zero server — it's just a file (data/notes.db)
- Built into Python — no extra install
- Survives server restarts (unlike in-memory storage)

When to consider upgrading:
- PostgreSQL / MySQL → when you add user accounts or need concurrent multi-user access
- Redis → if you want fast in-memory caching of PDF texts between requests
- Cloud storage (S3 + RDS) → when deploying publicly at scale

