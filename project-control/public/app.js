const state = {
  token: sessionStorage.getItem("projectControlToken") || "",
  projects: [],
  busy: false,
  lastData: null
};

const scriptElement = [...document.scripts].find((script) => /(?:^|\/)app\.js(?:\?|$)/.test(script.src)) || document.scripts[document.scripts.length - 1];
const apiRoot = new URL("api/", scriptElement?.src || window.location.href);
const grid = document.querySelector("#projectGrid");
const template = document.querySelector("#projectTemplate");
const globalStatus = document.querySelector("#globalStatus");
const historyBody = document.querySelector("#historyBody");
const securityBanner = document.querySelector("#securityBanner");
const bootStatus = document.querySelector("#bootStatus");
const keyDialog = document.querySelector("#keyDialog");
const keyForm = document.querySelector("#keyForm");
const keyInput = document.querySelector("#accessKey");
const keyError = document.querySelector("#keyError");
const discoverySummary = document.querySelector("#discoverySummary");
const discoveryWarnings = document.querySelector("#discoveryWarnings");
const scanAge = document.querySelector("#scanAge");
const portList = document.querySelector("#portList");
const nginxList = document.querySelector("#nginxList");
const optList = document.querySelector("#optList");

function endpoint(relative = "") { return new URL(String(relative).replace(/^\/+/, ""), apiRoot).toString(); }
function authHeaders(extra = {}) { return { ...extra, Authorization: `Bearer ${state.token}` }; }
function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "medium" }).format(date);
}
function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} КиБ`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} МиБ`;
  return `${(bytes / 1024 ** 3).toFixed(1)} ГиБ`;
}
function operationLabel(value) { return ({ update: "Обновление", install: "Установка", restart: "Перезапуск" })[value] || value || "—"; }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function api(relative, options = {}) {
  const response = await fetch(endpoint(relative), { ...options, headers: authHeaders(options.headers || {}) });
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
function setBoot(kind, text) {
  bootStatus.className = `banner ${kind}`;
  bootStatus.textContent = text;
}
function setBusy(value, text = "") {
  state.busy = value;
  document.querySelector("#refreshButton").disabled = value;
  document.querySelector("#rescanButton").disabled = value;
  document.querySelectorAll(".file-input").forEach((element) => { element.disabled = value; });
  document.querySelectorAll(".restart").forEach((element) => {
    const projectId = element.closest(".project-card")?.dataset.projectId;
    const project = state.projects.find((item) => item.id === projectId);
    element.disabled = value || !project?.installed;
  });
  if (text) globalStatus.textContent = text;
}
function appendText(parent, className, text) {
  const item = document.createElement("div");
  if (className) item.className = className;
  item.textContent = text;
  parent.append(item);
  return item;
}

function renderHistory(history) {
  historyBody.replaceChildren();
  if (!history.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.textContent = "Операций пока нет.";
    row.append(cell);
    historyBody.append(row);
    return;
  }
  for (const item of history.slice(0, 30)) {
    const row = document.createElement("tr");
    const version = item.fromVersion && item.toVersion && item.fromVersion !== item.toVersion ? `${item.fromVersion} → ${item.toVersion}` : (item.toVersion || item.fromVersion || "—");
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
  const all = [...(project.requiredServices || []), ...(project.optionalServices || []).filter((item) => item.active || item.enabled)];
  return all.length ? all.map((item) => `${item.name.replace(/\.service$/, "")}: ${item.active ? "работает" : "остановлен"}`).join("; ") : "—";
}
function evidenceText(discovery) {
  if (!discovery?.evidence) return "нет признаков";
  const result = [];
  if (discovery.evidence.opt?.length) result.push("/opt");
  if (discovery.evidence.systemd?.length) result.push("systemd");
  if (discovery.evidence.ports?.length) result.push("TCP LISTEN");
  if (discovery.evidence.nginx?.length) result.push("nginx");
  return result.length ? result.join(", ") : "нет признаков";
}
function proxyText(discovery) {
  const routes = discovery?.nginxRoutes || [];
  if (!routes.length) return "—";
  return routes.slice(0, 3).map((route) => {
    const host = route.serverNames?.length ? route.serverNames.join(",") : "*";
    return `${host}${route.location || "/"} → ${route.proxyPass}`;
  }).join("; ");
}
function healthText(project) {
  const discovery = project.discovery || {};
  if (project.healthy) return `Health OK${project.health?.statusCode ? ` · HTTP ${project.health.statusCode}` : ""}`;
  if (discovery.runtimeHealthy) return `Работает по независимому сканированию · ${discovery.health?.statusCode ? `HTTP ${discovery.health.statusCode}` : "health OK"}`;
  if (!project.installed && project.detected) return "Обнаружены признаки проекта, но штатная установка Project Control не подтверждена.";
  if (!project.installed) return "Штатная установка не обнаружена. Можно установить готовый .f2re.zip.";
  if (project.health?.error) return `Health не прошёл: ${project.health.error}`;
  if (project.health?.statusCode) return `Health HTTP ${project.health.statusCode}`;
  const stopped = (project.requiredServices || []).filter((service) => !service.active).map((service) => service.name);
  return stopped.length ? `Не работают службы: ${stopped.join(", ")}` : "Состояние требует диагностики.";
}

function renderDiscovery(discovery, executorError = null) {
  discoverySummary.replaceChildren();
  discoveryWarnings.replaceChildren();
  portList.replaceChildren();
  nginxList.replaceChildren();
  optList.replaceChildren();
  const detected = state.projects.filter((project) => project.detected).length;
  const listeners = discovery?.listeningPorts || [];
  const nginxRoutes = discovery?.nginx?.routes || [];
  const optEntries = discovery?.opt?.entries || [];
  for (const [label, value, hint] of [
    ["Проекты", `${detected}/${state.projects.length}`, "обнаружены по фактическим признакам"],
    ["TCP LISTEN", String(listeners.length), "активных слушающих сокетов"],
    ["nginx", String(nginxRoutes.length), `proxy_pass в ${discovery?.nginx?.parsedFiles || 0} файлах`],
    ["/opt", String(optEntries.length), "каталогов просмотрено"]
  ]) {
    const card = document.createElement("div");
    card.className = "discovery-card";
    appendText(card, "discovery-label", label);
    appendText(card, "discovery-value", value);
    appendText(card, "quiet", hint);
    discoverySummary.append(card);
  }
  scanAge.textContent = discovery?.scannedAt ? `скан: ${formatTime(discovery.scannedAt)} · ${discovery.durationMs || 0} мс` : "";
  if (executorError) appendText(discoveryWarnings, "diagnostic error", `Root executor недоступен: ${executorError}. Сканирование хоста продолжает работать, но обновление и перезапуск недоступны.`);
  const diagnostics = discovery?.diagnostics || [];
  for (const value of diagnostics) appendText(discoveryWarnings, "diagnostic warning", value);
  if (!executorError && !diagnostics.length) appendText(discoveryWarnings, "diagnostic ok", "Сканирование завершено без внутренних ошибок.");

  document.querySelector("#portCount").textContent = listeners.length ? `(${listeners.length})` : "";
  for (const item of [...listeners].sort((a, b) => a.port - b.port).slice(0, 100)) appendText(portList, "compact-row", `${item.address}:${item.port}${item.process ? ` · ${item.process}${item.pid ? ` pid=${item.pid}` : ""}` : ""}`);
  if (!listeners.length) appendText(portList, "empty", "Слушающие TCP-порты не получены.");

  document.querySelector("#nginxCount").textContent = nginxRoutes.length ? `(${nginxRoutes.length})` : "";
  for (const route of nginxRoutes.slice(0, 100)) {
    const host = route.serverNames?.length ? route.serverNames.join(" ") : "*";
    const limit = route.clientMaxBodySize ? ` · body ${route.clientMaxBodySize}` : "";
    appendText(nginxList, "compact-row", `${host} ${route.location || "/"} → ${route.proxyPass}${limit} · ${route.file}:${route.line}`);
  }
  if (!nginxRoutes.length) appendText(nginxList, "empty", discovery?.nginx?.present ? "proxy_pass не найден." : "nginx-конфигурация не обнаружена.");

  document.querySelector("#optCount").textContent = optEntries.length ? `(${optEntries.length})` : "";
  for (const entry of optEntries.slice(0, 100)) {
    const details = [entry.currentTarget ? `current → ${entry.currentTarget}` : null, entry.version ? `v${entry.version}` : null, entry.projectHint ? `→ ${entry.projectHint}` : null].filter(Boolean).join(" · ");
    appendText(optList, "compact-row", `${entry.path}${details ? ` · ${details}` : ""}`);
  }
  if (!optEntries.length) appendText(optList, "empty", "В /opt ничего не удалось прочитать.");
}

async function pollJob(jobId, updateProgress) {
  const started = Date.now();
  for (let attempt = 0; attempt < 1800; attempt += 1) {
    const job = await api(`jobs/${jobId}`);
    if (job.status === "success") return job.result;
    if (job.status === "failed") throw new Error(job.error || "Установка завершилась ошибкой.");
    updateProgress(`Установка выполняется… ${Math.round((Date.now() - started) / 1000)} с`);
    await sleep(2000);
  }
  throw new Error("Превышено время ожидания операции обновления.");
}

async function uploadPackage(project, file, card) {
  if (!file || state.busy) return;
  const message = card.querySelector(".message");
  const progress = card.querySelector(".progress");
  const bar = card.querySelector(".progress-bar");
  const text = card.querySelector(".progress-text");
  if (!file.name.toLowerCase().endsWith(".zip")) {
    message.className = "message error";
    message.textContent = "Выберите Project Control package с расширением .f2re.zip / .zip.";
    return;
  }
  let uploadId = null;
  let applyStarted = false;
  try {
    setBusy(true, `Передаётся обновление ${project.displayName}…`);
    progress.classList.remove("hidden");
    bar.style.width = "0%";
    text.textContent = "Подготовка загрузки…";
    message.className = "message";
    message.textContent = `${file.name} · ${formatBytes(file.size)}`;
    const start = await api("uploads/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: project.id, fileName: file.name, size: file.size }) });
    uploadId = start.uploadId;
    const chunkBytes = start.chunkBytes || 512 * 1024;
    let offset = 0;
    let index = 0;
    while (offset < file.size) {
      const end = Math.min(file.size, offset + chunkBytes);
      await api(`uploads/${uploadId}/chunk`, { method: "PUT", headers: { "Content-Type": "application/octet-stream", "X-Chunk-Index": String(index) }, body: file.slice(offset, end) });
      offset = end;
      index += 1;
      bar.style.width = `${Math.round((offset / file.size) * 75)}%`;
      text.textContent = `Загрузка ${Math.round((offset / file.size) * 100)}%`;
    }
    text.textContent = "Файл получен. Запускаю проверку и установку…";
    bar.style.width = "80%";
    const queued = await api(`uploads/${uploadId}/complete`, { method: "POST" });
    applyStarted = true;
    message.textContent = `Операция ${queued.jobId.slice(0, 8)} запущена. Длительный nginx-запрос не используется.`;
    const result = await pollJob(queued.jobId, (label) => { text.textContent = label; bar.style.width = "90%"; });
    bar.style.width = "100%";
    text.textContent = "Обновление завершено";
    message.className = "message success";
    message.textContent = `Готово: активна версия ${result.operation?.toVersion || result.project?.version || "обновлена"}.`;
    await refresh(true);
  } catch (error) {
    message.className = "message error";
    message.textContent = error.message;
    text.textContent = "Обновление не выполнено";
    if (uploadId && !applyStarted) await api(`uploads/${uploadId}`, { method: "DELETE" }).catch(() => {});
    await refresh(true).catch(() => {});
  } finally { setBusy(false); }
}

function renderProjects(projects) {
  grid.replaceChildren();
  for (const project of projects) {
    const discovery = project.discovery || {};
    const observedWorking = Boolean(project.healthy || discovery.runtimeHealthy);
    const card = template.content.firstElementChild.cloneNode(true);
    card.dataset.projectId = project.id;
    card.querySelector(".project-id").textContent = project.id;
    card.querySelector(".project-name").textContent = project.displayName;
    const pill = card.querySelector(".status-pill");
    if (observedWorking) {
      pill.textContent = project.healthy ? "Работает" : "Работает · обнаружен";
      pill.classList.add("ok");
    } else if (project.installed || project.detected) {
      pill.textContent = project.installed ? "Требует внимания" : "Обнаружен";
      pill.classList.add("bad");
    } else {
      pill.textContent = "Не найден";
      pill.classList.add("off");
    }
    card.querySelector(".version").textContent = project.version || project.observedVersion || "—";
    card.querySelector(".install-path").textContent = project.release || discovery.detectedCurrentTarget || discovery.detectedPath || "—";
    card.querySelector(".port").textContent = discovery.configuredPort ? `${discovery.configuredPort}${discovery.listeners?.length ? " · LISTEN" : " · не слушается"}` : "—";
    card.querySelector(".proxy").textContent = proxyText(discovery);
    card.querySelector(".updated").textContent = formatTime(project.lastUpdatedAt);
    card.querySelector(".services").textContent = servicesText(project);
    card.querySelector(".evidence").textContent = evidenceText(discovery);
    const health = card.querySelector(".health-box");
    health.textContent = healthText(project);
    health.classList.toggle("ok", observedWorking);
    health.classList.toggle("bad", !observedWorking && (project.installed || project.detected));
    const warnings = card.querySelector(".project-warnings");
    const warningItems = [...(discovery.warnings || [])];
    if (project.lastFailure?.error) warningItems.unshift(`Последняя ошибка: ${project.lastFailure.error}`);
    if (!warningItems.length) warnings.classList.add("hidden");
    else for (const warning of warningItems.slice(0, 6)) appendText(warnings, "project-warning", warning);

    const zone = card.querySelector(".drop-zone");
    const input = card.querySelector(".file-input");
    const choose = () => { if (!state.busy && !input.disabled) input.click(); };
    zone.addEventListener("click", choose);
    zone.addEventListener("keydown", (event) => { if ((event.key === "Enter" || event.key === " ") && !state.busy) { event.preventDefault(); choose(); } });
    input.addEventListener("change", () => uploadPackage(project, input.files?.[0], card));
    for (const name of ["dragenter", "dragover"]) zone.addEventListener(name, (event) => { event.preventDefault(); if (!state.busy) zone.classList.add("drag"); });
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
        await api(`projects/${project.id}/restart`, { method: "POST" });
        message.className = "message success";
        message.textContent = "Служба перезапущена, health-check пройден.";
      } catch (error) {
        message.className = "message error";
        message.textContent = error.message;
      } finally {
        setBusy(false);
        await refresh(true).catch(() => {});
      }
    });
    grid.append(card);
  }
}

async function refresh(rescan = false) {
  if (!state.token) {
    setBoot("info", `JavaScript загружен. API base: ${apiRoot.pathname}. Введите ключ доступа.`);
    openKeyDialog();
    return;
  }
  globalStatus.textContent = rescan ? "Пересканирую /opt, systemd, порты и nginx…" : "Проверяю состояние проектов…";
  const data = await api(`projects${rescan ? "?rescan=1" : ""}`);
  state.lastData = data;
  state.projects = data.projects || [];
  renderProjects(state.projects);
  renderHistory(data.history || []);
  renderDiscovery(data.discovery || {}, data.executorError || null);
  securityBanner.classList.toggle("hidden", data.requireSignature !== false);
  securityBanner.textContent = data.requireSignature === false ? "Подпись release package необязательна. SHA-256 проверяется, но для общего сегмента сети рекомендуется PROJECT_CONTROL_REQUIRE_SIGNATURE=true." : "";
  setBoot(data.executorError ? "error" : "success", data.executorError ? `UI и discovery работают, но executor недоступен: ${data.executorError}` : `Интерфейс, API и executor работают · base ${apiRoot.pathname}`);
  if (!data.executorError) setTimeout(() => bootStatus.classList.add("hidden"), 2500);
  globalStatus.textContent = data.executorError ? "Сканирование доступно; системные операции заблокированы до восстановления executor." : (data.operationRunning ? "Executor выполняет системную операцию." : `Проверено: ${formatTime(data.discovery?.scannedAt || new Date().toISOString())}`);
}

function showFatal(error) {
  const text = error?.message || String(error);
  setBoot("error", `Ошибка интерфейса: ${text}. API: ${apiRoot.pathname}`);
  globalStatus.textContent = text;
}

window.addEventListener("error", (event) => showFatal(event.error || new Error(event.message)));
window.addEventListener("unhandledrejection", (event) => showFatal(event.reason || new Error("Необработанная ошибка Promise")));
document.querySelector("#refreshButton").addEventListener("click", () => refresh(false).catch(showFatal));
document.querySelector("#rescanButton").addEventListener("click", () => refresh(true).catch(showFatal));
document.querySelector("#changeKeyButton").addEventListener("click", openKeyDialog);
document.querySelector("#cancelKeyButton").addEventListener("click", () => keyDialog.close());
keyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const candidate = keyInput.value.trim();
  keyError.textContent = "";
  try {
    const response = await fetch(endpoint("session/check"), { method: "POST", headers: { Authorization: `Bearer ${candidate}`, "Content-Type": "application/json" }, body: "{}" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Ключ не принят.");
    state.token = candidate;
    sessionStorage.setItem("projectControlToken", candidate);
    keyDialog.close();
    await refresh(true);
  } catch (error) { keyError.textContent = error.message; }
});

setBoot("info", `JavaScript загружен · API base ${apiRoot.pathname}`);
refresh(true).catch(showFatal);
