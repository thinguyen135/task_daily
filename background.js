"use strict";

const STORAGE_KEY = "nova_planner_v2";
const ALARM_PREFIX = "nova-task:";
const POMO_ALARM = "nova-pomo-timer";
const ICON_URL = "icons/icon128.png";

/* ══════════════════════════════════════════════════════════════
   1. STORAGE & TASK NOTIFICATION SYSTEM (Alarms)
══════════════════════════════════════════════════════════════ */
function storageGet(key) {
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

function clearNovaAlarms() {
  return new Promise((resolve) => {
    chrome.alarms.getAll((alarms) => {
      const novaAlarms = alarms.filter((alarm) => alarm.name.startsWith(ALARM_PREFIX));
      if (!novaAlarms.length) {
        resolve();
        return;
      }

      let remaining = novaAlarms.length;
      novaAlarms.forEach((alarm) => {
        chrome.alarms.clear(alarm.name, () => {
          remaining -= 1;
          if (remaining === 0) resolve();
        });
      });
    });
  });
}

function parseTaskTime(dateKey, time) {
  if (!dateKey || !time) return null;

  const dateParts = dateKey.split("-").map(Number);
  const timeParts = time.split(":").map(Number);
  if (dateParts.length !== 3 || timeParts.length !== 2) return null;
  if (dateParts.some(Number.isNaN) || timeParts.some(Number.isNaN)) return null;

  const [year, month, day] = dateParts;
  const [hour, minute] = timeParts;
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

async function getAppData() {
  const raw = await storageGet(STORAGE_KEY);
  if (!raw) return { tasks: {}, yearGoals: {} };

  try {
    const data = JSON.parse(raw);
    return {
      tasks: data.tasks || {},
      yearGoals: data.yearGoals || {}
    };
  } catch (error) {
    return { tasks: {}, yearGoals: {} };
  }
}

async function scheduleAllAlarms() {
  const data = await getAppData();
  await clearNovaAlarms();

  const now = Date.now();
  Object.entries(data.tasks || {}).forEach(([dateKey, tasks]) => {
    (tasks || []).forEach((task) => {
      if (!task || !task.id || !task.time || task.done) return;

      const when = parseTaskTime(dateKey, task.time);
      if (!when || when <= now) return;

      chrome.alarms.create(`${ALARM_PREFIX}${dateKey}:${task.id}`, { when });
    });
  });
}

async function showTaskNotification(alarmName) {
  const payload = alarmName.slice(ALARM_PREFIX.length);
  const separatorIndex = payload.lastIndexOf(":");
  if (separatorIndex === -1) return;

  const dateKey = payload.slice(0, separatorIndex);
  const taskId = payload.slice(separatorIndex + 1);
  const data = await getAppData();
  const task = (data.tasks[dateKey] || []).find((item) => item.id === taskId);
  if (!task || task.done) return;

  chrome.notifications.create(`notify-${taskId}`, {
    type: "basic",
    iconUrl: ICON_URL,
    title: `⏰ Đến giờ: ${task.name}`,
    message: task.desc ? `${task.time} - ${task.desc}` : `${task.time} - Đã đến lúc thực hiện mục tiêu.`,
    priority: 2
  });
}

/* ══════════════════════════════════════════════════════════════
   2. EVENT LISTENERS
══════════════════════════════════════════════════════════════ */
// Lắng nghe khi cài đặt hoặc khởi động extension
chrome.runtime.onInstalled.addListener(() => {
  scheduleAllAlarms();
});

chrome.runtime.onStartup.addListener(() => {
  scheduleAllAlarms();
});

// Lắng nghe thay đổi trong storage
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local") {
    if (changes[STORAGE_KEY]) {
      scheduleAllAlarms();
    }
    if (changes.pomoState) {
      const state = changes.pomoState.newValue;
      if (state && state.isRunning && state.timeLeft > 0) {
        const alarmTime = Date.now() + state.timeLeft * 1000;
        chrome.alarms.create(POMO_ALARM, { when: alarmTime });
      } else {
        chrome.alarms.clear(POMO_ALARM);
      }
    }
  }
});

// Xử lý báo thức Pomodoro và nhiệm vụ
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith(ALARM_PREFIX)) {
    showTaskNotification(alarm.name);
  } else if (alarm.name === POMO_ALARM) {
    chrome.storage.local.get(["pomoState"], (res) => {
      const state = res.pomoState || {};
      const isWork = state.currentMode === "work";
      chrome.notifications.create("pomo-notify", {
        type: "basic",
        iconUrl: ICON_URL,
        title: isWork ? "🎉 Hoàn thành phiên Pomodoro!" : "⏰ Hết giờ giải lao!",
        message: isWork
          ? "Bạn đã hoàn thành phiên học tập 25 phút. Hãy nghỉ ngơi 5 phút nhé!"
          : "Đã hết giờ giải lao. Hãy sẵn sàng cho phiên tập trung tiếp theo!",
        priority: 2
      });

      chrome.storage.local.set({
        pomoState: {
          isRunning: false,
          currentMode: isWork ? "short" : "work",
          timeLeft: isWork ? 5 * 60 : 25 * 60,
          updatedAt: Date.now()
        }
      });
    });
  }
});
