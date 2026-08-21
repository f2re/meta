const state = {
  token: sessionStorage.getItem("projectControlToken") || "",
  projects: [],
  busy: false
};

const grid = document.querySelector("#projectGrid");
const template = document.querySelector("#projectTemplate");
const globalStatus = document.querySelector("#globalStatus");
const historyBody = document.querySelector("#historyBody");
const securityBanner = document.querySelector("#securityBanner");
const keyDialog = document.querySelector("#keyDialog");
const keyForm = document.querySelector("#keyForm");
const keyInput = document.querySelector("#accessKey");
const keyError = document.querySelector("#keyError");

function authHeaders(extra = {}) {
  return { ...extra, Authorization: `Bearer ${state.token}` };
}

function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "medium" }).format(date);
}

function operationLabel(value) {
  return ({ update: "Обновление", install: "Установка", restart: "Перезапуск" })[value] || value || "—";
}

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: authHeaders(options.headers || {}) });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) {
    state.token = "";
    sessionStorage.removeItem("projectControlToken");
    openKeyDialog();
  }
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function openKeyDialog() {
  keyInput.value = state.token;
  keyError.textContent = "";
  if (!keyDialog.open) keyDialog.showModal();
  keyInput.focus();
}

function setBusy(value, text = "") {
  state.busy = value;
  document.querySelector("#refreshButton").disabled = value;
  document.querySelectorAll(".restart, .file-input").forEach((element) => { element.disabled = value; });
  globalStatus.textContent = text;
}

function renderHistory(history) {
  historyBody.replaceChildren();
  if (!history.length) {
    const row = document.createElement("tr");
    row.innerHTML = '<td colspan="5">Операций пока нет.</td>';
    historyBody.append(row);
    return;
  }
  for (const item of history.slice(0, 30)) {
    const row = document.createElement("tr");
    const version = item.fromVersion && item.toVersion && item.fromVersion !== item.toVersion
      ? `${item.fromVersion} → ${item.toVersion}`
      : (item.toVersion || item.fromVersion || "—");
    const result = item.status === "success" ? "Успешно" : `Ошибка: ${item.error || "неизвестно"}`;
    for (const value of [formatTime(item.finishedAt), item.displayName || item.projectId, operationLabel(item.action), version, result]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    historyBody.append(row);
  }
}

function servicesText(project) {
  const all = [...project.requiredServices, ...project.optionalServices.filter((item) => item.active || item.enabled)];
  return all.length ? all.map((item) => `${item.name.replace(/\.service$/, "")}: ${item.active ? "работает" : "остановлен"}`).join("; ") : "—";
}

function uploadPackage(project, file, card) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".zip")) {
    const message = card.querySelector(".message");
    message.className = "message error";
    message.textContent = "Выберите Project Control package с расширением .zip.";
    return;
  }
  const progress = card.querySelector(".progress");
  const bar = card.querySelector(".progress-bar");
  const text = card.querySelector(".progress-text");
  const message = card.querySelector(".message");
  progress.classList.remove("hidden");
  bar.style.width = "0%";
  text.textContent = "Загрузка 0%";
  message.className = "message";
  message.textContent = `Проверяю и устанавливаю ${file.name}…`;
  setBusy(true, `Обновляется ${project.displayName}. Не закрывайте вкладку до результата.`);
  const xhr = new XMLHttpRequest();
  xhr.open("POST", `/api/projects/${project.id}/update`);
  xhr.setRequestHeader("Authorization", `Bearer ${state.token}`);
  xhr.setRequestHeader("X-File-Name", file.name);
  xhr.setRequestHeader("Content-Type", "application/octet-stream");
  xhr.upload.onprogress = (event) => {
    if (!event.lengthComputable) return;
    const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
    bar.style.width = `${percent}%`;
    text.textContent = percent < 100 ? `Загрузка ${percent}%` : "Архив загружен. Идёт проверка и обновление…";
  };
  xhr.onload = async () => {
    let body = {};
    try { body = JSON.parse(xhr.responseText || "{}"); } catch {}
    if (xhr.status >= 200 && xhr.status < 300) {
      message.className = "message success";
      message.textContent = `Готово: активна версия ${body.operation?.toVersion || "обновлена"}.`;
      bar.style.width = "100%";
      text.textContent = "Обновление завершено";
    } else {
      message.className = "message error";
      message.textContent = body.error || `Ошибка HTTP ${xhr.status}`;
      text.textContent = "Обновление не выполнено";
    }
    setBusy(false);
    await refresh().catch(() => {});
  };
  xhr.onerror = () => {
    message.className = "message error";
    message.textContent = "Соединение с Project Control прервано.";
    text.textContent = "Ошибка соединения";
    setBusy(false);
  };
  xhr.send(file);
}

function renderProjects(projects) {
  grid.replaceChildren();
  for (const project of projects) {
    const card = template.content.firstElementChild.cloneNode(true);
    card.dataset.projectId = project.id;
    card.querySelector(".project-id").textContent = project.id;
    card.querySelector(".project-name").textContent = project.displayName;
    const pill = card.querySelector(".status-pill");
    if (!project.installed) {
      pill.textContent = "Не установлен";
      pill.classList.add("off");
    } else if (project.healthy) {
      pill.textContent = "Работает";
      pill.classList.add("ok");
    } else {
      pill.textContent = "Требует внимания";
      pill.classList.add("bad");
    }
    card.querySelector(".version").textContent = project.version || "—";
    card.querySelector(".updated").textContent = formatTime(project.lastUpdatedAt);
    card.querySelector(".services").textContent = servicesText(project);
    const zone = card.querySelector(".drop-zone");
    const input = card.querySelector(".file-input");
    const choose = () => input.click();
    zone.addEventListener("click", choose);
    zone.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(); } });
    input.addEventListener("change", () => uploadPackage(project, input.files?.[0], card));
    for (const name of ["dragenter", "dragover"]) zone.addEventListener(name, (event) => { event.preventDefault(); zone.classList.add("drag"); });
    for (const name of ["dragleave", "drop"]) zone.addEventListener(name, (event) => { event.preventDefault(); zone.classList.remove("drag"); });
    zone.addEventListener("drop", (event) => uploadPackage(project, event.dataTransfer?.files?.[0], card));
    const restart = card.querySelector(".restart");
    restart.disabled = !project.installed || state.busy;
    restart.addEventListener("click", async () => {
      const message = card.querySelector(".message");
      try {
        setBusy(true, `Перезапускается ${project.displayName}…`);
        message.className = "message";
        message.textContent = "Перезапуск и последующая проверка…";
        await api(`/api/projects/${project.id}/restart`, { method: "POST" });
        message.className = "message success";
        message.textContent = "Служба перезапущена, health-check пройден.";
      } catch (error) {
        message.className = "message error";
        message.textContent = error.message;
      } finally {
        setBusy(false);
        await refresh().catch(() => {});
      }
    });
    grid.append(card);
  }
}

async function refresh() {
  if (!state.token) return openKeyDialog();
  globalStatus.textContent = "Проверяю systemd, версии и health endpoints…";
  const data = await api("/api/projects");
  state.projects = data.projects;
  renderProjects(data.projects);
  renderHistory(data.history || []);
  securityBanner.classList.toggle("hidden", data.requireSignature);
  securityBanner.textContent = data.requireSignature
    ? ""
    : "Контроль цифровой подписи release package отключён. SHA-256 и native manifests проверяются, но для общего сегмента сети рекомендуется PROJECT_CONTROL_REQUIRE_SIGNATURE=true.";
  globalStatus.textContent = data.operationRunning ? "Выполняется системная операция." : `Проверено: ${formatTime(new Date().toISOString())}`;
}

document.querySelector("#refreshButton").addEventListener("click", () => refresh().catch((error) => { globalStatus.textContent = error.message; }));
document.querySelector("#changeKeyButton").addEventListener("click", openKeyDialog);
document.querySelector("#cancelKeyButton").addEventListener("click", () => keyDialog.close());
keyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const candidate = keyInput.value.trim();
  keyError.textContent = "";
  try {
    const response = await fetch("/api/session/check", { method: "POST", headers: { Authorization: `Bearer ${candidate}`, "Content-Type": "application/json" }, body: "{}" });
    if (!response.ok) throw new Error("Ключ не принят.");
    state.token = candidate;
    sessionStorage.setItem("projectControlToken", candidate);
    keyDialog.close();
    await refresh();
  } catch (error) {
    keyError.textContent = error.message;
  }
});

refresh().catch((error) => { globalStatus.textContent = error.message; });
