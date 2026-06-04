(function () {
  "use strict";

  const DB_NAME = "answer-recorder-db";
  const DB_VERSION = 1;
  const STORE_QUESTIONS = "questions";
  const STORE_SETTINGS = "settings";
  const BACKUP_VERSION = 2;
  const DEFAULT_CATEGORY_ID = "default";
  const PINNED_CATEGORY_ID = "__pinned__";

  const state = {
    db: null,
    questions: [],
    settings: makeDefaultSettings(),
    recorder: null,
    recordingChunks: [],
    recordingTarget: null,
    draftAudio: null,
    currentAudio: null,
    currentUrl: null,
    directPlayId: null,
    expandedManageId: null,
    sortMode: false
  };

  const els = {};

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  async function init() {
    bindElements();

    try {
      requireElements();
      if (!("indexedDB" in window)) {
        throw new Error("IndexedDB unavailable");
      }

      state.directPlayId = getDeepLinkId();
      state.db = await openDatabase();
      state.settings = normalizeSettings(await getSettings());
      await saveSettings();
      await loadQuestions();
      await normalizeQuestions();
      ensureActiveCategory(true);
      await saveSettings();
      bindEvents();
      render();
      registerServiceWorker();

      if (state.directPlayId) {
        handleDirectPlay(state.directPlayId);
      }
    } catch (error) {
      const message = error.message === "IndexedDB unavailable"
        ? "此瀏覽器無法使用 IndexedDB，請改用 Safari、Chrome 或重新開啟此頁"
        : "頁面快取版本不一致，請重新整理或移除後重新加入主畫面";
      setStatus(message);
      disableCoreControls();
    }
  }

  function bindElements() {
    [
      "statusText",
      "answerTab",
      "manageTab",
      "addTab",
      "answerPage",
      "managePage",
      "addPage",
      "answerCategoryControl",
      "manageCategoryControl",
      "sortAnswerButton",
      "playList",
      "manageList",
      "categoryList",
      "emptyPlay",
      "categoryForm",
      "newCategoryName",
      "addForm",
      "newQuestionText",
      "newQuestionCategory",
      "newRecordButton",
      "newPreviewButton",
      "newAudioFile",
      "newAudioState",
      "newFavorite",
      "exportButton",
      "importFile",
      "directPlayPanel",
      "directQuestion",
      "directPlayButton",
      "playItemTemplate",
      "manageItemTemplate"
    ].forEach((id) => {
      els[id] = document.getElementById(id);
    });
  }

  function requireElements() {
    const missing = Object.entries(els)
      .filter(([, element]) => !element)
      .map(([id]) => id);
    if (missing.length) {
      throw new Error(`Missing elements: ${missing.join(", ")}`);
    }
  }

  function disableCoreControls() {
    ["answerTab", "manageTab", "addTab", "sortAnswerButton"].forEach((id) => {
      if (els[id]) els[id].disabled = true;
    });
  }

  function bindEvents() {
    els.answerTab.addEventListener("click", () => setMode("answer"));
    els.manageTab.addEventListener("click", () => setMode("manage"));
    els.addTab.addEventListener("click", () => setMode("add"));
    els.sortAnswerButton.addEventListener("click", () => {
      state.sortMode = !state.sortMode;
      renderPlayList();
      renderSortButton();
    });

    els.categoryForm.addEventListener("submit", addCategory);
    els.addForm.addEventListener("submit", addQuestion);
    els.newRecordButton.addEventListener("click", () => toggleRecording("new"));
    els.newPreviewButton.addEventListener("click", () => {
      if (state.draftAudio) playBlob(state.draftAudio.blob, "正在試聽新增音檔");
    });
    els.newAudioFile.addEventListener("change", handleNewAudioFile);
    els.exportButton.addEventListener("click", exportBackup);
    els.importFile.addEventListener("change", importBackup);
    els.directPlayButton.addEventListener("click", () => {
      if (state.directPlayId) playQuestion(state.directPlayId);
    });
  }

  function render() {
    ensureActiveCategory(false);
    renderMode();
    renderCategoryControls();
    renderNewQuestionCategorySelect();
    renderPlayList();
    renderManageList();
    renderCategoryManager();
    renderSortButton();
  }

  async function setMode(mode) {
    if (state.settings.mode === mode) return;
    state.settings.mode = mode;
    if (mode !== "answer") state.sortMode = false;
    await saveSettings();
    renderMode();
    renderSortButton();
  }

  function renderMode() {
    const mode = state.settings.mode || "answer";
    [
      ["answer", els.answerTab, els.answerPage],
      ["manage", els.manageTab, els.managePage],
      ["add", els.addTab, els.addPage]
    ].forEach(([name, tab, page]) => {
      const active = mode === name;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-pressed", String(active));
      page.classList.toggle("hidden", !active);
    });

    const label = mode === "answer"
      ? "回答頁面：點一下立即播放"
      : mode === "manage"
        ? "管理頁面：依分類管理問題與備份"
        : "新增頁面：建立問題與回答音檔";
    setStatus(label);
  }

  function renderSortButton() {
    els.sortAnswerButton.classList.toggle("is-active", state.sortMode);
    els.sortAnswerButton.textContent = state.sortMode ? "完成排序" : "排序";
  }

  function renderCategoryControls() {
    renderCategoryControl(els.answerCategoryControl);
    renderCategoryControl(els.manageCategoryControl);
  }

  function renderCategoryControl(container) {
    container.innerHTML = "";
    const categories = getVisibleCategories();

    if (categories.length > 4) {
      const select = document.createElement("select");
      select.className = "category-select";
      select.setAttribute("aria-label", "選擇分類");
      categories.forEach((category) => {
        const option = document.createElement("option");
        option.value = category.id;
        option.textContent = category.name;
        option.selected = category.id === state.settings.activeCategoryId;
        select.append(option);
      });
      select.addEventListener("change", () => setActiveCategory(select.value));
      container.append(select);
      return;
    }

    const tabs = document.createElement("div");
    tabs.className = "category-tabs";
    categories.forEach((category) => {
      const button = document.createElement("button");
      button.className = "category-tab";
      button.type = "button";
      button.textContent = category.name;
      button.classList.toggle("is-active", category.id === state.settings.activeCategoryId);
      button.addEventListener("click", () => setActiveCategory(category.id));
      tabs.append(button);
    });
    container.append(tabs);
  }

  async function setActiveCategory(categoryId) {
    state.settings.activeCategoryId = categoryId;
    state.expandedManageId = null;
    await saveSettings();
    renderCategoryControls();
    renderPlayList();
    renderManageList();
  }

  function renderPlayList() {
    els.playList.innerHTML = "";
    const visible = getQuestionsForActiveCategory();
    els.emptyPlay.classList.toggle("hidden", visible.length > 0);

    visible.forEach((question, index) => {
      const item = els.playItemTemplate.content.firstElementChild.cloneNode(true);
      const button = item.querySelector(".answer-button");
      const sortActions = item.querySelector(".sort-actions");
      const upButton = item.querySelector(".move-up-button");
      const downButton = item.querySelector(".move-down-button");

      button.dataset.id = question.id;
      item.querySelector(".answer-title").textContent = question.text;
      item.querySelector(".answer-meta").textContent = question.audioBlob
        ? getQuestionMeta(question)
        : `${getCategoryName(question.categoryId)}・尚未加入音檔`;
      button.disabled = state.sortMode || !question.audioBlob;
      button.addEventListener("click", () => playQuestion(question.id, button));

      sortActions.classList.toggle("hidden", !state.sortMode);
      upButton.disabled = index === 0;
      downButton.disabled = index === visible.length - 1;
      upButton.addEventListener("click", () => moveQuestionInActiveList(question.id, -1));
      downButton.addEventListener("click", () => moveQuestionInActiveList(question.id, 1));

      els.playList.append(item);
    });
  }

  function renderManageList() {
    els.manageList.innerHTML = "";
    const visible = getQuestionsForActiveCategory();

    if (!visible.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "這個分類目前沒有問題。";
      els.manageList.append(empty);
      return;
    }

    visible.forEach((question) => {
      const item = els.manageItemTemplate.content.firstElementChild.cloneNode(true);
      const summary = item.querySelector(".manage-summary");
      const detail = item.querySelector(".manage-detail");
      const title = item.querySelector(".manage-title");
      const summaryMeta = item.querySelector(".manage-summary-meta");
      const textInput = item.querySelector(".question-input");
      const categoryInput = item.querySelector(".category-input");
      const favoriteInput = item.querySelector(".favorite-input");
      const audioStatus = item.querySelector(".audio-status");

      const isExpanded = state.expandedManageId === question.id;
      item.classList.toggle("is-expanded", isExpanded);
      detail.classList.toggle("hidden", !isExpanded);
      summary.setAttribute("aria-expanded", String(isExpanded));
      title.textContent = question.text;
      summaryMeta.textContent = getQuestionMeta(question);
      textInput.value = question.text;
      favoriteInput.checked = Boolean(question.favorite);
      audioStatus.textContent = question.audioBlob ? "已有音檔" : "尚無音檔";
      fillCategorySelect(categoryInput, question.categoryId);

      summary.addEventListener("click", () => {
        state.expandedManageId = isExpanded ? null : question.id;
        renderManageList();
      });

      item.querySelector(".save-button").addEventListener("click", async () => {
        question.text = textInput.value.trim() || question.text;
        question.categoryId = categoryInput.value || getDefaultRealCategoryId();
        question.favorite = favoriteInput.checked;
        if (question.favorite) state.settings.activeCategoryId = PINNED_CATEGORY_ID;
        question.updatedAt = Date.now();
        state.expandedManageId = question.id;
        await putQuestion(question);
        await loadQuestions();
        ensureActiveCategory();
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
        state.expandedManageId = question.id;
        await putQuestion(question);
        await loadQuestions();
        render();
        setStatus("已更新音檔");
      });

      item.querySelector(".play-button").disabled = !question.audioBlob;
      item.querySelector(".play-button").addEventListener("click", () => playQuestion(question.id));
      item.querySelector(".copy-link-button").addEventListener("click", () => copyShortcutLink(question.id));
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

  function renderNewQuestionCategorySelect() {
    fillCategorySelect(els.newQuestionCategory, state.settings.activeCategoryId);
    if (els.newQuestionCategory.value === PINNED_CATEGORY_ID) {
      els.newQuestionCategory.value = getDefaultRealCategoryId();
    }
  }

  function fillCategorySelect(select, selectedId) {
    select.innerHTML = "";
    getRealCategories().forEach((category) => {
      const option = document.createElement("option");
      option.value = category.id;
      option.textContent = category.name;
      option.selected = category.id === selectedId;
      select.append(option);
    });
  }

  function renderCategoryManager() {
    els.categoryList.innerHTML = "";
    const categories = getRealCategories();

    categories.forEach((category, index) => {
      const row = document.createElement("div");
      row.className = "category-row";
      row.draggable = true;
      row.dataset.id = category.id;

      const name = document.createElement("div");
      name.className = "category-name";
      name.textContent = category.name;

      const note = document.createElement("div");
      note.className = "category-note";
      note.textContent = index === 0 ? "預設" : "";
      name.append(note);

      const up = document.createElement("button");
      up.className = "small-button";
      up.type = "button";
      up.textContent = "上移";
      up.disabled = index === 0;
      up.addEventListener("click", () => moveCategory(category.id, -1));

      const first = document.createElement("button");
      first.className = "small-button";
      first.type = "button";
      first.textContent = "設預設";
      first.disabled = index === 0;
      first.addEventListener("click", () => moveCategoryToFirst(category.id));

      const del = document.createElement("button");
      del.className = "small-button danger-button";
      del.type = "button";
      del.textContent = "刪除";
      del.disabled = categories.length === 1;
      del.addEventListener("click", () => deleteCategory(category.id));

      row.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData("text/plain", category.id);
      });
      row.addEventListener("dragover", (event) => event.preventDefault());
      row.addEventListener("drop", (event) => {
        event.preventDefault();
        const draggedId = event.dataTransfer.getData("text/plain");
        moveCategoryBefore(draggedId, category.id);
      });

      row.append(name, up, first, del);
      els.categoryList.append(row);
    });
  }

  async function addCategory(event) {
    event.preventDefault();
    const name = els.newCategoryName.value.trim();
    if (!name) return;

    state.settings.categories.push({
      id: createId(),
      name,
      order: nextCategoryOrder()
    });
    els.newCategoryName.value = "";
    await saveSettings();
    render();
    setStatus("已新增分類");
  }

  async function moveCategory(categoryId, direction) {
    const categories = getRealCategories();
    const index = categories.findIndex((category) => category.id === categoryId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= categories.length) return;
    const temp = categories[index].order;
    categories[index].order = categories[target].order;
    categories[target].order = temp;
    state.settings.categories = categories;
    await saveSettings();
    ensureActiveCategory();
    render();
  }

  async function moveCategoryToFirst(categoryId) {
    const categories = getRealCategories();
    const target = categories.find((category) => category.id === categoryId);
    if (!target) return;
    state.settings.categories = [target, ...categories.filter((category) => category.id !== categoryId)]
      .map((category, index) => ({ ...category, order: index + 1 }));
    await saveSettings();
    ensureActiveCategory();
    render();
  }

  async function moveCategoryBefore(draggedId, beforeId) {
    if (!draggedId || draggedId === beforeId) return;
    const categories = getRealCategories();
    const dragged = categories.find((category) => category.id === draggedId);
    if (!dragged) return;
    const next = categories.filter((category) => category.id !== draggedId);
    const beforeIndex = next.findIndex((category) => category.id === beforeId);
    next.splice(beforeIndex, 0, dragged);
    state.settings.categories = next.map((category, index) => ({ ...category, order: index + 1 }));
    await saveSettings();
    ensureActiveCategory();
    render();
  }

  async function deleteCategory(categoryId) {
    const categories = getRealCategories();
    if (categories.length <= 1) return;
    const category = categories.find((item) => item.id === categoryId);
    if (!category || !confirm(`刪除分類「${category.name}」？此分類的問題會移到第一個分類。`)) return;

    const fallbackId = categories.find((item) => item.id !== categoryId).id;
    state.questions.forEach((question) => {
      if (question.categoryId === categoryId) {
        question.categoryId = fallbackId;
        question.updatedAt = Date.now();
      }
    });
    state.settings.categories = categories
      .filter((item) => item.id !== categoryId)
      .map((item, index) => ({ ...item, order: index + 1 }));
    state.settings.activeCategoryId = fallbackId;
    await saveSettings();
    await Promise.all(state.questions.map((question) => putQuestion(question)));
    await loadQuestions();
    render();
  }

  async function addQuestion(event) {
    event.preventDefault();
    const text = els.newQuestionText.value.trim();
    if (!text) return;

    const item = {
      id: createId(),
      text,
      categoryId: els.newQuestionCategory.value || getDefaultRealCategoryId(),
      favorite: els.newFavorite.checked,
      order: nextQuestionOrder(),
      audioBlob: state.draftAudio ? state.draftAudio.blob : null,
      audioType: state.draftAudio ? state.draftAudio.type : "",
      audioName: state.draftAudio ? state.draftAudio.name : "",
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    if (item.favorite) state.settings.activeCategoryId = PINNED_CATEGORY_ID;

    await putQuestion(item);
    state.draftAudio = null;
    els.addForm.reset();
    els.newAudioState.textContent = "尚未加入回答音檔";
    els.newPreviewButton.classList.add("hidden");
    await loadQuestions();
    ensureActiveCategory();
    render();
    setStatus("已新增問題");
  }

  function handleNewAudioFile() {
    const file = els.newAudioFile.files && els.newAudioFile.files[0];
    if (!file) return;
    state.draftAudio = { blob: file, type: file.type || "audio/mpeg", name: file.name };
    els.newAudioState.textContent = `已選擇：${file.name}`;
    els.newPreviewButton.classList.remove("hidden");
    els.newAudioFile.value = "";
  }

  async function moveQuestionInActiveList(id, direction) {
    const list = getQuestionsForActiveCategory();
    const index = list.findIndex((question) => question.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= list.length) return;
    const a = list[index];
    const b = list[target];
    const temp = a.order;
    a.order = b.order;
    b.order = temp;
    a.updatedAt = Date.now();
    b.updatedAt = Date.now();
    await putQuestion(a);
    await putQuestion(b);
    await loadQuestions();
    renderPlayList();
    renderManageList();
    setStatus("已調整排序");
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
      els.newPreviewButton.classList.remove("hidden");
      setStatus("錄音完成");
      return;
    }

    const question = state.questions.find((item) => item.id === target);
    if (!question) return;
    question.audioBlob = blob;
    question.audioType = type;
    question.audioName = name;
    question.updatedAt = Date.now();
    state.expandedManageId = question.id;
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

    document.querySelectorAll(".answer-button").forEach((button) => button.classList.remove("is-playing"));
    if (sourceButton) sourceButton.classList.add("is-playing");
    await playBlob(question.audioBlob, `正在播放：${question.text}`, () => {
      if (sourceButton) sourceButton.classList.remove("is-playing");
    });
  }

  async function playBlob(blob, playingMessage, onDone) {
    stopCurrentAudio();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    state.currentAudio = audio;
    state.currentUrl = url;

    audio.onended = () => {
      cleanupCurrentAudio();
      if (onDone) onDone();
      setStatus("播放完成");
    };

    audio.onerror = () => {
      cleanupCurrentAudio();
      if (onDone) onDone();
      setStatus("無法播放此音檔，請重新錄製或上傳");
    };

    try {
      await audio.play();
      setStatus(playingMessage);
    } catch (error) {
      cleanupCurrentAudio();
      if (onDone) onDone();
      setStatus("瀏覽器需要點一下按鈕才能播放音檔");
    }
  }

  function stopCurrentAudio() {
    if (state.currentAudio) {
      state.currentAudio.onended = null;
      state.currentAudio.onerror = null;
      state.currentAudio.pause();
      state.currentAudio.src = "";
    }
    cleanupCurrentAudio();
  }

  function cleanupCurrentAudio() {
    if (state.currentAudio) {
      state.currentAudio.onended = null;
      state.currentAudio.onerror = null;
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
      state.settings.mode = "answer";
      renderMode();
      playQuestion(id);
    }
  }

  function getQuestionsForActiveCategory() {
    const categoryId = state.settings.activeCategoryId;
    const filtered = categoryId === PINNED_CATEGORY_ID
      ? state.questions.filter((question) => question.favorite)
      : state.questions.filter((question) => getQuestionCategoryId(question) === categoryId);
    return filtered.sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  function getQuestionCategoryId(question) {
    return question.categoryId || DEFAULT_CATEGORY_ID;
  }

  function getQuestionMeta(question) {
    const parts = [];
    if (question.favorite) parts.push("置頂");
    parts.push(getCategoryName(question.categoryId));
    parts.push(question.audioBlob ? "已有音檔" : "尚無音檔");
    return parts.join("・");
  }

  function getVisibleCategories() {
    const categories = [];
    if (hasPinnedQuestions()) {
      categories.push({ id: PINNED_CATEGORY_ID, name: "置頂", order: 0, pinned: true });
    }
    return categories.concat(getRealCategories());
  }

  function getRealCategories() {
    return normalizeCategories(state.settings.categories);
  }

  function getCategoryName(categoryId) {
    const category = getRealCategories().find((item) => item.id === categoryId);
    return category ? category.name : "一般";
  }

  function hasPinnedQuestions() {
    return state.questions.some((question) => question.favorite);
  }

  function ensureActiveCategory(forceDefault) {
    const visibleIds = getVisibleCategories().map((category) => category.id);
    const preferred = hasPinnedQuestions() ? PINNED_CATEGORY_ID : getDefaultRealCategoryId();
    if (forceDefault || !state.settings.activeCategoryId || !visibleIds.includes(state.settings.activeCategoryId)) {
      state.settings.activeCategoryId = preferred;
    }
  }

  function getDefaultRealCategoryId() {
    return getRealCategories()[0].id;
  }

  function nextQuestionOrder() {
    if (!state.questions.length) return 1;
    return Math.max(...state.questions.map((item) => item.order || 0)) + 1;
  }

  function nextCategoryOrder() {
    const categories = getRealCategories();
    return Math.max(...categories.map((item) => item.order || 0), 0) + 1;
  }

  function makeDefaultSettings() {
    return {
      mode: "answer",
      activeCategoryId: DEFAULT_CATEGORY_ID,
      categories: [{ id: DEFAULT_CATEGORY_ID, name: "一般", order: 1 }]
    };
  }

  function normalizeSettings(settings) {
    const base = makeDefaultSettings();
    return {
      ...base,
      ...(settings || {}),
      mode: ["answer", "manage", "add"].includes(settings && settings.mode) ? settings.mode : "answer",
      categories: normalizeCategories(settings && settings.categories)
    };
  }

  function normalizeCategories(categories) {
    const source = Array.isArray(categories) && categories.length
      ? categories
      : [{ id: DEFAULT_CATEGORY_ID, name: "一般", order: 1 }];
    const seen = new Set();
    return source
      .map((category, index) => ({
        id: category.id || createId(),
        name: (category.name || "一般").trim() || "一般",
        order: Number.isFinite(category.order) ? category.order : index + 1
      }))
      .filter((category) => {
        if (seen.has(category.id)) return false;
        seen.add(category.id);
        return true;
      })
      .sort((a, b) => a.order - b.order)
      .map((category, index) => ({ ...category, order: index + 1 }));
  }

  async function normalizeQuestions() {
    const fallbackId = getDefaultRealCategoryId();
    let changed = false;
    const categoryIds = new Set(getRealCategories().map((category) => category.id));
    for (const question of state.questions) {
      if (!question.categoryId || !categoryIds.has(question.categoryId)) {
        question.categoryId = fallbackId;
        changed = true;
      }
      if (!Number.isFinite(question.order)) {
        question.order = nextQuestionOrder();
        changed = true;
      }
    }
    if (changed) {
      await Promise.all(state.questions.map((question) => putQuestion(question)));
      await loadQuestions();
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

  async function exportBackup() {
    const manifest = {
      app: "answer-recorder",
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      questions: state.questions.map((question) => ({
        id: question.id,
        text: question.text,
        categoryId: question.categoryId,
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
      if (manifest.app !== "answer-recorder") throw new Error("unsupported backup");

      await clearAllQuestions();
      state.questions = [];
      state.settings = normalizeSettings(manifest.settings);
      await saveSettings();

      for (const item of manifest.questions || []) {
        const audioData = item.audioFile ? entries.get(item.audioFile) : null;
        const audioBlob = audioData
          ? new Blob([audioData], { type: item.audioType || "audio/mpeg" })
          : null;
        await putQuestion({
          id: item.id || createId(),
          text: item.text || "未命名問題",
          categoryId: item.categoryId || getDefaultRealCategoryId(),
          favorite: Boolean(item.favorite),
          order: Number.isFinite(item.order) ? item.order : nextQuestionOrder(),
          audioBlob,
          audioType: item.audioType || "",
          audioName: item.audioName || "",
          createdAt: item.createdAt || Date.now(),
          updatedAt: Date.now()
        });
      }

      await loadQuestions();
      await normalizeQuestions();
      render();
      setStatus("已匯入備份");
    } catch (error) {
      setStatus("匯入失敗，請確認是回答錄音機匯出的 ZIP");
    }
  }

  function setStatus(message) {
    if (els.statusText) els.statusText.textContent = message;
  }

  function createId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
    return settings || makeDefaultSettings();
  }

  async function saveSettings() {
    state.settings.categories = getRealCategories();
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
      setStatus("Service Worker 註冊失敗，請使用 HTTPS 開啟");
    });
  }
})();
