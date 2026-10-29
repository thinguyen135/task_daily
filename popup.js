(function () {
  "use strict";

  const SK = "nova_planner_v2";
  const DAYS_VI = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];
  const MONTHS_VI = [
    "Tháng 1",
    "Tháng 2",
    "Tháng 3",
    "Tháng 4",
    "Tháng 5",
    "Tháng 6",
    "Tháng 7",
    "Tháng 8",
    "Tháng 9",
    "Tháng 10",
    "Tháng 11",
    "Tháng 12"
  ];

  const PRIORITY_LABELS = {
    high: "CAO",
    med: "TRUNG BÌNH",
    low: "THẤP"
  };

  const PRIORITY_CLASSES = {
    high: "priority-high",
    med: "priority-med",
    low: "priority-low"
  };

  let appData = { tasks: {}, yearGoals: {} };
  let audioCtx = null;
  let alarmedIds = new Set();
  let calYear;
  let calMonth;
  let selectedDay = null;
  let yearView;
  let editingYM = null;

  const $ = (id) => document.getElementById(id);

  function extensionStorageAvailable() {
    return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  }

  function storageGet(key) {
    if (extensionStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.get([key], (result) => {
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          resolve(result[key] || null);
        });
      });
    }

    return Promise.resolve(localStorage.getItem(key));
  }

  function storageSet(key, value) {
    if (extensionStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ [key]: value }, () => resolve());
      });
    }

    localStorage.setItem(key, value);
    return Promise.resolve();
  }

  async function loadData() {
    try {
      const raw = await storageGet(SK);
      if (!raw) return;

      const loaded = JSON.parse(raw);
      appData = Object.assign({ tasks: {}, yearGoals: {} }, loaded);

      if (appData.monthNotes) {
        Object.keys(appData.monthNotes).forEach((key) => {
          if (!appData.tasks[key]) appData.tasks[key] = [];
          appData.monthNotes[key].forEach((note) => {
            appData.tasks[key].push({
              id: note.id || uid(),
              name: note.text,
              time: "",
              desc: "Ghi chú cũ",
              priority: "med",
              done: false
            });
          });
        });
        delete appData.monthNotes;
        await saveData();
      }
    } catch (error) {
      appData = { tasks: {}, yearGoals: {} };
    }
  }

  async function saveData() {
    await storageSet(SK, JSON.stringify(appData));
  }

  function pad(number) {
    return String(number).padStart(2, "0");
  }

  function todayKey() {
    const date = new Date();
    return dateKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
  }

  function dateKey(year, month, day) {
    return `${year}-${pad(month)}-${pad(day)}`;
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function escH(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function initStars() {
    const canvas = $("stars-canvas");
    const ctx = canvas.getContext("2d");
    let stars = [];

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }

    function init() {
      stars = [];
      for (let i = 0; i < 90; i += 1) {
        stars.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          r: Math.random() * 1.3 + 0.3,
          speed: Math.random() * 0.24 + 0.04,
          a: Math.random(),
          ad: Math.random() > 0.5 ? 1 : -1,
          hue: Math.random() > 0.72 ? (Math.random() > 0.5 ? 180 : 300) : 0
        });
      }
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      stars.forEach((star) => {
        star.a += star.ad * 0.008;
        if (star.a > 1 || star.a < 0.1) star.ad *= -1;
        star.y -= star.speed;
        if (star.y < 0) {
          star.y = canvas.height;
          star.x = Math.random() * canvas.width;
        }

        ctx.save();
        ctx.globalAlpha = star.a * 0.7;
        if (star.hue) {
          ctx.shadowBlur = 8;
          ctx.shadowColor = star.hue === 180 ? "rgba(0,213,255,0.8)" : "rgba(255,76,207,0.8)";
          ctx.fillStyle = star.hue === 180 ? "#00d5ff" : "#ff4ccf";
        } else {
          ctx.fillStyle = "#eef4ff";
        }
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
      requestAnimationFrame(draw);
    }

    resize();
    init();
    draw();
    window.addEventListener("resize", () => {
      resize();
      init();
    });
  }

  function updateClock() {
    const now = new Date();
    $("clockDisplay").textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    $("dateDisplay").textContent =
      `${DAYS_VI[now.getDay()]}, ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
    checkPopupAlarms(now);
  }

  function getACtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function playAlarm() {
    try {
      const ctx = getACtx();
      const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
      const times = [0, 0.15, 0.3, 0.45, 0.65, 0.8];
      notes.forEach((freq, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, ctx.currentTime + times[index]);
        gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + times[index] + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + times[index] + 0.3);
        osc.start(ctx.currentTime + times[index]);
        osc.stop(ctx.currentTime + times[index] + 0.32);
      });
    } catch (error) {
      // Audio can be blocked until the user interacts with the popup.
    }
  }

  function playAdd() {
    try {
      const ctx = getACtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "triangle";
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(1200, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.22);
    } catch (error) {
      // Ignore blocked audio.
    }
  }

  function playDone() {
    try {
      const ctx = getACtx();
      [440, 550, 660].forEach((freq, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.22, ctx.currentTime + index * 0.09);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + index * 0.09 + 0.18);
        osc.start(ctx.currentTime + index * 0.09);
        osc.stop(ctx.currentTime + index * 0.09 + 0.2);
      });
    } catch (error) {
      // Ignore blocked audio.
    }
  }

  function switchTab(name, targetButton) {
    document.querySelectorAll(".tab-btn").forEach((button) => button.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((panel) => panel.classList.remove("active"));
    targetButton.classList.add("active");
    $(`panel-${name}`).classList.add("active");
  }

  function flash(id) {
    const element = $(id);
    element.style.borderColor = "var(--danger)";
    element.style.boxShadow = "0 0 0 3px rgba(255,93,120,0.2)";
    setTimeout(() => {
      element.style.borderColor = "";
      element.style.boxShadow = "";
    }, 900);
  }

  async function addTask() {
    const name = $("taskName").value.trim();
    const time = $("taskTime").value;
    const desc = $("taskDesc").value.trim();
    const priority = $("taskPriority").value;

    if (!name) {
      flash("taskName");
      return;
    }

    const key = todayKey();
    if (!appData.tasks[key]) appData.tasks[key] = [];
    appData.tasks[key].push({ id: uid(), name, time, desc, priority, done: false });
    await saveData();
    renderTasks();
    renderCal();
    playAdd();
    $("taskName").value = "";
    $("taskTime").value = "";
    $("taskDesc").value = "";
  }

  async function addMonthTask() {
    const name = $("mTaskName").value.trim();
    const time = $("mTaskTime").value;
    const desc = $("mTaskDesc").value.trim();
    const priority = $("mTaskPriority").value;

    if (!selectedDay) return;
    if (!name) {
      flash("mTaskName");
      return;
    }

    if (!appData.tasks[selectedDay]) appData.tasks[selectedDay] = [];
    appData.tasks[selectedDay].push({ id: uid(), name, time, desc, priority, done: false });
    await saveData();
    renderMonthTasks();
    renderCal();
    if (selectedDay === todayKey()) renderTasks();
    playAdd();
    $("mTaskName").value = "";
    $("mTaskTime").value = "";
    $("mTaskDesc").value = "";
  }

  async function toggleTask(id, targetDate) {
    const key = targetDate || todayKey();
    const tasks = appData.tasks[key] || [];
    const task = tasks.find((item) => item.id === id);
    if (!task) return;

    task.done = !task.done;
    if (task.done) playDone();
    await saveData();
    if (key === todayKey()) renderTasks();
    if (selectedDay === key && $("panel-month").classList.contains("active")) renderMonthTasks();
    renderCal();
  }

  async function deleteTask(id, targetDate) {
    const key = targetDate || todayKey();
    appData.tasks[key] = (appData.tasks[key] || []).filter((task) => task.id !== id);
    await saveData();
    if (key === todayKey()) renderTasks();
    if (selectedDay === key && $("panel-month").classList.contains("active")) renderMonthTasks();
    renderCal();
  }

  function sortTasks(tasks) {
    return [...tasks].sort((a, b) => {
      if (!a.time && !b.time) return 0;
      if (!a.time) return 1;
      if (!b.time) return -1;
      return a.time.localeCompare(b.time);
    });
  }

  function renderTaskItem(task, targetDate) {
    const priority = task.priority || "med";
    const priorityLabel = PRIORITY_LABELS[priority] || PRIORITY_LABELS.med;
    const priorityClass = PRIORITY_CLASSES[priority] || PRIORITY_CLASSES.med;
    const dateAttr = targetDate ? ` data-date="${escH(targetDate)}"` : "";

    return `<div class="task-item ${task.done ? "done" : ""}" id="task-${escH(task.id)}">
      <button class="task-check ${task.done ? "checked" : ""}" type="button" data-action="toggle-task" data-id="${escH(task.id)}"${dateAttr} aria-label="Đánh dấu hoàn thành">${task.done ? "✓" : ""}</button>
      <div class="task-body">
        <div class="task-header">
          ${task.time ? `<span class="task-time">${escH(task.time)}</span>` : ""}
          <span class="task-name">${escH(task.name)}</span>
          <span class="task-priority ${priorityClass}">${priorityLabel}</span>
        </div>
        ${task.desc ? `<div class="task-desc">${escH(task.desc)}</div>` : ""}
        <div class="task-actions">
          <button class="btn btn-danger btn-sm" type="button" data-action="delete-task" data-id="${escH(task.id)}"${dateAttr}>Xóa</button>
        </div>
      </div>
    </div>`;
  }

  function renderTasks() {
    const key = todayKey();
    const tasks = appData.tasks[key] || [];
    const done = tasks.filter((task) => task.done).length;
    const total = tasks.length;
    const percent = total ? Math.round((done / total) * 100) : 0;

    $("statTotal").textContent = total;
    $("statDone").textContent = done;
    $("statLeft").textContent = total - done;
    $("progressBar").style.width = `${percent}%`;
    $("progressPct").textContent = `${percent}%`;

    const list = $("taskList");
    if (!tasks.length) {
      list.innerHTML =
        '<div class="empty-state"><div class="empty-icon">🚀</div><div class="empty-text">Chưa có mục tiêu nào. Hãy bắt đầu.</div></div>';
      return;
    }

    list.innerHTML = sortTasks(tasks).map((task) => renderTaskItem(task, null)).join("");
  }

  function checkPopupAlarms(now) {
    const tasks = appData.tasks[todayKey()] || [];
    const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    tasks.forEach((task) => {
      if (task.time === hhmm && !task.done && !alarmedIds.has(task.id)) {
        alarmedIds.add(task.id);
        playAlarm();
        setTimeout(playAlarm, 900);
        showToast(`Đến giờ: ${task.name}`, `${task.time} - Đã đến lúc thực hiện.`);
        const element = $(`task-${task.id}`);
        if (element) {
          element.classList.add("ringing");
          setTimeout(() => {
            const item = $(`task-${task.id}`);
            if (item) item.classList.remove("ringing");
          }, 8000);
        }
      }
    });
  }

  function showToast(title, message) {
    const container = $("toast-container");
    const toast = document.createElement("div");
    toast.className = "toast";

    const icon = document.createElement("div");
    icon.className = "toast-icon";
    icon.textContent = "🔔";

    const body = document.createElement("div");
    const titleEl = document.createElement("div");
    titleEl.className = "toast-title";
    titleEl.textContent = title;
    const msgEl = document.createElement("div");
    msgEl.className = "toast-msg";
    msgEl.textContent = message;

    body.append(titleEl, msgEl);
    toast.append(icon, body);
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = "toastOut 0.25s ease forwards";
      setTimeout(() => toast.remove(), 260);
    }, 6000);
  }

  function initCal() {
    const now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();
    renderCal();
  }

  function prevMonth() {
    calMonth -= 1;
    if (calMonth < 0) {
      calMonth = 11;
      calYear -= 1;
    }
    renderCal();
  }

  function nextMonth() {
    calMonth += 1;
    if (calMonth > 11) {
      calMonth = 0;
      calYear += 1;
    }
    renderCal();
  }

  function renderCal() {
    $("calTitle").textContent = `${MONTHS_VI[calMonth]} / ${calYear}`;
    const grid = $("calGrid");
    const dayLabels = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
    let html = dayLabels.map((day) => `<div class="cal-day-label">${day}</div>`).join("");
    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const daysInPrev = new Date(calYear, calMonth, 0).getDate();
    const now = new Date();

    for (let i = firstDay - 1; i >= 0; i -= 1) {
      html += `<div class="cal-cell other-month"><div class="cal-num">${daysInPrev - i}</div></div>`;
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const key = dateKey(calYear, calMonth + 1, day);
      const tasks = appData.tasks[key] || [];
      const isToday = day === now.getDate() && calMonth === now.getMonth() && calYear === now.getFullYear();
      const isSelected = selectedDay === key;
      const dots = tasks.length
        ? `<div class="cal-dots">${tasks.map((task) => `<span class="cal-dot ${task.done ? "done" : ""}"></span>`).join("")}</div>`
        : "";

      html += `<button class="cal-cell ${isToday ? "today" : ""} ${isSelected ? "selected" : ""}" type="button" data-day="${day}">
        <span class="cal-num">${day}</span>${dots}
      </button>`;
    }

    const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
    let nextDayNumber = 1;
    for (let i = firstDay + daysInMonth; i < totalCells; i += 1) {
      html += `<div class="cal-cell other-month"><div class="cal-num">${nextDayNumber}</div></div>`;
      nextDayNumber += 1;
    }

    grid.innerHTML = html;
  }

  function selectDay(day) {
    selectedDay = dateKey(calYear, calMonth + 1, day);
    renderCal();
    $("monthNotePanel").classList.add("open");
    $("monthNoteDate").textContent = `${day} ${MONTHS_VI[calMonth]} ${calYear}`;
    renderMonthTasks();
  }

  function renderMonthTasks() {
    const tasks = appData.tasks[selectedDay] || [];
    const list = $("monthTaskList");
    if (!tasks.length) {
      list.innerHTML =
        '<div class="empty-state empty-state-small"><div class="empty-text">Ngày này chưa có kế hoạch nào.</div></div>';
      return;
    }

    list.innerHTML = sortTasks(tasks).map((task) => renderTaskItem(task, selectedDay)).join("");
  }

  function initYear() {
    yearView = new Date().getFullYear();
    renderYear();
  }

  function prevYear() {
    yearView -= 1;
    renderYear();
  }

  function nextYear() {
    yearView += 1;
    renderYear();
  }

  function renderYear() {
    $("yearTitle").textContent = yearView;
    $("yearMonths").innerHTML = MONTHS_VI.map((name, index) => {
      const key = `${yearView}-${index + 1}`;
      const goals = appData.yearGoals[key] || [];
      const doneGoals = goals.filter((goal) => goal.done).length;
      const badge = goals.length ? `<div class="month-card-badge">${doneGoals}/${goals.length}</div>` : "";
      const preview = goals
        .slice(0, 2)
        .map((goal) => `<div class="${goal.done ? "month-goal-done" : ""}">- ${escH(goal.text)}</div>`)
        .join("");

      return `<button class="month-card ${goals.length ? "has-goals" : ""}" type="button" data-month-index="${index}">
        ${badge}
        <div class="month-card-name">${name}</div>
        <div class="month-card-goals">${preview || '<span class="empty-text">Nhấn để thêm...</span>'}</div>
      </button>`;
    }).join("");
  }

  function openYearModal(index) {
    editingYM = `${yearView}-${index + 1}`;
    $("yearModalTitle").textContent = `${MONTHS_VI[index]} / ${yearView}`;
    $("yearGoalInput").value = "";
    renderYearGoals();
    $("yearModal").classList.add("open");
    $("yearGoalInput").focus();
  }

  function closeYearModal() {
    $("yearModal").classList.remove("open");
    editingYM = null;
    renderYear();
  }

  async function saveYearGoal() {
    const text = $("yearGoalInput").value.trim();
    if (!text || !editingYM) return;

    if (!appData.yearGoals[editingYM]) appData.yearGoals[editingYM] = [];
    appData.yearGoals[editingYM].push({ id: uid(), text, done: false });
    await saveData();
    $("yearGoalInput").value = "";
    renderYearGoals();
    renderYear();
    playAdd();
  }

  async function toggleYearGoal(id) {
    const goal = (appData.yearGoals[editingYM] || []).find((item) => item.id === id);
    if (!goal) return;

    goal.done = !goal.done;
    if (goal.done) playDone();
    await saveData();
    renderYearGoals();
    renderYear();
  }

  async function deleteYearGoal(id) {
    if (!editingYM) return;

    appData.yearGoals[editingYM] = (appData.yearGoals[editingYM] || []).filter((goal) => goal.id !== id);
    await saveData();
    renderYearGoals();
    renderYear();
  }

  function renderYearGoals() {
    const goals = appData.yearGoals[editingYM] || [];
    const list = $("yearGoalList");
    if (!goals.length) {
      list.innerHTML =
        '<div class="empty-state empty-state-small"><div class="empty-text">Chưa có mục tiêu nào.</div></div>';
      return;
    }

    list.innerHTML = goals.map((goal) => `
      <div class="task-item ${goal.done ? "done" : ""}">
        <button class="task-check ${goal.done ? "checked" : ""}" type="button" data-action="toggle-year-goal" data-id="${escH(goal.id)}" aria-label="Đánh dấu hoàn thành">${goal.done ? "✓" : ""}</button>
        <div class="task-body">
          <div class="task-name">${escH(goal.text)}</div>
        </div>
        <button class="btn btn-danger btn-sm" type="button" data-action="delete-year-goal" data-id="${escH(goal.id)}">Xóa</button>
      </div>
    `).join("");
  }

  function bindEvents() {
    document.querySelectorAll(".tab-btn").forEach((button) => {
      button.addEventListener("click", () => switchTab(button.dataset.tab, button));
    });

    $("addTaskBtn").addEventListener("click", addTask);
    $("addMonthTaskBtn").addEventListener("click", addMonthTask);
    $("prevMonthBtn").addEventListener("click", prevMonth);
    $("nextMonthBtn").addEventListener("click", nextMonth);
    $("prevYearBtn").addEventListener("click", prevYear);
    $("nextYearBtn").addEventListener("click", nextYear);
    $("closeYearModalBtn").addEventListener("click", closeYearModal);
    $("saveYearGoalBtn").addEventListener("click", saveYearGoal);

    $("calGrid").addEventListener("click", (event) => {
      const cell = event.target.closest("[data-day]");
      if (!cell) return;
      selectDay(Number(cell.dataset.day));
    });

    $("yearMonths").addEventListener("click", (event) => {
      const card = event.target.closest("[data-month-index]");
      if (!card) return;
      openYearModal(Number(card.dataset.monthIndex));
    });

    document.addEventListener("click", (event) => {
      const actionTarget = event.target.closest("[data-action]");
      if (!actionTarget) return;

      const action = actionTarget.dataset.action;
      const id = actionTarget.dataset.id;
      const date = actionTarget.dataset.date;

      if (action === "toggle-task") toggleTask(id, date || null);
      if (action === "delete-task") deleteTask(id, date || null);
      if (action === "toggle-year-goal") toggleYearGoal(id);
      if (action === "delete-year-goal") deleteYearGoal(id);
    });

    $("yearModal").addEventListener("click", (event) => {
      if (event.target === $("yearModal")) closeYearModal();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey) return;

      const active = document.querySelector(".panel.active");
      if ($("yearModal").classList.contains("open")) {
        event.preventDefault();
        saveYearGoal();
      } else if (active && active.id === "panel-day") {
        event.preventDefault();
        addTask();
      } else if (active && active.id === "panel-month" && $("monthNotePanel").classList.contains("open")) {
        event.preventDefault();
        addMonthTask();
      }
    });
  }

  /* ══════════════════════════════════════════════════════════════
     POMODORO & WEBSITE BLOCKER
  ══════════════════════════════════════════════════════════════ */
  let pomoTimerInterval = null;
  let pomoTimeLeft = 25 * 60;
  let pomoMode = "work";
  let pomoIsRunning = false;
  let blockedSites = [];
  let blockerSettings = {
    blockOnPomo: true,
    blockOnSchedule: false,
    startTime: "19:00",
    endTime: "22:00"
  };

  const pomoStorage = {
    get: (keys, callback) => {
      if (extensionStorageAvailable()) {
        chrome.storage.local.get(keys, callback);
      } else {
        const result = {};
        keys.forEach((k) => {
          const val = localStorage.getItem(k);
          if (val) {
            try { result[k] = JSON.parse(val); } catch (e) { result[k] = val; }
          }
        });
        callback(result);
      }
    },
    set: (data, callback) => {
      if (extensionStorageAvailable()) {
        chrome.storage.local.set(data, callback);
      }
      try {
        Object.keys(data).forEach((k) => {
          localStorage.setItem(k, JSON.stringify(data[k]));
        });
      } catch (e) {}
      if (callback && !extensionStorageAvailable()) callback();
    }
  };

  function formatPomoTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  function updatePomoUI() {
    const timerDisplay = $("pomo-timer");
    const statusDisplay = $("pomo-status");
    if (timerDisplay) timerDisplay.textContent = formatPomoTime(pomoTimeLeft);
    if (statusDisplay) {
      if (pomoIsRunning) {
        statusDisplay.innerHTML =
          pomoMode === "work"
            ? '<span style="color:var(--danger)">🔥 Đang trong giờ học tập (Đã bật chặn web)</span>'
            : '<span style="color:var(--success)">☕ Đang giờ giải lao (Tạm mở khóa web)</span>';
      } else {
        statusDisplay.textContent = "Đã tạm dừng / Sẵn sàng";
      }
    }
  }

  function syncPomoState() {
    pomoStorage.set({
      pomoState: {
        isRunning: pomoIsRunning,
        currentMode: pomoMode,
        timeLeft: pomoTimeLeft,
        updatedAt: Date.now()
      }
    });
  }

  function startPomoTimer() {
    if (pomoIsRunning) return;
    pomoIsRunning = true;
    syncPomoState();
    updatePomoUI();

    clearInterval(pomoTimerInterval);
    pomoTimerInterval = setInterval(() => {
      if (pomoTimeLeft > 0) {
        pomoTimeLeft--;
        updatePomoUI();
        if (pomoTimeLeft % 5 === 0) syncPomoState();
      } else {
        clearInterval(pomoTimerInterval);
        pomoIsRunning = false;
        playDone();
        if (pomoMode === "work") {
          showToast("🎉 Pomodoro Hoàn thành!", "Hãy nghỉ ngơi 5 phút để nạp lại năng lượng nhé.");
          switchPomoMode("short", 5);
        } else {
          showToast("⏰ Hết giờ nghỉ!", "Sẵn sàng quay lại phiên học tập tập trung tiếp theo.");
          switchPomoMode("work", 25);
        }
      }
    }, 1000);
  }

  function pausePomoTimer() {
    clearInterval(pomoTimerInterval);
    pomoIsRunning = false;
    syncPomoState();
    updatePomoUI();
  }

  function switchPomoMode(mode, minutes) {
    pausePomoTimer();
    pomoMode = mode;
    pomoTimeLeft = minutes * 60;
    document.querySelectorAll(".mode-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === mode);
    });
    syncPomoState();
    updatePomoUI();
  }

  function extractHostname(inputUrl) {
    let cleaned = inputUrl.trim().toLowerCase();
    if (!cleaned) return "";
    try {
      if (!cleaned.startsWith("http://") && !cleaned.startsWith("https://")) {
        cleaned = "https://" + cleaned;
      }
      const urlObj = new URL(cleaned);
      return urlObj.hostname.replace(/^www\./, "");
    } catch (e) {
      return cleaned.replace(/^(https?:\/\/)?(www\.)?/, "").split("/")[0].split(":")[0];
    }
  }

  function renderBlockedSites() {
    const listEl = $("blocked-sites-list");
    if (!listEl) return;
    listEl.innerHTML = "";
    if (blockedSites.length === 0) {
      listEl.innerHTML = '<li style="color:var(--muted); justify-content:center;">Chưa có trang web nào trong danh sách chặn</li>';
      return;
    }

    blockedSites.forEach((domain, index) => {
      const li = document.createElement("li");
      li.innerHTML = `
        <span>🌐 <b>${escH(domain)}</b></span>
        <button class="remove-site-btn" data-index="${index}" title="Xóa">✖</button>
      `;
      listEl.appendChild(li);
    });

    listEl.querySelectorAll(".remove-site-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const idx = parseInt(e.target.getAttribute("data-index"), 10);
        blockedSites.splice(idx, 1);
        pomoStorage.set({ blockedSites }, () => renderBlockedSites());
      });
    });
  }

  function addBlockedDomain(raw) {
    const domain = extractHostname(raw);
    if (!domain) return;
    if (!blockedSites.includes(domain)) {
      blockedSites.push(domain);
      pomoStorage.set({ blockedSites }, () => {
        if ($("block-url-input")) $("block-url-input").value = "";
        renderBlockedSites();
        showToast("Đã thêm trang web", `Chặn: ${domain}`);
      });
    } else {
      if ($("block-url-input")) $("block-url-input").value = "";
      showToast("Thông báo", `${domain} đã có trong danh sách chặn.`);
    }
  }

  function saveBlockerSettings() {
    blockerSettings = {
      blockOnPomo: $("block-on-pomo") ? $("block-on-pomo").checked : true,
      blockOnSchedule: $("block-on-schedule") ? $("block-on-schedule").checked : false,
      startTime: $("study-start-time") ? $("study-start-time").value || "19:00" : "19:00",
      endTime: $("study-end-time") ? $("study-end-time").value || "22:00" : "22:00"
    };
    pomoStorage.set({ blockerSettings });
  }

  function initPomoAndBlocker() {
    document.querySelectorAll(".mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        switchPomoMode(btn.dataset.mode, parseInt(btn.dataset.time, 10));
      });
    });

    if ($("pomo-start-btn")) $("pomo-start-btn").addEventListener("click", startPomoTimer);
    if ($("pomo-pause-btn")) $("pomo-pause-btn").addEventListener("click", pausePomoTimer);
    if ($("pomo-reset-btn")) {
      $("pomo-reset-btn").addEventListener("click", () => {
        const activeBtn = document.querySelector(".mode-btn.active");
        const defaultMin = activeBtn ? parseInt(activeBtn.dataset.time, 10) : 25;
        switchPomoMode(pomoMode, defaultMin);
      });
    }

    if ($("block-on-pomo")) $("block-on-pomo").addEventListener("change", saveBlockerSettings);
    if ($("block-on-schedule")) $("block-on-schedule").addEventListener("change", saveBlockerSettings);
    if ($("save-schedule-btn")) {
      $("save-schedule-btn").addEventListener("click", () => {
        saveBlockerSettings();
        showToast("Cài đặt giờ", "Đã lưu khung giờ học tập!");
      });
    }

    if ($("add-block-url-btn")) {
      $("add-block-url-btn").addEventListener("click", () => {
        const val = $("block-url-input") ? $("block-url-input").value : "";
        addBlockedDomain(val);
      });
    }

    if ($("block-url-input")) {
      $("block-url-input").addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if ($("add-block-url-btn")) $("add-block-url-btn").click();
        }
      });
    }

    document.querySelectorAll(".preset-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const domain = chip.dataset.domain;
        if (domain) addBlockedDomain(domain);
      });
    });

    pomoStorage.get(["blockedSites", "blockerSettings", "pomoState"], (res) => {
      blockedSites = res.blockedSites || [];
      renderBlockedSites();

      if (res.blockerSettings) {
        blockerSettings = res.blockerSettings;
        if ($("block-on-pomo")) $("block-on-pomo").checked = blockerSettings.blockOnPomo ?? true;
        if ($("block-on-schedule")) $("block-on-schedule").checked = blockerSettings.blockOnSchedule ?? false;
        if ($("study-start-time")) $("study-start-time").value = blockerSettings.startTime || "19:00";
        if ($("study-end-time")) $("study-end-time").value = blockerSettings.endTime || "22:00";
      }

      if (res.pomoState) {
        pomoMode = res.pomoState.currentMode || "work";
        document.querySelectorAll(".mode-btn").forEach((b) => {
          b.classList.toggle("active", b.dataset.mode === pomoMode);
        });

        if (res.pomoState.isRunning) {
          const elapsed = Math.floor((Date.now() - (res.pomoState.updatedAt || Date.now())) / 1000);
          pomoTimeLeft = Math.max(0, (res.pomoState.timeLeft || 25 * 60) - elapsed);
          if (pomoTimeLeft > 0) {
            startPomoTimer();
          } else {
            pomoTimeLeft = 25 * 60;
            updatePomoUI();
          }
        } else {
          pomoTimeLeft = res.pomoState.timeLeft ?? 25 * 60;
          updatePomoUI();
        }
      }
    });
  }

  async function init() {
    initStars();
    bindEvents();
    initPomoAndBlocker();
    await loadData();
    renderTasks();
    initCal();
    initYear();
    updateClock();
    setInterval(updateClock, 1000);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
