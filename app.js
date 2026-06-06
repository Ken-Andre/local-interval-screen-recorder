const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const els = {
  secureStatus: $("#secureStatus"),
  modeSnapshot: $("#modeSnapshot"),
  modeClip: $("#modeClip"),
  intervalSec: $("#intervalSec"),
  clipSec: $("#clipSec"),
  continuousClips: $("#continuousClips"),
  maxWidth: $("#maxWidth"),
  quality: $("#quality"),
  qualityOut: $("#qualityOut"),
  bitrate: $("#bitrate"),
  maxFiles: $("#maxFiles"),
  maxMb: $("#maxMb"),
  captureImmediately: $("#captureImmediately"),
  chooseFolderBtn: $("#chooseFolderBtn"),
  destinationLabel: $("#destinationLabel"),
  destinationHelp: $("#destinationHelp"),
  startBtn: $("#startBtn"),
  captureNowBtn: $("#captureNowBtn"),
  pauseBtn: $("#pauseBtn"),
  stopBtn: $("#stopBtn"),
  runStatus: $("#runStatus"),
  nextStatus: $("#nextStatus"),
  progressBar: $("#progressBar"),
  preview: $("#preview"),
  previewEmpty: $("#previewEmpty"),
  previewShell: $(".preview-shell"),
  hidePreviewBtn: $("#hidePreviewBtn"),
  notes: $("#notes"),
  insertTemplateBtn: $("#insertTemplateBtn"),
  exportNotesBtn: $("#exportNotesBtn"),
  retentionSummary: $("#retentionSummary"),
  clearLogBtn: $("#clearLogBtn"),
  captureRows: $("#captureRows"),
};

const STORAGE_KEY = "interval-recorder-settings-v1";
const NOTES_KEY = "interval-recorder-notes-v1";
const DB_NAME = "interval-recorder-db";
const DB_VERSION = 1;
const HANDLE_KEY = "capture-directory";


const state = {
  mode: "snapshot",
  isRunning: false,
  isPaused: false,
  stream: null,
  loopAbort: null,
  frameReader: null,
  currentRecorder: null,
  dirHandle: null,
  captures: [],
  previewHidden: false,
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    for (const [key, value] of Object.entries(saved)) {
      if (els[key] && "value" in els[key]) els[key].value = value;
      if (els[key] && "checked" in els[key]) els[key].checked = Boolean(value);
    }
    if (saved.mode === "clip") setMode("clip");
  } catch {
    // Ignore corrupt local settings.
  }

  els.notes.value = localStorage.getItem(NOTES_KEY) || "";
}

function saveSettings() {
  const settings = {
    mode: state.mode,
    intervalSec: els.intervalSec.value,
    clipSec: els.clipSec.value,
    continuousClips: els.continuousClips.checked,
    maxWidth: els.maxWidth.value,
    quality: els.quality.value,
    bitrate: els.bitrate.value,
    maxFiles: els.maxFiles.value,
    maxMb: els.maxMb.value,
    captureImmediately: els.captureImmediately.checked,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function setMode(mode) {
  state.mode = mode;
  document.body.classList.toggle("clip-mode", mode === "clip");
  document.body.classList.toggle("snapshot-mode", mode === "snapshot");
  els.modeSnapshot.classList.toggle("is-active", mode === "snapshot");
  els.modeClip.classList.toggle("is-active", mode === "clip");
  saveSettings();
}

function isSupported() {
  return Boolean(navigator.mediaDevices?.getDisplayMedia);
}

function isContinuousClipMode() {
  return state.mode === "clip" && els.continuousClips.checked;
}

function checkRuntime() {
  if (!window.isSecureContext) {
    els.secureStatus.textContent = "Contexte non securise";
    els.secureStatus.classList.add("is-bad");
    els.runStatus.textContent = "Ouvre l'app via http://localhost pour autoriser la capture.";
    els.startBtn.disabled = true;
    return;
  }

  if (!isSupported()) {
    els.secureStatus.textContent = "Capture non supportee";
    els.secureStatus.classList.add("is-bad");
    els.runStatus.textContent = "Ce navigateur ne supporte pas getDisplayMedia.";
    els.startBtn.disabled = true;
    return;
  }

  els.secureStatus.textContent = "Pret pour Chrome local";
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("handles");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet(storeName, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function idbSet(storeName, key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value, key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

async function verifyPermission(handle, requestWrite = false) {
  const options = { mode: requestWrite ? "readwrite" : "read" };
  if ((await handle.queryPermission(options)) === "granted") return true;
  if ((await handle.requestPermission(options)) === "granted") return true;
  return false;
}

async function restoreDirectoryHandle() {
  if (!("showDirectoryPicker" in window)) {
    els.destinationHelp.textContent =
      "La selection de dossier n'est pas disponible ici. Utilise Chrome recent sur localhost.";
    return;
  }

  try {
    const handle = await idbGet("handles", HANDLE_KEY);
    if (!handle) return;
    state.dirHandle = handle;
    els.destinationLabel.textContent = `Destination : dossier "${handle.name}"`;
    els.destinationHelp.textContent =
      "Dossier memorise. Chrome peut redemander l'autorisation avant d'ecrire.";
  } catch {
    // Directory persistence is optional.
  }
}

async function chooseFolder() {
  if (!("showDirectoryPicker" in window)) {
    alert("La selection de dossier necessite Chrome recent et une page servie en local.");
    return;
  }

  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    const ok = await verifyPermission(handle, true);
    if (!ok) throw new Error("Permission dossier refusee.");
    state.dirHandle = handle;
    await idbSet("handles", HANDLE_KEY, handle);
    els.destinationLabel.textContent = `Destination : dossier "${handle.name}"`;
    els.destinationHelp.textContent =
      "Les captures seront ecrites ici, puis les anciennes seront supprimees selon la limite.";
  } catch (error) {
    if (error.name !== "AbortError") {
      alert(error.message || "Impossible de choisir ce dossier.");
    }
  }
}

function getNumber(el, fallback) {
  const value = Number(el.value);
  return Number.isFinite(value) ? value : fallback;
}

function formatBytes(bytes) {
  if (!bytes) return "0 Mo";
  const mb = bytes / 1024 / 1024;
  if (mb < 1) return `${Math.max(1, Math.round(mb * 1024))} Ko`;
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} Mo`;
}

function timestampParts(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return {
    readable: `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
    file: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(
      date.getHours(),
    )}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`,
  };
}

function updateButtons() {
  els.startBtn.disabled = state.isRunning;
  els.captureNowBtn.disabled = !state.isRunning || state.isPaused || isContinuousClipMode();
  els.pauseBtn.disabled = !state.isRunning;
  els.stopBtn.disabled = !state.isRunning;
  els.chooseFolderBtn.disabled = state.isRunning;
  els.modeSnapshot.disabled = state.isRunning;
  els.modeClip.disabled = state.isRunning;
  els.pauseBtn.textContent = state.isPaused ? "Reprendre" : "Pause";
}

function updatePreview() {
  els.previewShell.classList.toggle("has-stream", Boolean(state.stream));
  els.previewShell.classList.toggle("is-hidden", state.previewHidden);
  els.hidePreviewBtn.textContent = state.previewHidden ? "Afficher l'apercu" : "Masquer l'apercu";
}

function renderRows() {
  if (!state.captures.length) {
    els.captureRows.innerHTML =
      '<tr class="empty-row"><td colspan="5">Aucun fichier pour l\'instant.</td></tr>';
  } else {
    els.captureRows.innerHTML = state.captures
      .slice()
      .reverse()
      .map((item) => {
        const action = item.url
          ? `<a class="file-action" href="${item.url}" download="${item.name}">Telecharger</a>`
          : "Ecrit dans dossier";
        return `<tr>
          <td>${item.time}</td>
          <td>${item.type}</td>
          <td>${formatBytes(item.size)}</td>
          <td>${item.name}</td>
          <td>${action}</td>
        </tr>`;
      })
      .join("");
  }

  const total = state.captures.reduce((sum, item) => sum + item.size, 0);
  els.retentionSummary.textContent = `${state.captures.length} fichier${
    state.captures.length > 1 ? "s" : ""
  }, ${formatBytes(total)}.`;
}

async function deleteCapture(item) {
  if (item.url) URL.revokeObjectURL(item.url);
  if (state.dirHandle && item.name) {
    try {
      const ok = await verifyPermission(state.dirHandle, true);
      if (ok) await state.dirHandle.removeEntry(item.name);
    } catch {
      // File may already be gone; keep retention moving.
    }
  }
}

async function enforceRetention() {
  const maxFiles = Math.max(1, Math.floor(getNumber(els.maxFiles, 40)));
  const maxBytes = Math.max(1, getNumber(els.maxMb, 750)) * 1024 * 1024;

  while (state.captures.length > maxFiles) {
    const old = state.captures.shift();
    await deleteCapture(old);
  }

  let total = state.captures.reduce((sum, item) => sum + item.size, 0);
  while (state.captures.length && total > maxBytes) {
    const old = state.captures.shift();
    total -= old.size;
    await deleteCapture(old);
  }
}

async function saveBlob(blob, baseName, extension, typeLabel) {
  const stamp = timestampParts();
  const name = `${baseName}_${stamp.file}.${extension}`;
  let url = "";

  if (state.dirHandle) {
    const ok = await verifyPermission(state.dirHandle, true);
    if (!ok) throw new Error("Autorisation dossier refusee.");
    const fileHandle = await state.dirHandle.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
  } else {
    url = URL.createObjectURL(blob);
  }

  state.captures.push({
    name,
    url,
    type: typeLabel,
    time: stamp.readable,
    size: blob.size,
  });
  await enforceRetention();
  renderRows();
}

function waitForAbortableTimeout(ms, label, signal) {
  const total = Math.max(0, ms);
  let remaining = total;
  let lastTick = performance.now();
  let timeoutId = 0;

  return new Promise((resolve) => {
    function finish(value) {
      window.clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
      resolve(value);
    }

    function onAbort() {
      finish(false);
    }

    function tick() {
      if (signal?.aborted || !state.isRunning) {
        finish(false);
        return;
      }

      const now = performance.now();

      if (state.isPaused) {
        lastTick = now;
        els.runStatus.textContent = "En pause.";
        els.nextStatus.textContent = "Reprends pour continuer la cadence.";
        els.progressBar.style.width = "0%";
        timeoutId = window.setTimeout(tick, 250);
        return;
      }

      remaining -= now - lastTick;
      lastTick = now;

      const remainingSec = Math.max(0, Math.ceil(remaining / 1000));
      const pct = total ? Math.min(100, ((total - remaining) / total) * 100) : 100;
      els.runStatus.textContent = label;
      els.nextStatus.textContent = remainingSec
        ? `Prochaine etape dans ${remainingSec}s.`
        : "Maintenant.";
      els.progressBar.style.width = `${pct}%`;

      if (remaining <= 0) {
        finish(true);
        return;
      }

      timeoutId = window.setTimeout(tick, Math.min(500, Math.max(50, remaining)));
    }

    signal?.addEventListener("abort", onAbort, { once: true });
    timeoutId = window.setTimeout(tick, 0);
  });
}

async function snapshotBlobFromSource(source, sourceWidth, sourceHeight) {
  const maxWidth = Math.max(640, getNumber(els.maxWidth, 1600));
  const scale = Math.min(1, maxWidth / sourceWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sourceWidth * scale);
  canvas.height = Math.round(sourceHeight * scale);
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const quality = Math.min(0.95, Math.max(0.45, getNumber(els.quality, 78) / 100));
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("La capture image a echoue.");
  return blob;
}

async function captureSnapshot() {
  if (!state.stream || !els.preview.videoWidth) return;
  const blob = await snapshotBlobFromSource(
    els.preview,
    els.preview.videoWidth,
    els.preview.videoHeight,
  );
  await saveBlob(blob, "capture", "jpg", "Image");
}

async function captureSnapshotFrame(frame) {
  const sourceWidth = frame.displayWidth || frame.codedWidth;
  const sourceHeight = frame.displayHeight || frame.codedHeight;
  if (!sourceWidth || !sourceHeight) return;
  const blob = await snapshotBlobFromSource(frame, sourceWidth, sourceHeight);
  await saveBlob(blob, "capture", "jpg", "Image");
}

function getRecorderMimeType() {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

async function captureClip(signal, options = {}) {
  if (!state.stream) return;
  if (!window.MediaRecorder) throw new Error("MediaRecorder n'est pas supporte dans ce navigateur.");

  const chunks = [];
  const typeLabel = options.typeLabel || "Clip";
  const baseName = options.baseName || "clip";
  const mimeType = getRecorderMimeType();
  const recorder = new MediaRecorder(state.stream, {
    mimeType,
    videoBitsPerSecond: Math.round(getNumber(els.bitrate, 1.2) * 1_000_000),
  });

  recorder.ondataavailable = (event) => {
    if (event.data?.size) chunks.push(event.data);
  };

  const stopped = new Promise((resolve, reject) => {
    recorder.onstop = resolve;
    recorder.onerror = () => reject(recorder.error || new Error("Erreur d'enregistrement video."));
  });

  try {
    state.currentRecorder = recorder;
    recorder.start(1000);
    if (state.isPaused && recorder.state === "recording") recorder.pause();
    const clipMs = Math.max(2, getNumber(els.clipSec, 8)) * 1000;
    await waitForAbortableTimeout(clipMs, `${typeLabel} en cours.`, signal);
    if (recorder.state !== "inactive") recorder.stop();
    await stopped;
  } finally {
    if (state.currentRecorder === recorder) state.currentRecorder = null;
  }

  if (!chunks.length) throw new Error("Aucune donnee video recue.");
  const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
  await saveBlob(blob, baseName, "webm", typeLabel);
}

async function captureOnce(signal = state.loopAbort?.signal) {
  try {
    els.runStatus.textContent = state.mode === "clip" ? "Preparation du clip." : "Capture image.";
    els.progressBar.style.width = "0%";
    if (state.mode === "clip") await captureClip(signal);
    else await captureSnapshot();
    els.runStatus.textContent = "Capture enregistree.";
  } catch (error) {
    els.runStatus.textContent = "Erreur de capture.";
    els.nextStatus.textContent = error.message || "Erreur inconnue.";
  }
}

async function runLoop(signal) {
  if (els.captureImmediately.checked) await captureOnce(signal);

  while (state.isRunning && !signal.aborted) {
    const delayMs = Math.max(1, getNumber(els.intervalSec, 60)) * 1000;
    const shouldContinue = await waitForAbortableTimeout(delayMs, "En attente.", signal);
    if (!shouldContinue || signal.aborted || !state.isRunning) break;
    await captureOnce(signal);
  }
}

async function runContinuousClipLoop(signal) {
  let index = 1;

  while (state.isRunning && !signal.aborted) {
    if (state.isPaused) {
      await waitForAbortableTimeout(250, "En pause.", signal);
      continue;
    }

    try {
      els.runStatus.textContent = `Segment ${index} en preparation.`;
      els.progressBar.style.width = "0%";
      await captureClip(signal, {
        baseName: "segment",
        typeLabel: "Segment",
      });
      if (!state.isRunning || signal.aborted) break;
      els.runStatus.textContent = `Segment ${index} enregistre.`;
      els.nextStatus.textContent = "Segment suivant en preparation.";
      index += 1;
    } catch (error) {
      if (signal.aborted || !state.isRunning) break;
      els.runStatus.textContent = "Erreur de segment.";
      els.nextStatus.textContent = error.message || "Erreur inconnue.";
      await waitForAbortableTimeout(1000, "Nouvel essai.", signal);
    }
  }
}

function canUseFrameDrivenSnapshots() {
  return (
    state.mode === "snapshot" &&
    typeof window.MediaStreamTrackProcessor !== "undefined" &&
    typeof window.VideoFrame !== "undefined"
  );
}

function updateFrameLoopProgress(nextCaptureAt, intervalMs) {
  const now = performance.now();
  const remaining = Math.max(0, nextCaptureAt - now);
  const remainingSec = Math.ceil(remaining / 1000);
  const pct = intervalMs ? Math.min(100, ((intervalMs - remaining) / intervalMs) * 100) : 0;
  els.runStatus.textContent = "Cadence active sur le flux video.";
  els.nextStatus.textContent = remainingSec
    ? `Prochaine capture dans ${remainingSec}s.`
    : "Capture en cours.";
  els.progressBar.style.width = `${pct}%`;
}

async function readNextFrame(reader, signal) {
  if (signal.aborted) return { aborted: true };
  return new Promise((resolve, reject) => {
    function onAbort() {
      reader.cancel().catch(() => {});
      resolve({ aborted: true });
    }

    signal.addEventListener("abort", onAbort, { once: true });
    reader
      .read()
      .then((result) => resolve(result))
      .catch(reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

async function runFrameSnapshotLoop(signal) {
  const track = state.stream?.getVideoTracks()[0];
  if (!track) return;

  const processor = new MediaStreamTrackProcessor({ track });
  const reader = processor.readable.getReader();
  state.frameReader = reader;

  let intervalMs = Math.max(1, getNumber(els.intervalSec, 60)) * 1000;
  let nextCaptureAt = els.captureImmediately.checked
    ? performance.now()
    : performance.now() + intervalMs;
  let lastUiUpdate = 0;

  try {
    while (state.isRunning && !signal.aborted) {
      const result = await readNextFrame(reader, signal);
      if (result?.aborted || result?.done) break;

      const frame = result.value;
      const now = performance.now();
      intervalMs = Math.max(1, getNumber(els.intervalSec, 60)) * 1000;

      try {
        if (state.isPaused) {
          nextCaptureAt = now + intervalMs;
          els.runStatus.textContent = "En pause.";
          els.nextStatus.textContent = "Reprends pour continuer la cadence.";
          els.progressBar.style.width = "0%";
          continue;
        }

        if (now - lastUiUpdate > 250) {
          updateFrameLoopProgress(nextCaptureAt, intervalMs);
          lastUiUpdate = now;
        }

        if (now >= nextCaptureAt) {
          await captureSnapshotFrame(frame);
          const finishedAt = performance.now();
          nextCaptureAt += intervalMs;
          while (nextCaptureAt <= finishedAt) nextCaptureAt += intervalMs;
          els.runStatus.textContent = "Capture enregistree.";
          updateFrameLoopProgress(nextCaptureAt, intervalMs);
        }
      } finally {
        frame.close();
      }
    }
  } catch (error) {
    if (!signal.aborted && state.isRunning) {
      els.runStatus.textContent = "Retour a la minuterie standard.";
      els.nextStatus.textContent = error.message || "Flux video indisponible.";
      await runLoop(signal);
    }
  } finally {
    if (state.frameReader === reader) state.frameReader = null;
    try {
      reader.releaseLock();
    } catch {
      // The reader may already be released after cancelation.
    }
  }
}

async function startCapture() {
  if (!isSupported()) return;

  try {
    if (state.dirHandle) {
      await verifyPermission(state.dirHandle, true);
    }

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: 12, max: 24 },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });

    state.stream = stream;
    state.isRunning = true;
    state.isPaused = false;
    state.loopAbort = new AbortController();
    els.preview.srcObject = stream;
    await els.preview.play();
    updateButtons();
    updatePreview();
    saveSettings();

    stream.getVideoTracks()[0].addEventListener("ended", () => stopCapture());
    if (isContinuousClipMode()) {
      runContinuousClipLoop(state.loopAbort.signal);
    } else if (canUseFrameDrivenSnapshots()) {
      runFrameSnapshotLoop(state.loopAbort.signal);
    } else {
      runLoop(state.loopAbort.signal);
    }
  } catch (error) {
    if (error.name !== "NotAllowedError" && error.name !== "AbortError") {
      els.runStatus.textContent = "Demarrage impossible.";
      els.nextStatus.textContent = error.message || "Verifie les autorisations Chrome.";
    }
    state.isRunning = false;
    updateButtons();
  }
}

function pauseCapture() {
  state.isPaused = !state.isPaused;
  if (state.currentRecorder) {
    if (state.isPaused && state.currentRecorder.state === "recording") {
      state.currentRecorder.pause();
    } else if (!state.isPaused && state.currentRecorder.state === "paused") {
      state.currentRecorder.resume();
    }
  }
  els.runStatus.textContent = state.isPaused ? "En pause." : "Reprise.";
  updateButtons();
}

function stopCapture() {
  state.isRunning = false;
  state.isPaused = false;
  if (state.loopAbort) state.loopAbort.abort();
  if (state.frameReader) {
    state.frameReader.cancel().catch(() => {});
    state.frameReader = null;
  }
  if (state.currentRecorder && state.currentRecorder.state !== "inactive") {
    state.currentRecorder.stop();
  }
  state.currentRecorder = null;
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
  }
  state.stream = null;
  els.preview.srcObject = null;
  els.runStatus.textContent = "Arrete.";
  els.nextStatus.textContent = "Aucune capture planifiee.";
  els.progressBar.style.width = "0%";
  updateButtons();
  updatePreview();
}

function clearLog() {
  for (const item of state.captures) {
    if (item.url) URL.revokeObjectURL(item.url);
  }
  state.captures = [];
  renderRows();
}

function insertTemplate() {
  const template = [
    "",
    "Session",
    "Objectif :",
    "Contexte :",
    "Points cles :",
    "- ",
    "Preuves / moments a retrouver :",
    "- ",
    "Decisions / actions :",
    "- ",
    "A revoir :",
    "- ",
    "",
  ].join("\n");
  els.notes.value = `${els.notes.value.trim()}\n${template}`.trim();
  localStorage.setItem(NOTES_KEY, els.notes.value);
}

async function exportNotes() {
  const blob = new Blob([els.notes.value || ""], { type: "text/plain;charset=utf-8" });
  const stamp = timestampParts();
  try {
    if (state.dirHandle) {
      await saveBlob(blob, "notes_session", "txt", "Notes");
    } else {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `notes_session_${stamp.file}.txt`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  } catch (error) {
    alert(error.message || "Export des notes impossible.");
  }
}

function bindEvents() {
  els.modeSnapshot.addEventListener("click", () => setMode("snapshot"));
  els.modeClip.addEventListener("click", () => setMode("clip"));
  $$("input").forEach((input) => input.addEventListener("input", saveSettings));
  els.quality.addEventListener("input", () => {
    els.qualityOut.value = els.quality.value;
  });
  els.chooseFolderBtn.addEventListener("click", chooseFolder);
  els.startBtn.addEventListener("click", startCapture);
  els.captureNowBtn.addEventListener("click", () => captureOnce());
  els.pauseBtn.addEventListener("click", pauseCapture);
  els.stopBtn.addEventListener("click", stopCapture);
  els.clearLogBtn.addEventListener("click", clearLog);
  els.hidePreviewBtn.addEventListener("click", () => {
    state.previewHidden = !state.previewHidden;
    updatePreview();
  });
  els.notes.addEventListener("input", () => {
    localStorage.setItem(NOTES_KEY, els.notes.value);
  });
  els.insertTemplateBtn.addEventListener("click", insertTemplate);
  els.exportNotesBtn.addEventListener("click", exportNotes);

  window.addEventListener("beforeunload", () => {
    if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
  });
}

async function init() {
  document.body.classList.add("snapshot-mode");
  loadSettings();
  els.qualityOut.value = els.quality.value;
  checkRuntime();
  renderRows();
  bindEvents();
  updateButtons();
  updatePreview();
  await restoreDirectoryHandle();
}

init();
