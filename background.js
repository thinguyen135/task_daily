"use strict";

const STORAGE_KEY = "nova_planner_v2";
const ALARM_PREFIX = "nova-task:";
const ICON_URL = "icons/icon128.png";

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
    title: `Đến giờ: ${task.name}`,
    message: task.desc ? `${task.time} - ${task.desc}` : `${task.time} - Đã đến lúc thực hiện.`,
    priority: 2
  });
}

chrome.runtime.onInstalled.addListener(scheduleAllAlarms);
chrome.runtime.onStartup.addListener(scheduleAllAlarms);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[STORAGE_KEY]) {
    scheduleAllAlarms();
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith(ALARM_PREFIX)) {
    showTaskNotification(alarm.name);
  }
});
