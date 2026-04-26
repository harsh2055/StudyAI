import os
import io

import sqlite3
import datetime

from flask import Flask, request, jsonify, render_template, send_file

from werkzeug.utils import secure_filename

import pypdf

from openai import OpenAI

from dotenv import load_dotenv



load_dotenv()   # reads OPENAI_API_KEY from .env



# ── App setup ─────────────────────────────────────────────────────────────────

app = Flask(__name__)



UPLOAD_FOLDER = "uploads"

DATA_FOLDER   = "data"

ALLOWED_EXTENSIONS = {"pdf"}



app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER

app.config["MAX_CONTENT_LENGTH"] = 32 * 1024 * 1024   # 32 MB



os.makedirs(UPLOAD_FOLDER, exist_ok=True)

os.makedirs(DATA_FOLDER,   exist_ok=True)



# ── NVIDIA NIM (OpenAI-compatible) client ─────────────────────────────────────

NVIDIA_API_KEY  = os.environ.get("NVIDIA_API_KEY", "")

NVIDIA_BASE_URL = os.environ.get("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1")

NVIDIA_MODEL    = os.environ.get("NVIDIA_MODEL",    "openai/gpt-oss-20b")



nvidia_client = OpenAI(

    api_key=NVIDIA_API_KEY,

    base_url=NVIDIA_BASE_URL,

)



# Standard OpenAI client for Voice & TTS features

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")

openai_client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None

DB_PATH = os.path.join(DATA_FOLDER, "notes.db")





# ══════════════════════════════════════════════════════════════════════════════

# DATABASE — SQLite helpers

# ══════════════════════════════════════════════════════════════════════════════



def get_db():

    """Open (or create) the SQLite database and return a connection."""

    conn = sqlite3.connect(DB_PATH)

    conn.row_factory = sqlite3.Row

    return conn





def init_db():

    """Create the notes table if it doesn't already exist. Called once at startup."""

    with get_db() as conn:

        conn.execute("""

            CREATE TABLE IF NOT EXISTS notes (

                id         INTEGER PRIMARY KEY AUTOINCREMENT,

                title      TEXT    NOT NULL,

                subject    TEXT    DEFAULT 'General',

                type       TEXT    NOT NULL,

                content    TEXT    NOT NULL,

                source_pdf TEXT    DEFAULT '',

                difficulty TEXT    DEFAULT 'medium',

                created_at TEXT    NOT NULL

            )

        """)

        conn.commit()



init_db()





# ══════════════════════════════════════════════════════════════════════════════

# SHARED HELPERS

# ══════════════════════════════════════════════════════════════════════════════



def allowed_file(filename):

    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS





def extract_text_from_pdf(filepath):

    """Read all text from a PDF file, page by page."""

    text = ""

    with open(filepath, "rb") as f:

        reader = pypdf.PdfReader(f)

        for page in reader.pages:

            page_text = page.extract_text()

            if page_text:

                text += page_text + "\n"

    return text.strip()





def truncate_text(text, max_chars=12000):

    """Cap text length so we stay inside GPT's token budget."""

    if len(text) > max_chars:

        return text[:max_chars] + "\n\n[... text truncated ...]"

    return text





def ask_openai(system_prompt, user_content, max_tokens=1500):

    """Call NVIDIA NIM API and return the reply as a string."""

    response = nvidia_client.chat.completions.create(

        model=NVIDIA_MODEL,

        messages=[

            {"role": "system", "content": system_prompt},

            {"role": "user",   "content": user_content},

        ],

        max_tokens=max_tokens,

        temperature=0.7,

    )

    return response.choices[0].message.content.strip()





def difficulty_instructions(level):

    """

    Returns an instruction string that steers GPT to the right depth.

    level: 'easy' | 'medium' | 'hard'

    """

    instructions = {

        "easy": (

            "Use very simple language suitable for a beginner or school student. "

            "Avoid jargon. Use short sentences and relatable everyday analogies."

        ),

        "medium": (

            "Use clear language suitable for an undergraduate student. "

            "Balance simplicity with accuracy."

        ),

        "hard": (

            "Use precise, technical language suitable for an expert or postgraduate. "

            "Include nuance, edge cases, and advanced insights."

        ),

    }

    return instructions.get(level, instructions["medium"])





# ══════════════════════════════════════════════════════════════════════════════

# ROUTES — Pages

# ══════════════════════════════════════════════════════════════════════════════



@app.route("/")

def index():

    return render_template("index.html")





# ══════════════════════════════════════════════════════════════════════════════

# ROUTES — PDF Upload

# ══════════════════════════════════════════════════════════════════════════════



@app.route("/upload", methods=["POST"])

def upload_pdf():

    """Single-PDF upload (Phase 1 — unchanged API)."""

    if "pdf" not in request.files:

        return jsonify({"error": "No file part in the request."}), 400

    file = request.files["pdf"]

    if file.filename == "" or not allowed_file(file.filename):

        return jsonify({"error": "Please upload a valid PDF file."}), 400



    filename = secure_filename(file.filename)

    filepath = os.path.join(app.config["UPLOAD_FOLDER"], filename)

    file.save(filepath)



    text = extract_text_from_pdf(filepath)

    if not text:

        return jsonify({"error": "Could not extract text. The PDF may be image-only."}), 400



    return jsonify({

        "message":    "PDF uploaded successfully!",

        "text":       text,

        "word_count": len(text.split()),

        "filename":   filename,

    })





@app.route("/upload_multi", methods=["POST"])

def upload_multi():

    """

    NEW (Phase 2) — Accept multiple PDFs.

    Form field name must be 'pdfs' (multiple files).

    Returns a list of { filename, text, word_count } objects.

    """

    files = request.files.getlist("pdfs")

    if not files or all(f.filename == "" for f in files):

        return jsonify({"error": "No files received."}), 400



    results = []

    warnings = []



    for file in files:

        if not allowed_file(file.filename):

            warnings.append(f"{file.filename} — not a PDF, skipped.")

            continue



        filename = secure_filename(file.filename)

        filepath = os.path.join(app.config["UPLOAD_FOLDER"], filename)

        file.save(filepath)



        text = extract_text_from_pdf(filepath)

        if not text:

            warnings.append(f"{filename} — no extractable text, skipped.")

            continue



        results.append({

            "filename":   filename,

            "text":       text,

            "word_count": len(text.split()),

        })



    if not results:

        return jsonify({"error": "None of the files could be processed.", "details": warnings}), 400



    return jsonify({"files": results, "warnings": warnings})





# ══════════════════════════════════════════════════════════════════════════════

# ROUTES — AI Features

# ══════════════════════════════════════════════════════════════════════════════



@app.route("/summarize", methods=["POST"])

def summarize():

    """

    Summarize PDF text.

    Body: { text, difficulty? }

    """

    data = request.get_json()

    if not data or "text" not in data:

        return jsonify({"error": "No text provided."}), 400



    pdf_text   = truncate_text(data["text"])

    difficulty = data.get("difficulty", "medium").lower()



    system_prompt = (

        "You are a helpful study assistant who creates clear, structured summaries. "

        + difficulty_instructions(difficulty)

    )

    user_content = (

        "Summarize the following document using bullet points and short paragraphs. "

        "Highlight the most important concepts.\n\n"

        f"DOCUMENT:\n{pdf_text}"

    )



    return jsonify({"result": ask_openai(system_prompt, user_content)})





@app.route("/questions", methods=["POST"])

def generate_questions():

    """

    Generate exam questions.

    Body: { text, difficulty? }

    """

    data = request.get_json()

    if not data or "text" not in data:

        return jsonify({"error": "No text provided."}), 400



    pdf_text   = truncate_text(data["text"])

    difficulty = data.get("difficulty", "medium").lower()



    depth_map = {

        "easy":   "basic recall and simple understanding",

        "medium": "a mix of short-answer, conceptual, and analytical",

        "hard":   "critical thinking, deep analysis, and synthesis",

    }



    system_prompt = (

        "You are an experienced teacher and exam setter. "

        + difficulty_instructions(difficulty)

    )

    user_content = (

        f"Generate 10 exam questions focusing on {depth_map.get(difficulty, depth_map['medium'])}. "

        "Number each question. Then add a 'Key Topics to Study' section with 5 bullet points.\n\n"

        f"DOCUMENT:\n{pdf_text}"

    )



    return jsonify({"result": ask_openai(system_prompt, user_content)})





@app.route("/ask", methods=["POST"])

def ask_question():

    """

    Answer a specific question about the PDF text.

    Body: { text, question, difficulty? }

    """

    data = request.get_json()

    if not data or "text" not in data or "question" not in data:

        return jsonify({"error": "Both 'text' and 'question' are required."}), 400



    pdf_text   = truncate_text(data["text"])

    question   = data["question"].strip()

    difficulty = data.get("difficulty", "medium").lower()



    if not question:

        return jsonify({"error": "Question cannot be empty."}), 400



    system_prompt = (

        "You are a knowledgeable study assistant. Answer based only on the provided document. "

        "If the answer isn't there, say so clearly. "

        + difficulty_instructions(difficulty)

    )

    user_content = (

        f"QUESTION: {question}\n\n"

        f"DOCUMENT:\n{pdf_text}"

    )



    return jsonify({"result": ask_openai(system_prompt, user_content)})





# ══════════════════════════════════════════════════════════════════════════════

# ROUTES — Voice (Phase 2)

# ══════════════════════════════════════════════════════════════════════════════



@app.route("/transcribe", methods=["POST"])

def transcribe_audio():

    """

    NEW (Phase 2) — Speech-to-Text via OpenAI Whisper.



    How it works:

      1. Browser records audio with MediaRecorder (WebM format)

      2. POSTs the audio blob to this endpoint

      3. We wrap it in a BytesIO buffer (Whisper needs a file-like object)

      4. Whisper returns the transcribed text

      5. We send that text back — the frontend puts it in the question input

    """

    if not openai_client:

        return jsonify({"error": "OpenAI API key missing. Voice features require OPENAI_API_KEY in .env"}), 500



    if "audio" not in request.files:

        return jsonify({"error": "No audio file received."}), 400



    audio_bytes  = request.files["audio"].read()

    audio_buffer = io.BytesIO(audio_bytes)

    audio_buffer.name = "recording.webm"   # extension tells Whisper the format



    try:

        transcript = openai_client.audio.transcriptions.create(

            model="whisper-1",

            file=audio_buffer,

        )

        return jsonify({"text": transcript.text})

    except Exception as e:

        return jsonify({"error": f"Transcription failed: {str(e)}"}), 500





@app.route("/tts", methods=["POST"])

def text_to_speech():

    """

    NEW (Phase 2) — Text-to-Speech via OpenAI TTS.



    How it works:

      1. Frontend sends { text: "..." }

      2. OpenAI TTS converts it to MP3 audio bytes

      3. We stream those bytes back as an audio/mpeg response

      4. Browser creates an Audio object and plays it

    """

    if not openai_client:

        return jsonify({"error": "OpenAI API key missing. Voice features require OPENAI_API_KEY in .env"}), 500



    data = request.get_json()

    if not data or not data.get("text", "").strip():

        return jsonify({"error": "No text provided."}), 400



    text = data["text"].strip()[:3000]   # cap to keep costs reasonable



    try:

        response = openai_client.audio.speech.create(

            model="tts-1",

            voice="nova",       # alloy | echo | fable | onyx | nova | shimmer

            input=text,

        )

        audio_buffer = io.BytesIO()

        for chunk in response.iter_bytes():

            audio_buffer.write(chunk)

        audio_buffer.seek(0)



        return send_file(audio_buffer, mimetype="audio/mpeg", as_attachment=False)

    except Exception as e:

        return jsonify({"error": f"TTS failed: {str(e)}"}), 500





# ══════════════════════════════════════════════════════════════════════════════

# ROUTES — Notes (Phase 2)

# ══════════════════════════════════════════════════════════════════════════════



@app.route("/notes/save", methods=["POST"])

def save_note():

    """

    NEW (Phase 2) — Persist an AI result to the SQLite database.

    Body: { title, subject?, type, content, source_pdf?, difficulty? }

    """

    data = request.get_json()

    if not data or not {"title", "type", "content"}.issubset(data):

        return jsonify({"error": "title, type, and content are required."}), 400



    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")



    with get_db() as conn:

        cursor = conn.execute(

            """INSERT INTO notes (title, subject, type, content, source_pdf, difficulty, created_at)

               VALUES (?, ?, ?, ?, ?, ?, ?)""",

            (

                data["title"],

                data.get("subject", "General"),

                data["type"],

                data["content"],

                data.get("source_pdf", ""),

                data.get("difficulty", "medium"),

                now,

            ),

        )

        conn.commit()



    return jsonify({"message": "Note saved!", "id": cursor.lastrowid})





@app.route("/notes/list", methods=["GET"])

def list_notes():

    """

    NEW (Phase 2) — Return all saved notes, newest first.

    Optional: ?subject=Biology  to filter by subject.

    """

    subject = request.args.get("subject", "").strip()

    with get_db() as conn:

        if subject:

            rows = conn.execute(

                "SELECT * FROM notes WHERE subject = ? ORDER BY id DESC", (subject,)

            ).fetchall()

        else:

            rows = conn.execute("SELECT * FROM notes ORDER BY id DESC").fetchall()



    return jsonify({"notes": [dict(r) for r in rows]})





@app.route("/notes/delete/<int:note_id>", methods=["DELETE"])

def delete_note(note_id):

    """NEW (Phase 2) — Delete one note by its numeric id."""

    with get_db() as conn:

        conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))

        conn.commit()

    return jsonify({"message": f"Note {note_id} deleted."})





@app.route("/notes/subjects", methods=["GET"])

def list_subjects():

    """NEW (Phase 2) — Return distinct subject names (used to populate the filter)."""

    with get_db() as conn:

        rows = conn.execute(

            "SELECT DISTINCT subject FROM notes ORDER BY subject"

        ).fetchall()

    return jsonify({"subjects": [r["subject"] for r in rows]})





# ══════════════════════════════════════════════════════════════════════════════

# Entry point

# ══════════════════════════════════════════════════════════════════════════════



if __name__ == "__main__":

    port = int(os.environ.get("PORT", 10000))

    app.run(host="0.0.0.0", port=port)
