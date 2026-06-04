(function () {
  "use strict";

  const DB_NAME = "answer-recorder-db";
  const DB_VERSION = 1;
  const STORE_QUESTIONS = "questions";
  const STORE_SETTINGS = "settings";
  const SUPPORTED_IMPORT_VERSION = 1;

  const state = {
    db: null,
    questions: [],
    settings: { mode: "play" },
    recorder: null,
    recordingChunks: [],
    recordingTarget: null,
    draftAudio: null,
    currentAudio: null,
    currentUrl: null,
    directPlayId: null
  };

  const els = {
    statusText: document.getElementById("statusText"),
    modeToggle: document.getElementById("modeToggle"),
    playMode: document.getElementById("playMode"),
    manageMode: document.getElementById("manageMode"),
    playList: document.getElementById("playList"),
    manageList: document.getElementById("manageList"),
    emptyPlay: document.getElementById("emptyPlay"),
    addForm: document.getElementById("addForm"),
    newQuestionText: document.getElementById("newQuestionText"),
    newRecordButton: document.getElementById("newRecordButton"),
    newAudioFile: document.getElementById("newAudioFile"),
    newAudioState: document.getElementById("newAudioState"),
    newFavorite: document.getElementById("newFavorite"),
    exportButton: document.getElementById("exportButton"),
    importFile: document.getElementById("importFile"),
    directPlayPanel: document.getElementById("directPlayPanel"),
    directQuestion: document.getElementById("directQuestion"),
    directPlayButton: document.getElementById("directPlayButton"),
    playItemTemplate: document.getElementById("playItemTemplate"),
    manageItemTemplate: document.getElementById("manageItemTemplate")
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  async function init() {
    try {
      state.directPlayId = getDeepLinkId();
      state.db = await openDatabase();
      state.settings = await getSettings();
      await loadQuestions();
      bindEvents();
      render();
      registerServiceWorker();

      if (state.directPlayId) {
        handleDirectPlay(state.directPlayId);
      }
    } catch (error) {
      setStatus("此瀏覽器無法使用 IndexedDB，請改用手機或桌機的正式瀏覽器開啟");
      els.modeToggle.disabled = true;
    }
  }

  function bindEvents() {
    els.modeToggle.addEventListener("click", async () => {
      state.settings.mode = state.settings.mode === "manage" ? "play" : "manage";
      await saveSettings();
      renderMode();
    });

    els.addForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = els.newQuestionText.value.trim();
      if (!text) return;

      const item = {
        id: createId(),
        text,
        favorite: els.newFavorite.checked,
        order: nextOrder(),
        audioBlob: state.draftAudio ? state.draftAudio.blob : null,
        audioType: state.draftAudio ? state.draftAudio.type : "",
        audioName: state.draftAudio ? state.draftAudio.name : "",
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await putQuestion(item);
      state.draftAudio = null;
      els.addForm.reset();
      els.newAudioState.textContent = "尚未加入回答音檔";
      await loadQuestions();
      render();
      setStatus("已新增問題");
    });

    els.newRecordButton.addEventListener("click", () => toggleRecording("new"));

    els.newAudioFile.addEventListener("change", () => {
      const file = els.newAudioFile.files && els.newAudioFile.files[0];
      if (!file) return;
      state.draftAudio = { blob: file, type: file.type || "audio/mpeg", name: file.name };
      els.newAudioState.textContent = `已選擇：${file.name}`;
      els.newAudioFile.value = "";
    });

    els.exportButton.addEventListener("click", exportBackup);
    els.importFile.addEventListener("change", importBackup);
    els.directPlayButton.addEventListener("click", () => {
      if (state.directPlayId) playQuestion(state.directPlayId);
    });
  }

  function render() {
    renderMode();
    renderPlayList();
    renderManageList();
  }

  function renderMode() {
    const isManage = state.settings.mode === "manage";
    els.modeToggle.textContent = isManage ? "播放" : "管理";
    els.modeToggle.setAttribute("aria-pressed", String(isManage));
    els.playMode.classList.toggle("hidden", isManage);
    els.manageMode.classList.toggle("hidden", !isManage);
    setStatus(isManage ? "管理模式：可新增、錄音、排序與備份" : "播放模式：點一下立即播放");
  }

  function renderPlayList() {
    els.playList.innerHTML = "";
    const sorted = getDisplayQuestions();
    els.emptyPlay.classList.toggle("hidden", sorted.length > 0);

    sorted.forEach((question) => {
      const button = els.playItemTemplate.content.firstElementChild.cloneNode(true);
      button.dataset.id = question.id;
      button.querySelector(".answer-title").textContent = question.text;
      button.querySelector(".answer-meta").textContent = question.audioBlob
        ? question.favorite ? "最愛・點擊播放" : "點擊播放"
        : "尚未加入音檔";
      button.disabled = !question.audioBlob;
      button.addEventListener("click", () => playQuestion(question.id, button));
      els.playList.append(button);
    });
  }

  function renderManageList() {
    els.manageList.innerHTML = "";
    const sorted = [...state.questions].sort((a, b) => a.order - b.order);

    if (!sorted.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "目前沒有問題。";
      els.manageList.append(empty);
      return;
    }

    sorted.forEach((question, index) => {
      const item = els.manageItemTemplate.content.firstElementChild.cloneNode(true);
      const textInput = item.querySelector(".question-input");
      const favoriteInput = item.querySelector(".favorite-input");
      const audioStatus = item.querySelector(".audio-status");

      textInput.value = question.text;
      favoriteInput.checked = question.favorite;
      audioStatus.textContent = question.audioBlob ? "已有音檔" : "尚無音檔";

      item.querySelector(".save-button").addEventListener("click", async () => {
        question.text = textInput.value.trim() || question.text;
        question.favorite = favoriteInput.checked;
        question.updatedAt = Date.now();
        await putQuestion(question);
        await loadQuestions();
        render();
        setStatus("已儲存修改");
      });

      item.querySelector(".record-button").addEventListener("click", () => toggleRecording(question.id));

      item.querySelector(".upload-input").addEventListener("change", async (event) => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        question.audioBlob = file;
        question.audioType = file.type || "audio/mpeg";
        question.audioName = file.name;
        question.updatedAt = Date.now();
        await putQuestion(question);
        await loadQuestions();
        render();
        setStatus("已更新音檔");
      });

      item.querySelector(".play-button").disabled = !question.audioBlob;
      item.querySelector(".play-button").addEventListener("click", () => playQuestion(question.id));

      item.querySelector(".copy-link-button").addEventListener("click", () => copyShortcutLink(question.id));

      const upButton = item.querySelector(".move-up-button");
      const downButton = item.querySelector(".move-down-button");
      upButton.disabled = index === 0;
      downButton.disabled = index === sorted.length - 1;
      upButton.addEventListener("click", () => moveQuestion(question.id, -1));
      downButton.addEventListener("click", () => moveQuestion(question.id, 1));

      item.querySelector(".delete-button").addEventListener("click", async () => {
        if (!confirm(`刪除「${question.text}」？`)) return;
        await deleteQuestion(question.id);
        await loadQuestions();
        render();
        setStatus("已刪除問題");
      });

      els.manageList.append(item);
    });
  }

  async function toggleRecording(target) {
    if (state.recorder && state.recorder.state === "recording") {
      state.recorder.stop();
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus("目前網址不能使用麥克風，請用 HTTPS 開啟，或先改用上傳音檔");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickRecordingMimeType();
      state.recordingChunks = [];
      state.recordingTarget = target;
      state.recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      state.recorder.addEventListener("dataavailable", (event) => {
        if (event.data && event.data.size) state.recordingChunks.push(event.data);
      });

      state.recorder.addEventListener("stop", async () => {
        stream.getTracks().forEach((track) => track.stop());
        const type = state.recorder.mimeType || "audio/webm";
        const blob = new Blob(state.recordingChunks, { type });
        await saveRecordedBlob(blob, type, state.recordingTarget);
        state.recorder = null;
        state.recordingTarget = null;
        state.recordingChunks = [];
        updateRecordingButtons(false);
      });

      state.recorder.start();
      updateRecordingButtons(true);
      setStatus("錄音中，再按一次停止");
    } catch (error) {
      setStatus("無法啟用麥克風，請檢查瀏覽器權限");
    }
  }

  function pickRecordingMimeType() {
    const options = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/aac",
      "audio/wav"
    ];
    return options.find((type) => window.MediaRecorder && MediaRecorder.isTypeSupported(type)) || "";
  }

  async function saveRecordedBlob(blob, type, target) {
    const name = `recording_${new Date().toISOString().replace(/[:.]/g, "-")}`;
    if (target === "new") {
      state.draftAudio = { blob, type, name };
      els.newAudioState.textContent = "已錄製回答音檔";
      setStatus("錄音完成");
      return;
    }

    const question = state.questions.find((item) => item.id === target);
    if (!question) return;
    question.audioBlob = blob;
    question.audioType = type;
    question.audioName = name;
    question.updatedAt = Date.now();
    await putQuestion(question);
    await loadQuestions();
    render();
    setStatus("已重新錄製音檔");
  }

  function updateRecordingButtons(isRecording) {
    els.newRecordButton.textContent = isRecording && state.recordingTarget === "new" ? "停止錄音" : "開始錄音";
    document.querySelectorAll(".record-button").forEach((button) => {
      button.textContent = isRecording ? "停止錄音" : "重新錄音";
    });
  }

  async function playQuestion(id, sourceButton) {
    const question = state.questions.find((item) => item.id === id);
    if (!question || !question.audioBlob) {
      setStatus("這個問題尚未加入音檔");
      return;
    }

    stopCurrentAudio();
    const url = URL.createObjectURL(question.audioBlob);
    const audio = new Audio(url);
    state.currentAudio = audio;
    state.currentUrl = url;

    document.querySelectorAll(".answer-button").forEach((button) => button.classList.remove("is-playing"));
    if (sourceButton) sourceButton.classList.add("is-playing");

    audio.addEventListener("ended", () => {
      if (sourceButton) sourceButton.classList.remove("is-playing");
      stopCurrentAudio();
      setStatus("播放完成");
    });

    audio.addEventListener("error", () => {
      if (sourceButton) sourceButton.classList.remove("is-playing");
      stopCurrentAudio();
      setStatus("無法播放此音檔，請重新錄製或上傳");
    });

    try {
      await audio.play();
      setStatus(`正在播放：${question.text}`);
    } catch (error) {
      if (sourceButton) sourceButton.classList.remove("is-playing");
      setStatus("瀏覽器需要點一下按鈕才能播放音檔");
    }
  }

  function stopCurrentAudio() {
    if (state.currentAudio) {
      state.currentAudio.pause();
      state.currentAudio.src = "";
      state.currentAudio = null;
    }

    if (state.currentUrl) {
      URL.revokeObjectURL(state.currentUrl);
      state.currentUrl = null;
    }
  }

  function handleDirectPlay(id) {
    const question = state.questions.find((item) => item.id === id);
    els.directPlayPanel.classList.remove("hidden");
    els.directQuestion.textContent = question ? question.text : "找不到指定問題";
    els.directPlayButton.disabled = !question || !question.audioBlob;

    if (question && question.audioBlob) {
      state.settings.mode = "play";
      renderMode();
      playQuestion(id);
    }
  }

  function getDeepLinkId() {
    const url = new URL(window.location.href);
    const byQuery = url.searchParams.get("play") || url.searchParams.get("id");
    if (byQuery) return byQuery;

    const pathMatch = url.pathname.match(/\/play\/([^/]+)/);
    if (pathMatch) return decodeURIComponent(pathMatch[1]);

    const hashMatch = url.hash.match(/#\/?play\/([^/]+)/);
    if (hashMatch) return decodeURIComponent(hashMatch[1]);

    return "";
  }

  async function copyShortcutLink(id) {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/play\/.*$/, "");
    url.searchParams.set("play", id);

    try {
      await navigator.clipboard.writeText(url.toString());
      setStatus("已複製捷徑網址，可貼到 iPhone 捷徑");
    } catch (error) {
      prompt("複製這個捷徑網址", url.toString());
    }
  }

  async function moveQuestion(id, direction) {
    const sorted = [...state.questions].sort((a, b) => a.order - b.order);
    const index = sorted.findIndex((item) => item.id === id);
    const swapIndex = index + direction;
    if (index < 0 || swapIndex < 0 || swapIndex >= sorted.length) return;

    const a = sorted[index];
    const b = sorted[swapIndex];
    const temp = a.order;
    a.order = b.order;
    b.order = temp;
    a.updatedAt = Date.now();
    b.updatedAt = Date.now();

    await putQuestion(a);
    await putQuestion(b);
    await loadQuestions();
    render();
    setStatus("已調整排序");
  }

  async function exportBackup() {
    const manifest = {
      app: "answer-recorder",
      version: SUPPORTED_IMPORT_VERSION,
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      questions: state.questions.map((question) => ({
        id: question.id,
        text: question.text,
        favorite: question.favorite,
        order: question.order,
        audioType: question.audioType,
        audioName: question.audioName,
        audioFile: question.audioBlob ? `audio/${question.id}` : "",
        createdAt: question.createdAt,
        updatedAt: question.updatedAt
      }))
    };

    const entries = [
      {
        name: "manifest.json",
        data: new TextEncoder().encode(JSON.stringify(manifest, null, 2))
      }
    ];

    for (const question of state.questions) {
      if (!question.audioBlob) continue;
      entries.push({
        name: `audio/${question.id}`,
        data: new Uint8Array(await question.audioBlob.arrayBuffer())
      });
    }

    const zipBlob = createZip(entries);
    const link = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    link.href = URL.createObjectURL(zipBlob);
    link.download = `backup_${stamp}.zip`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    setStatus("已匯出備份 ZIP");
  }

  async function importBackup(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;

    if (!confirm("匯入備份會覆蓋目前本機資料，確定繼續？")) return;

    try {
      const entries = await parseZip(file);
      const manifestEntry = entries.get("manifest.json");
      if (!manifestEntry) throw new Error("missing manifest");

      const manifest = JSON.parse(new TextDecoder().decode(manifestEntry));
      if (manifest.app !== "answer-recorder" || manifest.version !== SUPPORTED_IMPORT_VERSION) {
        throw new Error("unsupported backup");
      }

      await clearAllQuestions();
      state.settings = manifest.settings || { mode: "play" };
      await saveSettings();

      for (const item of manifest.questions || []) {
        const audioData = item.audioFile ? entries.get(item.audioFile) : null;
        const audioBlob = audioData
          ? new Blob([audioData], { type: item.audioType || "audio/mpeg" })
          : null;

        await putQuestion({
          id: item.id || createId(),
          text: item.text || "未命名問題",
          favorite: Boolean(item.favorite),
          order: Number.isFinite(item.order) ? item.order : nextOrder(),
          audioBlob,
          audioType: item.audioType || "",
          audioName: item.audioName || "",
          createdAt: item.createdAt || Date.now(),
          updatedAt: Date.now()
        });
      }

      await loadQuestions();
      render();
      setStatus("已匯入備份");
    } catch (error) {
      setStatus("匯入失敗，請確認是回答錄音機匯出的 ZIP");
    }
  }

  function getDisplayQuestions() {
    return [...state.questions].sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return a.order - b.order;
    });
  }

  function nextOrder() {
    if (!state.questions.length) return 1;
    return Math.max(...state.questions.map((item) => item.order || 0)) + 1;
  }

  function createId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function setStatus(message) {
    els.statusText.textContent = message;
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.addEventListener("upgradeneeded", () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_QUESTIONS)) {
          db.createObjectStore(STORE_QUESTIONS, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
          db.createObjectStore(STORE_SETTINGS);
        }
      });

      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
    });
  }

  function transaction(storeName, mode) {
    return state.db.transaction(storeName, mode).objectStore(storeName);
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
    });
  }

  async function getSettings() {
    const settings = await requestToPromise(transaction(STORE_SETTINGS, "readonly").get("settings"));
    return settings || { mode: "play" };
  }

  async function saveSettings() {
    await requestToPromise(transaction(STORE_SETTINGS, "readwrite").put(state.settings, "settings"));
  }

  async function loadQuestions() {
    state.questions = await requestToPromise(transaction(STORE_QUESTIONS, "readonly").getAll());
  }

  async function putQuestion(question) {
    await requestToPromise(transaction(STORE_QUESTIONS, "readwrite").put(question));
  }

  async function deleteQuestion(id) {
    await requestToPromise(transaction(STORE_QUESTIONS, "readwrite").delete(id));
  }

  async function clearAllQuestions() {
    await requestToPromise(transaction(STORE_QUESTIONS, "readwrite").clear());
  }

  function createZip(entries) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const now = new Date();
    const time = ((now.getHours() & 31) << 11) | ((now.getMinutes() & 63) << 5) | ((now.getSeconds() / 2) & 31);
    const date = (((now.getFullYear() - 1980) & 127) << 9) | (((now.getMonth() + 1) & 15) << 5) | (now.getDate() & 31);

    entries.forEach((entry) => {
      const fileName = encoder.encode(entry.name);
      const data = entry.data;
      const crc = crc32(data);
      const localHeader = new Uint8Array(30 + fileName.length);
      const localView = new DataView(localHeader.buffer);

      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, time, true);
      localView.setUint16(12, date, true);
      localView.setUint32(14, crc, true);
      localView.setUint32(18, data.length, true);
      localView.setUint32(22, data.length, true);
      localView.setUint16(26, fileName.length, true);
      localHeader.set(fileName, 30);
      localParts.push(localHeader, data);

      const centralHeader = new Uint8Array(46 + fileName.length);
      const centralView = new DataView(centralHeader.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, time, true);
      centralView.setUint16(14, date, true);
      centralView.setUint32(16, crc, true);
      centralView.setUint32(20, data.length, true);
      centralView.setUint32(24, data.length, true);
      centralView.setUint16(28, fileName.length, true);
      centralView.setUint32(42, offset, true);
      centralHeader.set(fileName, 46);
      centralParts.push(centralHeader);

      offset += localHeader.length + data.length;
    });

    const centralOffset = offset;
    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, entries.length, true);
    endView.setUint16(10, entries.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, centralOffset, true);

    return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
  }

  async function parseZip(file) {
    const data = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(data.buffer);
    const decoder = new TextDecoder();
    let eocdOffset = -1;

    for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i -= 1) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }

    if (eocdOffset < 0) throw new Error("invalid zip");

    const entryCount = view.getUint16(eocdOffset + 10, true);
    let centralOffset = view.getUint32(eocdOffset + 16, true);
    const entries = new Map();

    for (let i = 0; i < entryCount; i += 1) {
      if (view.getUint32(centralOffset, true) !== 0x02014b50) throw new Error("invalid central directory");
      const method = view.getUint16(centralOffset + 10, true);
      const compressedSize = view.getUint32(centralOffset + 20, true);
      const fileNameLength = view.getUint16(centralOffset + 28, true);
      const extraLength = view.getUint16(centralOffset + 30, true);
      const commentLength = view.getUint16(centralOffset + 32, true);
      const localOffset = view.getUint32(centralOffset + 42, true);
      const name = decoder.decode(data.slice(centralOffset + 46, centralOffset + 46 + fileNameLength));

      if (method !== 0) throw new Error("compressed zip entries are not supported");
      if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("invalid local header");

      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      entries.set(name, data.slice(dataStart, dataStart + compressedSize));

      centralOffset += 46 + fileNameLength + extraLength + commentLength;
    }

    return entries;
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[i] = c >>> 0;
    }
    return table;
  })();

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      setStatus("Service Worker 註冊失敗，請使用 http://localhost 或 HTTPS 開啟");
    });
  }
})();
