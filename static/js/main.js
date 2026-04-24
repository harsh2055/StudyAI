/**
 * PDF Study Assistant v2 — main.js
 * ====================================
 * Phase 1 (kept): file upload, summarize, questions, ask
 * Phase 2 (new) : multi-PDF, difficulty levels, voice (mic + TTS), notes CRUD
 */

// ═══════════════════════════════════════════════════════════════
// ELEMENT REFERENCES
// ═══════════════════════════════════════════════════════════════

// Upload card
const dropZone    = document.getElementById("drop-zone");
const pdfInput    = document.getElementById("pdf-input");
const uploadBtn   = document.getElementById("upload-btn");
const fileListEl  = document.getElementById("file-list");
const modeSingle  = document.getElementById("mode-single");
const modeMulti   = document.getElementById("mode-multi");

// Tools card
const toolsCard   = document.getElementById("tools-card");
const summarizeBtn= document.getElementById("summarize-btn");
const questionsBtn= document.getElementById("questions-btn");
const diffBtns    = document.querySelectorAll(".diff-btn");

// Ask / voice
const questionInput = document.getElementById("question-input");
const askBtn        = document.getElementById("ask-btn");
const micBtn        = document.getElementById("mic-btn");
const micStatus     = document.getElementById("mic-status");

// Result card
const resultCard    = document.getElementById("result-card");
const resultTitle   = document.getElementById("result-title");
const resultContent = document.getElementById("result-content");
const loadingState  = document.getElementById("loading-state");
const loadingMsg    = document.getElementById("loading-msg");
const copyBtn       = document.getElementById("copy-btn");
const speakBtn      = document.getElementById("speak-btn");
const stopBtn       = document.getElementById("stop-btn");
const saveNoteBtn   = document.getElementById("save-note-btn");

// Save-note modal
const saveModal      = document.getElementById("save-modal");
const noteTitleInput = document.getElementById("note-title");
const noteSubjectInput = document.getElementById("note-subject");
const confirmSaveBtn = document.getElementById("confirm-save-btn");
const cancelSaveBtn  = document.getElementById("cancel-save-btn");

// Notes tab
const tabBtns        = document.querySelectorAll(".tab-btn");
const tabStudy       = document.getElementById("tab-study");
const tabNotes       = document.getElementById("tab-notes");
const subjectFilter  = document.getElementById("subject-filter");
const refreshNotesBtn= document.getElementById("refresh-notes-btn");
const notesList      = document.getElementById("notes-list");


// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

let combinedText   = "";          // All PDF text merged together
let uploadedFiles  = [];          // [{ filename, text, word_count }]
let isMultiMode    = false;       // Single vs multi-PDF mode
let selectedDifficulty = "medium";
let currentAudio   = null;        // Audio element for TTS playback
let mediaRecorder  = null;        // For microphone recording
let audioChunks    = [];
let lastResultType = "answer";    // 'summary' | 'questions' | 'answer'


// ═══════════════════════════════════════════════════════════════
// TOAST HELPER
// ═══════════════════════════════════════════════════════════════

function showToast(message, type = "info") {
  const old = document.querySelector(".toast");
  if (old) old.remove();

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;   // type: 'info' | 'error' | 'success'
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}


// ═══════════════════════════════════════════════════════════════
// TAB NAVIGATION
// ═══════════════════════════════════════════════════════════════

tabBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    tabBtns.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    const tab = btn.dataset.tab;
    tabStudy.hidden = (tab !== "study");
    tabNotes.hidden = (tab !== "notes");

    // Auto-refresh notes when switching to notes tab
    if (tab === "notes") loadNotes();
  });
});


// ═══════════════════════════════════════════════════════════════
// SINGLE / MULTI MODE TOGGLE
// ═══════════════════════════════════════════════════════════════

modeSingle.addEventListener("click", () => {
  isMultiMode = false;
  modeSingle.classList.add("active");
  modeMulti.classList.remove("active");
  pdfInput.removeAttribute("multiple");
  resetUploadState();
});

modeMulti.addEventListener("click", () => {
  isMultiMode = true;
  modeMulti.classList.add("active");
  modeSingle.classList.remove("active");
  pdfInput.setAttribute("multiple", "");
  resetUploadState();
});

function resetUploadState() {
  uploadedFiles = [];
  combinedText  = "";
  fileListEl.innerHTML = "";
  uploadBtn.disabled = true;
}


// ═══════════════════════════════════════════════════════════════
// FILE SELECTION  (click + drag-and-drop)
// ═══════════════════════════════════════════════════════════════

dropZone.addEventListener("click", () => pdfInput.click());

pdfInput.addEventListener("change", () => {
  if (pdfInput.files.length > 0) handleFilesSelected(Array.from(pdfInput.files));
});

dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("drag-over"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
dropZone.addEventListener("drop", e => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  const files = Array.from(e.dataTransfer.files).filter(f => f.type === "application/pdf");
  if (files.length === 0) { showToast("Please drop PDF files.", "error"); return; }
  handleFilesSelected(files);
});

/**
 * When the user selects file(s), show them in the file-list UI and enable the upload button.
 */
function handleFilesSelected(files) {
  // In single mode only keep the last file
  const list = isMultiMode ? files : [files[files.length - 1]];

  fileListEl.innerHTML = "";
  list.forEach(file => {
    const item = document.createElement("div");
    item.className = "file-item";
    item.innerHTML = `
      <span>📄</span>
      <span class="file-name">${file.name}</span>
      <span class="file-wc">pending</span>
      <button class="file-remove" title="Remove">✕</button>
    `;
    item.querySelector(".file-remove").addEventListener("click", () => {
      item.remove();
      // Disable upload if no files left
      if (fileListEl.children.length === 0) uploadBtn.disabled = true;
    });
    fileListEl.appendChild(item);
  });

  // Store files on the input element for the upload handler
  const dt = new DataTransfer();
  list.forEach(f => dt.items.add(f));
  pdfInput.files = dt.files;

  uploadBtn.disabled = false;
}


// ═══════════════════════════════════════════════════════════════
// UPLOAD  (single or multi)
// ═══════════════════════════════════════════════════════════════

uploadBtn.addEventListener("click", async () => {
  if (!pdfInput.files.length) return;

  const btnText   = uploadBtn.querySelector(".btn-text");
  const btnLoader = uploadBtn.querySelector(".btn-loader");
  uploadBtn.disabled = true;
  btnText.hidden = true;
  btnLoader.hidden = false;

  try {
    if (isMultiMode) {
      await uploadMulti();
    } else {
      await uploadSingle(pdfInput.files[0]);
    }

    // Show the tools section
    toolsCard.hidden = false;
    toolsCard.scrollIntoView({ behavior: "smooth", block: "start" });
    showToast(`✓ Ready! ${uploadedFiles.length} PDF(s) loaded.`, "success");

  } catch (err) {
    showToast(err.message, "error");
  } finally {
    uploadBtn.disabled = false;
    btnText.hidden = false;
    btnLoader.hidden = true;
  }
});

/**
 * Upload one PDF to /upload (Phase 1 endpoint — unchanged).
 */
async function uploadSingle(file) {
  const formData = new FormData();
  formData.append("pdf", file);

  const res  = await fetch("/upload", { method: "POST", body: formData });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Upload failed.");

  uploadedFiles = [{ filename: data.filename, text: data.text, word_count: data.word_count }];
  combinedText  = data.text;

  // Update the word count badge in the UI
  updateFileItemWordCount(data.filename, data.word_count);
}

/**
 * Upload multiple PDFs to /upload_multi (Phase 2 endpoint).
 */
async function uploadMulti() {
  const formData = new FormData();
  Array.from(pdfInput.files).forEach(f => formData.append("pdfs", f));

  const res  = await fetch("/upload_multi", { method: "POST", body: formData });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Upload failed.");

  uploadedFiles = data.files;
  // Combine all texts with a clear separator so the AI knows which doc is which
  combinedText  = data.files
    .map(f => `=== ${f.filename} ===\n${f.text}`)
    .join("\n\n");

  data.files.forEach(f => updateFileItemWordCount(f.filename, f.word_count));
  if (data.warnings.length) showToast(data.warnings.join(" | "), "error");
}

/** Update the word-count badge in a file-list item. */
function updateFileItemWordCount(filename, wordCount) {
  const items = fileListEl.querySelectorAll(".file-item");
  items.forEach(item => {
    if (item.querySelector(".file-name").textContent === filename) {
      item.querySelector(".file-wc").textContent = `${wordCount.toLocaleString()} words`;
    }
  });
}


// ═══════════════════════════════════════════════════════════════
// DIFFICULTY SELECTOR
// ═══════════════════════════════════════════════════════════════

diffBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    diffBtns.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    selectedDifficulty = btn.dataset.level;
    showToast(`Difficulty set to ${btn.dataset.level}`, "info");
  });
});


// ═══════════════════════════════════════════════════════════════
// GENERIC AI CALL
// ═══════════════════════════════════════════════════════════════

/**
 * Sends a request to any AI endpoint and renders the response.
 * @param {string} endpoint    - '/summarize' | '/questions' | '/ask'
 * @param {object} body        - JSON body (text, question, difficulty, …)
 * @param {string} title       - Title shown above the result
 * @param {string} loadingText - Shown while waiting
 * @param {string} type        - 'summary' | 'questions' | 'answer'  (for saving)
 */
async function callAI(endpoint, body, title, loadingText, type = "answer") {
  lastResultType = type;

  resultCard.hidden = false;
  resultTitle.textContent = title;
  resultContent.textContent = "";
  loadingMsg.textContent = loadingText;
  loadingState.hidden = false;
  resultCard.scrollIntoView({ behavior: "smooth", block: "start" });

  try {
    const res  = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    resultContent.textContent = data.result;
  } catch (err) {
    resultContent.textContent = "Error: " + err.message;
    showToast(err.message, "error");
  } finally {
    loadingState.hidden = true;
  }
}

// Summarize
summarizeBtn.addEventListener("click", () => {
  if (!combinedText) return;
  callAI(
    "/summarize",
    { text: combinedText, difficulty: selectedDifficulty },
    `📝 Summary (${selectedDifficulty})`,
    "Summarising your document(s)…",
    "summary"
  );
});

// Exam questions
questionsBtn.addEventListener("click", () => {
  if (!combinedText) return;
  callAI(
    "/questions",
    { text: combinedText, difficulty: selectedDifficulty },
    `❓ Exam Questions (${selectedDifficulty})`,
    "Generating questions…",
    "questions"
  );
});

// Ask a question
function handleAsk() {
  const question = questionInput.value.trim();
  if (!question) { showToast("Please type or speak a question.", "error"); return; }
  if (!combinedText) { showToast("Upload a PDF first.", "error"); return; }

  callAI(
    "/ask",
    { text: combinedText, question, difficulty: selectedDifficulty },
    `💬 "${question}"`,
    "Finding the answer…",
    "answer"
  );
}
askBtn.addEventListener("click", handleAsk);
questionInput.addEventListener("keydown", e => { if (e.key === "Enter") handleAsk(); });


// ═══════════════════════════════════════════════════════════════
// COPY TO CLIPBOARD
// ═══════════════════════════════════════════════════════════════

copyBtn.addEventListener("click", () => {
  if (!resultContent.textContent) return;
  navigator.clipboard.writeText(resultContent.textContent).then(() => {
    copyBtn.textContent = "✓ Copied!";
    copyBtn.classList.add("copied");
    setTimeout(() => { copyBtn.textContent = "⧉ Copy"; copyBtn.classList.remove("copied"); }, 2000);
  });
});


// ═══════════════════════════════════════════════════════════════
// VOICE — SPEECH-TO-TEXT  (microphone → Whisper → question input)
// ═══════════════════════════════════════════════════════════════

micBtn.addEventListener("click", async () => {
  // If already recording → stop
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    return;
  }

  // Request microphone permission
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    showToast("Microphone access denied.", "error");
    return;
  }

  audioChunks = [];
  mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

  mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };

  mediaRecorder.onstart = () => {
    micBtn.classList.add("recording");
    micBtn.textContent = "⏹";
    micStatus.textContent = "🔴 Listening… click again to stop";
  };

  mediaRecorder.onstop = async () => {
    // Stop microphone tracks
    stream.getTracks().forEach(t => t.stop());
    micBtn.classList.remove("recording");
    micBtn.textContent = "🎤";
    micStatus.textContent = "⏳ Transcribing…";

    const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
    const formData  = new FormData();
    formData.append("audio", audioBlob, "recording.webm");

    try {
      const res  = await fetch("/transcribe", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      questionInput.value = data.text;
      micStatus.textContent = `✓ "${data.text}"`;
    } catch (err) {
      micStatus.textContent = "";
      showToast("Transcription failed: " + err.message, "error");
    }
  };

  mediaRecorder.start();
});


// ═══════════════════════════════════════════════════════════════
// VOICE — TEXT-TO-SPEECH  (result → OpenAI TTS → plays in browser)
// ═══════════════════════════════════════════════════════════════

speakBtn.addEventListener("click", async () => {
  const text = resultContent.textContent.trim();
  if (!text) return;

  speakBtn.hidden = true;
  stopBtn.hidden  = false;
  speakBtn.textContent = "🔊";

  try {
    const res = await fetch("/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error("TTS failed.");

    const audioBlob = await res.blob();
    const audioUrl  = URL.createObjectURL(audioBlob);

    currentAudio = new Audio(audioUrl);
    currentAudio.play();

    currentAudio.onended = () => {
      speakBtn.hidden = false;
      stopBtn.hidden  = true;
      URL.revokeObjectURL(audioUrl);
    };
  } catch (err) {
    showToast(err.message, "error");
    speakBtn.hidden = false;
    stopBtn.hidden  = true;
  }
});

stopBtn.addEventListener("click", () => {
  if (currentAudio) { currentAudio.pause(); currentAudio.currentTime = 0; }
  speakBtn.hidden = false;
  stopBtn.hidden  = true;
});


// ═══════════════════════════════════════════════════════════════
// NOTES — SAVE (modal flow)
// ═══════════════════════════════════════════════════════════════

saveNoteBtn.addEventListener("click", () => {
  // Pre-fill the title with the result card title
  noteTitleInput.value   = resultTitle.textContent.replace(/^[^a-zA-Z]+/, "").trim();
  noteSubjectInput.value = "";
  saveModal.hidden = false;
});

cancelSaveBtn.addEventListener("click", () => { saveModal.hidden = true; });

confirmSaveBtn.addEventListener("click", async () => {
  const title   = noteTitleInput.value.trim();
  const subject = noteSubjectInput.value.trim() || "General";
  const content = resultContent.textContent.trim();

  if (!title) { showToast("Please enter a title.", "error"); return; }
  if (!content) { showToast("Nothing to save.", "error"); return; }

  try {
    const res  = await fetch("/notes/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        subject,
        type:       lastResultType,
        content,
        source_pdf: uploadedFiles.map(f => f.filename).join(", "),
        difficulty: selectedDifficulty,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    saveModal.hidden = true;
    showToast("✓ Note saved!", "success");
  } catch (err) {
    showToast(err.message, "error");
  }
});

// Close modal on overlay click
saveModal.addEventListener("click", e => {
  if (e.target === saveModal) saveModal.hidden = true;
});


// ═══════════════════════════════════════════════════════════════
// NOTES — LIST & FILTER
// ═══════════════════════════════════════════════════════════════

async function loadNotes() {
  const subject = subjectFilter.value;
  const url     = subject ? `/notes/list?subject=${encodeURIComponent(subject)}` : "/notes/list";

  try {
    const res  = await fetch(url);
    const data = await res.json();
    renderNotes(data.notes);
  } catch {
    showToast("Could not load notes.", "error");
  }

  // Also refresh subject dropdown
  try {
    const res  = await fetch("/notes/subjects");
    const data = await res.json();
    const current = subjectFilter.value;
    subjectFilter.innerHTML = '<option value="">All subjects</option>';
    data.subjects.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s; opt.textContent = s;
      if (s === current) opt.selected = true;
      subjectFilter.appendChild(opt);
    });
  } catch {}
}

function renderNotes(notes) {
  if (!notes.length) {
    notesList.innerHTML = '<p class="empty-state">No notes found.</p>';
    return;
  }

  notesList.innerHTML = "";

  notes.forEach(note => {
    const card = document.createElement("div");
    card.className = "note-card";
    card.dataset.id = note.id;

    const badgeClass = { summary: "badge-summary", questions: "badge-questions", answer: "badge-answer" }[note.type] || "badge-answer";

    card.innerHTML = `
      <div class="note-card-header">
        <span class="note-card-title">${escHtml(note.title)}</span>
      </div>
      <div class="note-card-meta">
        <span class="note-badge ${badgeClass}">${note.type}</span>
        <span class="note-badge" style="color:var(--text-muted);border-color:var(--border)">${escHtml(note.subject)}</span>
        <span class="note-diff">· ${note.difficulty}</span>
        <span class="note-date">${note.created_at}</span>
      </div>
      <div class="note-preview">${escHtml(note.content)}</div>
      <div class="note-card-footer">
        <button class="note-expand-btn">Expand</button>
        <button class="note-delete-btn">Delete</button>
      </div>
    `;

    // Expand / collapse
    card.querySelector(".note-expand-btn").addEventListener("click", function() {
      card.classList.toggle("expanded");
      this.textContent = card.classList.contains("expanded") ? "Collapse" : "Expand";
    });

    // Delete
    card.querySelector(".note-delete-btn").addEventListener("click", async () => {
      if (!confirm("Delete this note?")) return;
      try {
        await fetch(`/notes/delete/${note.id}`, { method: "DELETE" });
        card.remove();
        showToast("Note deleted.", "success");
      } catch {
        showToast("Could not delete note.", "error");
      }
    });

    notesList.appendChild(card);
  });
}

/** Escape HTML to prevent XSS in note content */
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

refreshNotesBtn.addEventListener("click", loadNotes);
subjectFilter.addEventListener("change", loadNotes);
