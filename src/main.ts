import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { attachImeHeuristic } from "./ime-anchor";

interface Project { path: string; description: string; }
interface Workspace {
  id: string; name: string; description: string;
  agent: string | null; projects: Project[];
  files: Project[];
  links: Project[];
}
interface AgentInfo { key: string; label: string; }
interface Settings {
  defaultAgent: string | null;
  fontFamily: string | null;
  fontSize: number | null;
  fontWeight: number | null;
  language: string | null;
  sidebarWidth: number | null;
  theme: string | null;
  closeAction: string | null;
  launchMode: string | null;
}

type View =
  | { kind: "workspace"; id: string }
  | { kind: "create" }
  | { kind: "settings" }
  | { kind: "terminal"; id: string }
  | { kind: "agents" };

// ---------- i18n ----------
const DICT: Record<string, Record<string, string>> = {
  zh: {
    workspaces: "Work Spaces",
    newWorkspace: "新建 workspace",
    settings: "设置",
    back: "返回",
    noWorkspaceYet: "还没有 workspace",
    createTitle: "新建 workspace",
    createSubtitle: "一组项目目录 + 默认 agent + 上下文描述。",
    name: "名称",
    namePlaceholder: "例如 mga-utrace",
    defaultName: "untitled",
    description: "描述",
    descHint: "（注入为 agent 上下文）",
    descPlaceholder: "workspace描述（可选）",
    defaultAgent: "默认 agent",
    projects: "项目目录",
    addFolder: "+ 添加目录",
    addProject: "新增项目",
    addFile: "添加文件",
    addLink: "添加链接",
    links: "链接",
    removeLink: "移除链接",
    confirmRemoveLink: "从 workspace 移除该链接？",
    otherFiles: "其他文件",
    removeFile: "移除文件",
    confirmRemoveFile: "从 workspace 移除该文件？（不删除磁盘文件）",
    noFoldersYet: "还没加目录",
    create: "创建",
    cancel: "取消",
    projDescPlaceholder: "项目描述（可选）",
    settingsTitle: "设置",
    settingsSubtitle: "全局偏好，各 workspace 可覆盖 agent。",
    groupAgent: "Agent",
    groupAppearance: "外观",
    groupGeneral: "通用",
    groupAbout: "关于",
    dataDirName: "数据目录",
    dataDirHint: "workspaces.json 与 settings.json 所在位置",
    open: "打开",
    closeActionName: "关闭行为",
    closeActionHint: "点关闭按钮时隐藏到系统托盘；托盘菜单里可退出",
    closeMinimize: "最小化",
    closeExit: "退出",
    closeActionSet: "关闭行为设为",
    backupName: "备份",
    backupHint: "导出/导入 workspaces.json；导入前自动备份当前文件为 .bak",
    export: "导出",
    import: "导入",
    exported: "已导出",
    imported: "已导入",
    importFailed: "导入失败",
    importConfirm: "导入将覆盖当前全部 workspace（当前文件会先备份）。继续？",
    versionName: "版本",
    defaultAgentName: "默认 agent",
    defaultAgentHint: "启动 workspace 时使用的 coding agent",
    launchModeName: "启动方式",
    launchModeHint: "内置终端在标签页内嵌运行；cmd/PowerShell 开独立控制台窗口",
    launchModeEmbedded: "内置终端",
    launchModeCmd: "cmd 窗口",
    launchModePs: "PowerShell 窗口",
    launchModeSet: "启动方式设为",
    fontName: "字体",
    fontHint: "界面等宽字体（中文使用微软雅黑）",
    fontDefault: "默认",
    fontSizeName: "字号",
    fontSizeHint: "界面基础字号",
    fontSizeDefault: "默认（13）",
    fontWeightName: "字重",
    fontWeightHint: "界面文字粗细，字体不支持的字重会就近回退",
    fontWeightDefault: "默认（400）",
    themeName: "主题",
    themeHint: "界面配色方案",
    themeDark: "深色（默认）",
    themeLight: "浅色",
    themeDracula: "Dracula（吸血鬼）",
    themeSet: "主题设为",
    weightRegular: "常规",
    weightMedium: "中等",
    weightSemiBold: "半粗",
    weightBold: "粗体",
    languageName: "语言",
    languageHint: "界面显示语言",
    languageDefault: "跟随系统",
    noDescription: "无描述",
    projectCount: "项目",
    agent: "agent",
    launch: "启动",
    delete: "删除",
    notSet: "未设置",
    // status messages
    enterName: "请输入名称",
    created: "已创建",
    createFailed: "创建失败",
    defaultAgentSet: "默认 agent 设为",
    defaultAgentCleared: "已清除默认 agent",
    fontSet: "字体设为",
    fontReset: "字体恢复默认",
    fontSizeSet: "字号设为",
    fontSizeReset: "字号恢复默认",
    fontWeightSet: "字重设为",
    fontWeightReset: "字重恢复默认",
    languageSet: "语言已切换",
    agentUpdated: "已更新 agent",
    launching: "正在启动...",
    launched: "已启动",
    launchFailed: "启动失败",
    deleted: "已删除",
    addDescription: "添加描述",
    clickToEdit: "点击编辑",
    editDescription: "编辑描述",
    rename: "重命名",
    deleteWs: "删除 workspace",
    launchAction: "启动",
    confirmDelete: "确认删除？此操作不可撤销。",
    removeProject: "移除项目",
    confirmRemoveProject: "从 workspace 移除该目录？（不删除磁盘文件）",
    removed: "已移除",
    saved: "已保存",
    dropNoDirs: "拖入的内容里没有文件夹",
    undone: "已撤销",
    redone: "已恢复",
    nothingToUndo: "没有可撤销的操作",
    closeTab: "关闭标签页",
    pin: "固定",
    unpin: "取消固定",
    closeThis: "关闭",
    closeOthers: "关闭其他",
    closeAll: "全部关闭",
    agentsTab: "所有 agent",
    agentsTitle: "运行中的 agent",
    noAgents: "没有运行中的 agent",
    statusRunning: "运行中",
    statusExited: "已退出",
    workspaceTab: "工作区",
    statusPending: "待恢复",
    convTitle: "对话记录",
    convEmpty: "还没有对话",
  },
  en: {
    workspaces: "Work Spaces",
    newWorkspace: "New workspace",
    settings: "Settings",
    back: "Back",
    noWorkspaceYet: "No workspaces yet",
    createTitle: "New workspace",
    createSubtitle: "A set of project folders + default agent + context description.",
    name: "Name",
    namePlaceholder: "e.g. mga-utrace",
    defaultName: "untitled",
    description: "Description",
    descHint: "(injected as agent context)",
    descPlaceholder: "Workspace description (optional)",
    defaultAgent: "Default agent",
    projects: "Project folders",
    addFolder: "+ Add folder",
    addProject: "Add project",
    addFile: "Add file",
    addLink: "Add link",
    links: "Links",
    removeLink: "Remove link",
    confirmRemoveLink: "Remove this link from the workspace?",
    otherFiles: "Other files",
    removeFile: "Remove file",
    confirmRemoveFile: "Remove this file from the workspace? (the file on disk is not deleted)",
    noFoldersYet: "No folders added yet",
    create: "Create",
    cancel: "Cancel",
    projDescPlaceholder: "Project description (optional)",
    settingsTitle: "Settings",
    settingsSubtitle: "Global preferences. Each workspace can override the agent.",
    groupAgent: "Agent",
    groupAppearance: "Appearance",
    groupGeneral: "General",
    groupAbout: "About",
    dataDirName: "Data folder",
    dataDirHint: "Location of workspaces.json and settings.json",
    open: "Open",
    closeActionName: "Close behavior",
    closeActionHint: "Close button hides to the system tray; quit from the tray menu",
    closeMinimize: "Minimize",
    closeExit: "Quit",
    closeActionSet: "Close behavior set to",
    backupName: "Backup",
    backupHint: "Export/import workspaces.json; the current file is backed up to .bak before import",
    export: "Export",
    import: "Import",
    exported: "Exported",
    imported: "Imported",
    importFailed: "Import failed",
    importConfirm: "Importing replaces all current workspaces (the current file is backed up first). Continue?",
    versionName: "Version",
    defaultAgentName: "Default agent",
    defaultAgentHint: "The coding agent used when launching a workspace",
    launchModeName: "Launch mode",
    launchModeHint: "Embedded runs in a tab; cmd/PowerShell open a separate console window",
    launchModeEmbedded: "Embedded terminal",
    launchModeCmd: "cmd window",
    launchModePs: "PowerShell window",
    launchModeSet: "Launch mode set to",
    fontName: "Font",
    fontHint: "UI monospace font (CJK uses Microsoft YaHei)",
    fontDefault: "Default",
    fontSizeName: "Font size",
    fontSizeHint: "Base UI font size",
    fontSizeDefault: "Default (13)",
    fontWeightName: "Font weight",
    fontWeightHint: "UI text weight; unsupported weights fall back to the nearest",
    fontWeightDefault: "Default (400)",
    themeName: "Theme",
    themeHint: "UI color scheme",
    themeDark: "Dark (default)",
    themeLight: "Light",
    themeDracula: "Dracula",
    themeSet: "Theme set to",
    weightRegular: "Regular",
    weightMedium: "Medium",
    weightSemiBold: "SemiBold",
    weightBold: "Bold",
    languageName: "Language",
    languageHint: "UI display language",
    languageDefault: "Follow system",
    noDescription: "No description",
    projectCount: "Projects",
    agent: "agent",
    launch: "Launch",
    delete: "Delete",
    notSet: "not set",
    enterName: "Please enter a name",
    created: "Created",
    createFailed: "Create failed",
    defaultAgentSet: "Default agent set to",
    defaultAgentCleared: "Default agent cleared",
    fontSet: "Font set to",
    fontReset: "Font reset to default",
    fontSizeSet: "Font size set to",
    fontSizeReset: "Font size reset",
    fontWeightSet: "Font weight set to",
    fontWeightReset: "Font weight reset",
    languageSet: "Language switched",
    agentUpdated: "Agent updated",
    launching: "Launching...",
    launched: "Launched",
    launchFailed: "Launch failed",
    deleted: "Deleted",
    addDescription: "Add description",
    clickToEdit: "Click to edit",
    editDescription: "Edit description",
    rename: "Rename",
    deleteWs: "Delete workspace",
    launchAction: "Launch",
    confirmDelete: "Delete permanently? This cannot be undone.",
    removeProject: "Remove project",
    confirmRemoveProject: "Remove this folder from the workspace? (files on disk are not deleted)",
    removed: "Removed",
    saved: "Saved",
    dropNoDirs: "No folders in the drop",
    undone: "Undone",
    redone: "Redone",
    nothingToUndo: "Nothing to undo",
    closeTab: "Close tab",
    pin: "Pin",
    unpin: "Unpin",
    closeThis: "Close",
    closeOthers: "Close others",
    closeAll: "Close all",
    agentsTab: "All agents",
    agentsTitle: "Running agents",
    noAgents: "No running agents",
    statusRunning: "Running",
    statusExited: "Exited",
    statusPending: "Pending",
    workspaceTab: "Workspace",
    convTitle: "Conversation",
    convEmpty: "No messages yet",
  },
};

function lang(): "zh" | "en" {
  if (settings.language === "zh" || settings.language === "en") return settings.language;
  // follow system: navigator.language
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}
function t(key: string): string {
  return DICT[lang()][key] ?? DICT.en[key] ?? key;
}

let agents: AgentInfo[] = [];
let settings: Settings = { defaultAgent: null, fontFamily: null, fontSize: null, fontWeight: null, language: null, sidebarWidth: null, theme: null, closeAction: null, launchMode: null };
let appVersion = "";
let workspaces: Workspace[] = [];
let view: View = { kind: "settings" };
// where the settings page's back button returns to; null = nowhere to go back
let settingsReturn: View | null = null;
// where the agents tab toggles back to; null = not in the agents view
let agentsReturn: View | null = null;

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

let statusTimer: number | undefined;
function setStatus(msg: string, isErr = false) {
  const el = $("status");
  clearTimeout(statusTimer);
  if (!msg) {
    el.className = ""; // empty message = hide, not an empty pill
    return;
  }
  el.textContent = msg;
  el.className = "show" + (isErr ? " err" : "");
  statusTimer = window.setTimeout(() => (el.className = ""), 3000);
}

const agentLabel = (key: string | null) =>
  key ? agents.find((a) => a.key === key)?.label ?? key : "";

function agentOptions(selected: string | null, inheritLabel: string | null): string {
  // no inherit option: the list is agents only (settings' default-agent picker)
  const first = inheritLabel !== null ? `<option value="">${esc(inheritLabel)}</option>` : "";
  return (
    first +
    agents
      // the follow-default entry already displays the effective agent's name
      .filter((a) => inheritLabel === null || a.key !== settings.defaultAgent)
      .map((a) => `<option value="${a.key}" ${selected === a.key ? "selected" : ""}>${esc(a.label)}</option>`)
      .join("")
  );
}

// ---------- appearance ----------
function applyAppearance() {
  const root = document.documentElement;
  if (settings.theme) root.dataset.theme = settings.theme;
  else delete root.dataset.theme;
  // darken the Windows title bar to match (light theme keeps it light)
  invoke("set_titlebar_dark", { dark: settings.theme !== "light" });
  // live-update embedded terminals too (xterm supports runtime theme switch)
  const mono = getComputedStyle(root).getPropertyValue("--mono").trim();
  termSessions.forEach((sess) => {
    sess.term.options.theme = termTheme();
    if (mono) sess.term.options.fontFamily = mono;
    sess.term.options.fontSize = settings.fontSize ?? 13;
    sess.term.options.fontWeight = (settings.fontWeight ?? 400) as 400;
  });
  if (settings.fontSize) root.style.setProperty("--font-size", settings.fontSize + "px");
  else root.style.removeProperty("--font-size");
  if (settings.fontWeight) root.style.setProperty("--font-weight", String(settings.fontWeight));
  else root.style.removeProperty("--font-weight");
  const sidebar = document.querySelector(".sidebar") as HTMLElement;
  if (settings.sidebarWidth) {
    sidebar.style.width = settings.sidebarWidth + "px";
    sidebar.style.flex = `0 0 ${settings.sidebarWidth}px`;
  } else {
    sidebar.style.removeProperty("width");
    sidebar.style.removeProperty("flex");
  }
  if (settings.fontFamily) {
    // CJK falls back to YaHei (tight, proportional) before Maple Mono NF CN
    // (full-width mono); Maple last for its Nerd Font icons
    const stack = `"${settings.fontFamily}", Consolas, "Microsoft YaHei", "Maple Mono NF CN", monospace`;
    root.style.setProperty("--font", stack);
    root.style.setProperty("--mono", stack);
  } else {
    root.style.removeProperty("--font");
    root.style.removeProperty("--mono");
  }
}

async function patchSettings(patch: Partial<Settings>) {
  settings = { ...settings, ...patch };
  await invoke("save_settings", { settings });
  applyAppearance();
}

// ---------- drag reorder ----------
// suppress the click that follows a completed drag (pointerup fires click on the row)
let suppressClickUntil = 0;
// Pointer-Events-based row reorder (HTML5 drag & drop is mouse-only; this also
// covers touch). Mouse: press and move >4px. Touch: long-press 350ms first, so
// vertical scrolling still works. onMove(from, to) gets sibling indices and
// must persist + re-render.
function wireDragReorder(els: HTMLElement[], onMove: (from: number, to: number) => Promise<void>, onDelete?: (index: number) => Promise<void>, axis: "y" | "x" = "y") {
  const trash = () => document.getElementById("trashDrop");
  const overTrash = (x: number, y: number) => {
    const t = trash();
    if (!t || !onDelete) return false;
    const r = t.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };
  // Insertion point for a pointer y: count of rows whose vertical midpoint is
  // above y. Gap-immune (row margins never produce dead zones): top half of a
  // row targets its top edge, bottom half the edge below it; above the first
  // row → 0, below the last → els.length.
  const insertAt = (pos: number) => {
    let k = 0;
    for (let j = 0; j < els.length; j++) {
      const r = els[j].getBoundingClientRect();
      const mid = axis === "y" ? (r.top + r.bottom) / 2 : (r.left + r.right) / 2;
      if (pos > mid) k = j + 1;
    }
    return k;
  };
  const axisPos = (ev: PointerEvent) => (axis === "y" ? ev.clientY : ev.clientX);
  els.forEach((el, i) => {
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const isTouch = e.pointerType === "touch";
      if (!isTouch) e.preventDefault(); // mouse: suppress text selection while dragging
      const startX = e.clientX, startY = e.clientY;
      let dragging = false;
      const begin = () => {
        dragging = true;
        el.classList.add("dragging");
        el.setPointerCapture(e.pointerId);
        if (onDelete) trash()?.classList.add("show");
      };
      // touch enters drag mode only after a hold; moving earlier means scroll
      const timer = isTouch ? window.setTimeout(begin, 350) : 0;
      const onPointerMove = (ev: PointerEvent) => {
        if (!dragging) {
          const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
          if (isTouch) { if (dist > 10) cancel(); }
          else if (dist > 4) begin();
          return;
        }
        // indicator always follows the pointer, even over the row's current
        // position (visual feedback; the actual save below still skips no-ops)
        const onTrash = overTrash(ev.clientX, ev.clientY);
        trash()?.classList.toggle("drag-over", onTrash);
        const at = insertAt(axisPos(ev));
        els.forEach((x, j) => {
          x.classList.toggle("drag-over", !onTrash && at === j);
          x.classList.toggle("drag-over-end", !onTrash && at === els.length && j === els.length - 1);
        });
      };
      const onUp = async (ev: PointerEvent) => {
        cleanup();
        if (!dragging) return;
        suppressClickUntil = Date.now() + 300; // swallow the click after a drag
        el.classList.remove("dragging");
        els.forEach((x) => x.classList.remove("drag-over", "drag-over-end"));
        trash()?.classList.remove("show", "drag-over");
        if (overTrash(ev.clientX, ev.clientY)) {
          await onDelete!(i);
          return;
        }
        const at = insertAt(axisPos(ev));
        if (at === i || at === i + 1) return; // own top/bottom edge: no move
        // removal shifts later indices down by one
        await onMove(i, at > i ? at - 1 : at);
      };
      const cancel = () => {
        window.clearTimeout(timer);
        cleanup();
        dragging = false;
        el.classList.remove("dragging");
        els.forEach((x) => x.classList.remove("drag-over", "drag-over-end"));
        trash()?.classList.remove("show", "drag-over");
      };
      const cleanup = () => {
        window.clearTimeout(timer);
        el.removeEventListener("pointermove", onPointerMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", cancel);
      };
      el.addEventListener("pointermove", onPointerMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", cancel);
    });
  });
}

// ---------- sidebar ----------
function renderNav() {
  // viewing a terminal marks it read (single place: renderNav runs first in render)
  if (view.kind === "terminal") {
    const s = termSessions.get(Number((view as { id: string }).id));
    if (s) s.unread = false;
  }
  // static labels
  $("sidebarSection").textContent = t("workspaces");
  $("settingsLabel").textContent = t("settings");

  const nav = $("wsNav");
  nav.innerHTML = "";
  if (workspaces.length === 0) {
    nav.innerHTML = `<div style="padding:8px 10px;color:var(--text-faint);font-size:0.92rem;">${esc(t("noWorkspaceYet"))}</div>`;
  }
  const active = activeWsId();
  workspaces.forEach((ws) => {
    const item = document.createElement("div");
    item.className = "ws-nav-item" + (active === ws.id ? " active" : "");
    // status dot: yellow = an exited-but-unread agent (needs attention),
    // green = an agent is running
    const sessions = orderOf(ws.id).map((id) => termSessions.get(id)).filter((s) => s !== undefined);
    const hasUnread = sessions.some((s) => s.exited && s.unread);
    const hasRunning = sessions.some((s) => !s.exited);
    const dot = hasUnread ? `<span class="ws-dot unread"></span>` : hasRunning ? `<span class="ws-dot running"></span>` : "";
    item.innerHTML = `${dot}<span style="overflow:hidden;text-overflow:ellipsis;">${esc(ws.name)}</span><button class="ws-launch" title="${esc(t("launch"))}">▶</button>`;
    item.querySelector(".ws-launch")!.addEventListener("click", (e) => {
      e.stopPropagation(); // launch, not navigate
      launchWs(ws);
    });
    item.addEventListener("click", () => {
      if (Date.now() < suppressClickUntil) return; // just finished dragging, not a navigation click
      openWorkspace(ws.id); // last-used agent tab if any, else the project page
    });
    item.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showCtxMenu(e.clientX, e.clientY, [
        { label: t("launchAction"), onClick: () => launchWs(ws) },
        { label: t("editDescription"), onClick: () => { view = { kind: "workspace", id: ws.id }; render(); triggerWsDescEdit(); } },
        { label: t("rename"), onClick: () => renameWs(ws) },
        { label: t("deleteWs"), onClick: () => deleteWs(ws) },
      ]);
    });
    nav.appendChild(item);
  });
  wireDragReorder(
    Array.from(nav.querySelectorAll<HTMLElement>(".ws-nav-item")),
    async (from, to) => {
      const ids = workspaces.map((w) => w.id);
      ids.splice(to, 0, ...ids.splice(from, 1));
      workspaces = await invoke<Workspace[]>("reorder_workspaces", { orderedIds: ids });
      render();
    },
    (i) => deleteWs(workspaces[i])
  );
  $("settingsNav").classList.toggle("active", view.kind === "settings");
}

// custom titlebar (frameless window): drag via data-tauri-drag-region,
// double-click toggles maximize (allow-internal-toggle-maximize is in core:default)
$("tbMin").addEventListener("click", () => getCurrentWebviewWindow().minimize());
$("tbMax").addEventListener("click", () => getCurrentWebviewWindow().toggleMaximize());
$("tbClose").addEventListener("click", () => getCurrentWebviewWindow().close()); // our close handler applies the close-action setting
// swap the maximize icon for a restore icon while maximized
const appWin = getCurrentWebviewWindow();
const syncMaxIcon = async () => { $("tbMax").textContent = (await appWin.isMaximized()) ? "❐" : "▢"; };
appWin.onResized(() => syncMaxIcon());
syncMaxIcon();
// logo/title returns home: first workspace, or settings when there are none
document.querySelector(".sidebar-head")!.addEventListener("click", () => {
  if (workspaces.length) {
    ensureTab(workspaces[0].id);
    view = { kind: "workspace", id: workspaces[0].id };
  } else {
    view = { kind: "settings" };
  }
  render();
});
// right-click empty area of the workspace list: new workspace
$("wsNav").addEventListener("contextmenu", (e) => {
  e.preventDefault();
  showCtxMenu(e.clientX, e.clientY, [
    { label: t("newWorkspace"), onClick: () => { view = { kind: "create" }; render(); } },
  ]);
});
$("settingsNav").addEventListener("click", () => {
  if (view.kind !== "settings") settingsReturn = view;
  view = { kind: "settings" };
  render();
});

// ---------- main router ----------
function tabbarHtml(): string {
  if (!openTabs.length) return "";
  const activeTop =
    view.kind === "workspace"
      ? `ws:${(view as { id: string }).id}`
      : view.kind === "terminal"
        ? `ws:${termSessions.get(Number((view as { id: string }).id))?.wsId ?? ""}`
        : view.kind === "agents"
          ? "agents"
          : null;
  const running = [...termSessions.values()].filter((s) => !s.exited).length;
  const tabs = openTabs
    .map((tb) => {
      const name = workspaces.find((w) => w.id === tb.wsId)?.name ?? "?";
      const tail = tb.pinned
        ? `<span class="tab-close tab-pin" data-toppin="${tb.key}" title="${esc(t("unpin"))}">📌</span>`
        : `<span class="tab-close" data-topclose="${tb.key}" title="${esc(t("closeTab"))}">✕</span>`;
      return `<div class="tab${tb.key === activeTop ? " active" : ""}${tb.pinned ? " pinned" : ""}" data-tab="${tb.key}"><span class="tab-label">${esc(name)}</span>${tail}</div>`;
    })
    .join("");
  return `<div class="tabbar">${tabs}<div class="tab tab-agents${view.kind === "agents" ? " active" : ""}" data-tab="agents"><span class="tab-label">⚡ ${esc(t("agentsTab"))}${running ? ` (${running})` : ""}</span></div></div>`;
}
// sub-tab bar: the active workspace's project page + terminal sessions
function subTabbarHtml(wsId: string): string {
  const ids = orderOf(wsId);
  const activeId = view.kind === "terminal" ? Number((view as { id: string }).id) : null;
  const projActive = view.kind === "workspace" && (view as { id: string }).id === wsId;
  const seen = new Map<string, number>();
  const projTab = `<div class="tab subtab-proj${projActive ? " active" : ""}" data-subproj="${wsId}"><span class="tab-label">🗂️ ${esc(t("workspaceTab"))}</span></div>`;
  const terms = ids
    .map((tid) => {
      const s = termSessions.get(tid);
      if (!s) return "";
      const n = (seen.get(s.agentKey) ?? 0) + 1;
      seen.set(s.agentKey, n);
      const label = `&gt;_ ${esc(agentLabel(s.agentKey))}${n > 1 ? ` ${n}` : ""}${s.exited ? ` (${esc(t("statusExited"))})` : ""}`;
      const tail = s.pinned
        ? `<span class="tab-close tab-pin" data-subpin="${tid}" title="${esc(t("unpin"))}">📌</span>`
        : `<span class="tab-close" data-subclose="${tid}" title="${esc(t("closeTab"))}">✕</span>`;
      return `<div class="tab${tid === activeId ? " active" : ""}${s.exited ? " exited" : ""}" data-subtab="${tid}"><span class="tab-label">${label}</span>${tail}</div>`;
    })
    .join("");
  return `<div class="tabbar subtabbar">${projTab}${terms}</div>`;
}

function wireSubTabbar(wsId: string) {
  const projEl = document.querySelector<HTMLElement>("[data-subproj]");
  projEl?.addEventListener("click", () => {
    view = { kind: "workspace", id: wsId };
    render();
  });
  const els = Array.from(document.querySelectorAll<HTMLElement>(".subtabbar .tab[data-subtab]"));
  wireDragReorder(els, async (from, to) => {
    const order = orderOf(wsId);
    order.splice(to, 0, ...order.splice(from, 1));
    render();
  }, undefined, "x");
  els.forEach((el) => {
    const tid = Number(el.dataset.subtab);
    el.addEventListener("click", (e) => {
      if (Date.now() < suppressClickUntil) return;
      if ((e.target as HTMLElement).closest(".tab-close, .tab-pin")) return;
      lastTermByWs.set(wsId, tid);
      view = { kind: "terminal", id: String(tid) };
      render();
    });
    el.addEventListener("auxclick", (e) => {
      if (e.button === 1) closeSubTabs(wsId, [tid]);
    });
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const s = termSessions.get(tid);
      if (!s) return;
      showCtxMenu(e.clientX, e.clientY, [
        { label: t(s.pinned ? "unpin" : "pin"), onClick: () => pinSubTab(wsId, tid) },
        ...(!s.pinned ? [{ label: t("closeThis"), onClick: () => closeSubTabs(wsId, [tid]) }] : []),
        { label: t("closeOthers"), onClick: () => closeSubTabs(wsId, orderOf(wsId).filter((id) => id !== tid && !termSessions.get(id)?.pinned)) },
        { label: t("closeAll"), onClick: () => closeSubTabs(wsId, orderOf(wsId).filter((id) => !termSessions.get(id)?.pinned)) },
      ]);
    });
  });
  document.querySelectorAll<HTMLElement>("[data-subclose]").forEach((el) =>
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      closeSubTabs(wsId, [Number((el as HTMLElement).dataset.subclose)]);
    })
  );
  document.querySelectorAll<HTMLElement>("[data-subpin]").forEach((el) =>
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      pinSubTab(wsId, Number((el as HTMLElement).dataset.subpin));
    })
  );
}

// open a workspace: an exited-but-unread agent first, then the most recently
// used one, else the project page
function openWorkspace(wsId: string) {
  ensureTab(wsId);
  const order = orderOf(wsId);
  const unread = order.map((id) => termSessions.get(id)).find((s) => s && s.exited && s.unread);
  const last = lastTermByWs.get(wsId) ?? (order.length ? order[order.length - 1] : undefined);
  const target = unread?.id ?? last;
  view = target !== undefined && termSessions.has(target) ? { kind: "terminal", id: String(target) } : { kind: "workspace", id: wsId };
  render();
}
function wireTabbar() {
  const tabEls = Array.from(document.querySelectorAll<HTMLElement>(".tab[data-tab]"));
  // workspace tabs are drag-reorderable; the agents tab is fixed at the end
  wireDragReorder(tabEls.filter((el) => el.dataset.tab !== "agents"), async (from, to) => {
    openTabs.splice(to, 0, ...openTabs.splice(from, 1));
    render();
  }, undefined, "x");
  tabEls.forEach((el) => {
    const key = el.dataset.tab!;
    el.addEventListener("click", () => {
      if (Date.now() < suppressClickUntil) return; // trailing click after a drag
      if (key === "agents") {
        // toggle: clicking again returns to wherever we were
        if (view.kind === "agents") {
          view = agentsReturn ?? fallbackView();
          agentsReturn = null;
        } else {
          agentsReturn = view;
          view = { kind: "agents" };
        }
      } else {
        openWorkspace(key.slice(3)); // same as sidebar: last-used agent if any
      }
      render();
    });
    if (key === "agents") return; // fixed aggregate tab: no close/pin
    el.addEventListener("auxclick", (e) => {
      if (e.button === 1) closeTopTab(key); // middle click
    });
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const tb = openTabs.find((x) => x.key === key);
      if (!tb) return;
      showCtxMenu(e.clientX, e.clientY, [
        { label: t(tb.pinned ? "unpin" : "pin"), onClick: () => pinTopTab(key) },
        ...(!tb.pinned ? [{ label: t("closeThis"), onClick: () => closeTopTab(key) }] : []),
        { label: t("closeOthers"), onClick: () => closeOtherTopTabs(key) },
        { label: t("closeAll"), onClick: () => closeAllTopTabs() },
      ]);
    });
  });
  document.querySelectorAll<HTMLElement>("[data-topclose]").forEach((el) =>
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTopTab((el as HTMLElement).dataset.topclose!);
    })
  );
  document.querySelectorAll<HTMLElement>("[data-toppin]").forEach((el) =>
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      pinTopTab((el as HTMLElement).dataset.toppin!);
    })
  );
}
let convBarWidth = 220; // session-scoped; drag the handle to resize

function terminalHtml(): string {
  return `<div class="term-wrap"><div class="term-host" id="termHost"></div><div class="conv-resize" id="convResize"></div><div class="conv-bar" id="convBar" style="width:${convBarWidth}px"></div></div>`;
}

// aggregate view: every live/exited terminal session across workspaces
function agentsHtml(): string {
  const rows = [...termSessions.values()]
    .sort((a, b) => a.id - b.id)
    .map((s) => {
      const wsName = workspaces.find((w) => w.id === s.wsId)?.name ?? "?";
      return `<div class="proj-item agent-row" data-term-open="${s.id}">
        <span class="ico">&gt;_</span>
        <span class="p">${esc(agentLabel(s.agentKey))}<span class="agent-ws"> · ${esc(wsName)}</span></span>
        <span class="d" style="color:${!s.spawned || s.exited ? "var(--text-faint)" : "var(--green)"};">${esc(t(!s.spawned ? "statusPending" : s.exited ? "statusExited" : "statusRunning"))}</span>
        <span class="tab-close" data-term-close="${s.id}" title="${esc(t("closeTab"))}">✕</span>
      </div>`;
    })
    .join("");
  return `
    <div class="main-head"><h1>${esc(t("agentsTitle"))}</h1></div>
    <div class="card">${rows || `<div class="proj-empty">${esc(t("noAgents"))}</div>`}</div>`;
}

function wireAgents() {
  document.querySelectorAll("[data-term-open]").forEach((el) =>
    el.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("[data-term-close]")) return;
      view = { kind: "terminal", id: (el as HTMLElement).dataset.termOpen! };
      render();
    })
  );
  document.querySelectorAll("[data-term-close]").forEach((el) =>
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const tid = Number((el as HTMLElement).dataset.termClose);
      const s = termSessions.get(tid);
      if (s) closeSubTabs(s.wsId, [tid]);
    })
  );
}

function wireTerminal(termId: number) {
  const sess = termSessions.get(termId);
  if (!sess) return;
  const host = $("termHost");
  if (sess.el.parentElement !== host) host.appendChild(sess.el);
  renderConvBar(sess);
  if (sess.spawned) {
    if (sess.el.clientWidth > 0 && sess.el.clientHeight > 0) sess.fit.fit();
  } else {
    startTerminal(sess); // first activation: open xterm + spawn/resume the PTY
  }
  // conversation bar width: drag the handle at its left edge
  const handle = $("convResize");
  handle?.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const right = handle.parentElement!.getBoundingClientRect().right;
      convBarWidth = Math.min(400, Math.max(140, Math.round(right - ev.clientX)));
      $("convBar").style.width = convBarWidth + "px";
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  });
}

// conversation bar: every prompt the user submitted in this terminal; click
// scrolls the buffer to it (recorded line, with a text-search fallback since
// TUI redraws shift lines)
// conversation bar: every prompt the user submitted in this terminal; click
// scrolls the buffer to it (recorded line, with a text-search fallback since
// TUI redraws shift lines)
function renderConvBar(sess: TermSession) {
  const bar = $("convBar");
  if (!bar) return;
  bar.innerHTML = `<div class="conv-head">${esc(t("convTitle"))}</div>` +
    (sess.entries.length
      ? sess.entries.map((en, i) => `<div class="conv-item" data-conv="${i}" title="${esc(en.text)}"><span class="t">${new Date(en.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span> ${esc(en.text)}</div>`).join("")
      : `<div class="conv-empty">${esc(t("convEmpty"))}</div>`);
  bar.querySelectorAll<HTMLElement>("[data-conv]").forEach((el) =>
    el.addEventListener("click", () => {
      const entry = sess.entries[Number(el.dataset.conv)];
      const buf = sess.term.buffer.active;
      let target = Math.min(entry.line, buf.length - 1);
      const there = buf.getLine(target)?.translateToString().trim() ?? "";
      if (!there.includes(entry.text.slice(0, 20))) {
        target = -1;
        for (let i = buf.length - 1; i >= 0; i--) {
          const l = buf.getLine(i)?.translateToString().trim() ?? "";
          // the input echo line starts with the prompt; TUI picker titles
          // merely contain it (that's what sent jumps to the top)
          if (l === entry.text || l.startsWith(entry.text) || (entry.text.length >= 12 && l.includes(entry.text.slice(0, 24)))) {
            target = i;
            break;
          }
        }
      }
      if (target >= 0) sess.term.scrollToLine(target);
      else sess.term.scrollToBottom();
    })
  );
  bar.scrollTop = bar.scrollHeight; // latest at the bottom, scrolled into view
}
function renderMain() {
  const main = $("main");
  let content: string;
  let wire: () => void = () => {};
  let subFor: string | null = null; // workspace whose sub-tabs are shown
  if (view.kind === "create") {
    content = createFormHtml();
    wire = wireCreateForm;
  } else if (view.kind === "settings") {
    content = settingsHtml();
    wire = wireSettings;
  } else if (view.kind === "agents") {
    content = agentsHtml();
    wire = wireAgents;
  } else if (view.kind === "terminal") {
    const termId = Number(view.id);
    const sess = termSessions.get(termId);
    if (!sess) {
      view = fallbackView();
      renderMain();
      return;
    }
    subFor = sess.wsId;
    content = terminalHtml();
    wire = () => wireTerminal(termId);
  } else {
    const ws = workspaces.find((w) => w.id === (view as { id: string }).id);
    if (!ws) {
      view = fallbackView();
      renderMain();
      return;
    }
    subFor = ws.id;
    content = workspaceDetailHtml(ws);
    wire = () => wireWorkspaceDetail(ws);
  }
  const flush = view.kind === "terminal";
  main.innerHTML = `${tabbarHtml()}${subFor ? subTabbarHtml(subFor) : ""}<div class="content-wrap${flush ? " content-flush" : ""}">${content}</div>`;
  wireTabbar();
  if (subFor) wireSubTabbar(subFor);
  wire();
}
// ---------- settings page ----------
function settingsHtml(): string {
  const fonts = ["Consolas", "Maple Mono NF CN", "Cascadia Code", "JetBrains Mono", "Microsoft YaHei"];
  const fontOpts = `<option value="">${esc(t("fontDefault"))}</option>` +
    fonts.map((f) => `<option value="${f}" ${settings.fontFamily === f ? "selected" : ""}>${f}</option>`).join("");
  const sizes = [11, 12, 13, 14, 15, 16];
  const sizeOpts = `<option value="">${esc(t("fontSizeDefault"))}</option>` +
    sizes.map((s) => `<option value="${s}" ${settings.fontSize === s ? "selected" : ""}>${s}px</option>`).join("");
  const weights: [number, string][] = [[400, "weightRegular"], [500, "weightMedium"], [600, "weightSemiBold"], [700, "weightBold"]];
  const weightOpts = `<option value="">${esc(t("fontWeightDefault"))}</option>` +
    weights.map(([w, k]) => `<option value="${w}" ${settings.fontWeight === w ? "selected" : ""}>${esc(t(k))} (${w})</option>`).join("");
  const themeOpts = `<option value="">${esc(t("themeDark"))}</option>` +
    [["light", t("themeLight")], ["dracula", t("themeDracula")]]
      .map(([v, label]) => `<option value="${v}" ${settings.theme === v ? "selected" : ""}>${esc(label)}</option>`).join("");
  const langOpts = `<option value="">${esc(t("languageDefault"))}</option>` +
    `<option value="zh" ${settings.language === "zh" ? "selected" : ""}>简体中文</option>` +
    `<option value="en" ${settings.language === "en" ? "selected" : ""}>English</option>`;
  const backBtn = settingsReturn
    ? `<button class="btn btn-ghost btn-sm" id="backBtn" style="margin-bottom:10px;">← ${esc(t("back"))}</button>`
    : "";
  return `
    <div class="main-head">${backBtn}<h1>${esc(t("settingsTitle"))}</h1><p>${esc(t("settingsSubtitle"))}</p></div>

    <div class="settings-group">
      <h2 class="settings-group-title">${esc(t("groupGeneral"))}</h2>
      <div class="setting-row">
        <div class="setting-label">
          <div class="name">${esc(t("languageName"))}</div>
          <div class="hint">${esc(t("languageHint"))}</div>
        </div>
        <div class="setting-control"><select id="setLanguage">${langOpts}</select></div>
      </div>
      <div class="setting-row">
        <div class="setting-label">
          <div class="name">${esc(t("dataDirName"))}</div>
          <div class="hint">${esc(t("dataDirHint"))}</div>
        </div>
        <div class="setting-control"><button class="btn" id="openDataDirBtn">${esc(t("open"))}</button></div>
      </div>
      <div class="setting-row">
        <div class="setting-label">
          <div class="name">${esc(t("closeActionName"))}</div>
          <div class="hint">${esc(t("closeActionHint"))}</div>
        </div>
        <div class="setting-control"><select id="setCloseAction">
          <option value="">${esc(t("closeMinimize"))}</option>
          <option value="exit" ${settings.closeAction === "exit" ? "selected" : ""}>${esc(t("closeExit"))}</option>
        </select></div>
      </div>
      <div class="setting-row">
        <div class="setting-label">
          <div class="name">${esc(t("backupName"))}</div>
          <div class="hint">${esc(t("backupHint"))}</div>
        </div>
        <div class="setting-control" style="display:flex;gap:6px;">
          <button class="btn" id="exportBtn">${esc(t("export"))}</button>
          <button class="btn" id="importBtn">${esc(t("import"))}</button>
        </div>
      </div>
    </div>

    <div class="settings-group">
      <h2 class="settings-group-title">${esc(t("groupAgent"))}</h2>
      <div class="setting-row">
        <div class="setting-label">
          <div class="name">${esc(t("defaultAgentName"))}</div>
          <div class="hint">${esc(t("defaultAgentHint"))}</div>
        </div>
        <div class="setting-control">
          <select id="setDefaultAgent">${agentOptions(settings.defaultAgent, null)}</select>
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-label">
          <div class="name">${esc(t("launchModeName"))}</div>
          <div class="hint">${esc(t("launchModeHint"))}</div>
        </div>
        <div class="setting-control"><select id="setLaunchMode">
          <option value="">${esc(t("launchModeEmbedded"))}</option>
          <option value="cmd" ${settings.launchMode === "cmd" ? "selected" : ""}>${esc(t("launchModeCmd"))}</option>
          <option value="powershell" ${settings.launchMode === "powershell" ? "selected" : ""}>${esc(t("launchModePs"))}</option>
        </select></div>
      </div>
    </div>

    <div class="settings-group">
      <h2 class="settings-group-title">${esc(t("groupAppearance"))}</h2>
      <div class="setting-row">
        <div class="setting-label">
          <div class="name">${esc(t("themeName"))}</div>
          <div class="hint">${esc(t("themeHint"))}</div>
        </div>
        <div class="setting-control"><select id="setTheme">${themeOpts}</select></div>
      </div>
      <div class="setting-row">
        <div class="setting-label">
          <div class="name">${esc(t("fontName"))}</div>
          <div class="hint">${esc(t("fontHint"))}</div>
        </div>
        <div class="setting-control"><select id="setFont">${fontOpts}</select></div>
      </div>
      <div class="setting-row">
        <div class="setting-label">
          <div class="name">${esc(t("fontSizeName"))}</div>
          <div class="hint">${esc(t("fontSizeHint"))}</div>
        </div>
        <div class="setting-control"><select id="setFontSize">${sizeOpts}</select></div>
      </div>
      <div class="setting-row">
        <div class="setting-label">
          <div class="name">${esc(t("fontWeightName"))}</div>
          <div class="hint">${esc(t("fontWeightHint"))}</div>
        </div>
        <div class="setting-control"><select id="setFontWeight">${weightOpts}</select></div>
      </div>
    </div>

    <div class="settings-group">
      <h2 class="settings-group-title">${esc(t("groupAbout"))}</h2>
      <div class="setting-row">
        <div class="setting-label">
          <div class="name">workspacer</div>
          <div class="hint">${esc(t("versionName"))} ${esc(appVersion)}</div>
        </div>
      </div>
    </div>`;
}

function wireSettings() {
  if (settingsReturn) {
    $("backBtn").addEventListener("click", () => {
      const v: View = settingsReturn!;
      settingsReturn = null;
      view = v;
      render();
    });
  }
  $("setDefaultAgent").addEventListener("change", async (e) => {
    const val = (e.target as HTMLSelectElement).value || null;
    await patchSettings({ defaultAgent: val });
    setStatus(val ? `${t("defaultAgentSet")} ${agentLabel(val)}` : t("defaultAgentCleared"));
  });
  $("setLaunchMode").addEventListener("change", async (e) => {
    const sel = e.target as HTMLSelectElement;
    await patchSettings({ launchMode: sel.value || null });
    setStatus(`${t("launchModeSet")} ${sel.selectedOptions[0]?.textContent ?? ""}`);
  });
  $("setFont").addEventListener("change", async (e) => {
    const val = (e.target as HTMLSelectElement).value || null;
    await patchSettings({ fontFamily: val });
    setStatus(val ? `${t("fontSet")} ${val}` : t("fontReset"));
  });
  $("setFontSize").addEventListener("change", async (e) => {
    const v = (e.target as HTMLSelectElement).value;
    await patchSettings({ fontSize: v ? Number(v) : null });
    setStatus(v ? `${t("fontSizeSet")} ${v}px` : t("fontSizeReset"));
  });
  $("setFontWeight").addEventListener("change", async (e) => {
    const v = (e.target as HTMLSelectElement).value;
    await patchSettings({ fontWeight: v ? Number(v) : null });
    setStatus(v ? `${t("fontWeightSet")} ${v}` : t("fontWeightReset"));
  });
  $("setTheme").addEventListener("change", async (e) => {
    const sel = e.target as HTMLSelectElement;
    await patchSettings({ theme: sel.value || null });
    setStatus(`${t("themeSet")} ${sel.selectedOptions[0]?.textContent ?? ""}`);
  });
  $("openDataDirBtn").addEventListener("click", () => invoke("open_data_dir"));
  $("setCloseAction").addEventListener("change", async (e) => {
    const sel = e.target as HTMLSelectElement;
    await patchSettings({ closeAction: sel.value || null });
    setStatus(`${t("closeActionSet")} ${sel.selectedOptions[0]?.textContent ?? ""}`);
  });
  $("exportBtn").addEventListener("click", async () => {
    const path = await save({ defaultPath: "workspaces.json", filters: [{ name: "JSON", extensions: ["json"] }] });
    if (!path) return;
    try {
      await invoke("export_workspaces", { path });
      setStatus(t("exported"));
    } catch (err) { setStatus(`${err}`, true); }
  });
  $("importBtn").addEventListener("click", async () => {
    const path = await open({ filters: [{ name: "JSON", extensions: ["json"] }] });
    if (!path || Array.isArray(path)) return;
    const ok = await modal({ title: t("import"), body: t("importConfirm"), okLabel: t("import"), danger: true });
    if (ok === null) return;
    try {
      workspaces = await invoke<Workspace[]>("import_workspaces", { path });
      setStatus(t("imported"));
      render();
    } catch (err) { setStatus(`${t("importFailed")}：${err}`, true); }
  });
  $("setLanguage").addEventListener("change", async (e) => {
    const v = (e.target as HTMLSelectElement).value || null;
    await patchSettings({ language: v });
    setStatus(t("languageSet"));
    render(); // re-render to apply new language everywhere
  });
}

// ---------- create form ----------
let pending: Project[] = [];

function createFormHtml(): string {
  return `
    <div class="main-head"><h1>${esc(t("createTitle"))}</h1><p>${esc(t("createSubtitle"))}</p></div>
    <div class="card">
      <div class="field"><label>${esc(t("name"))}</label><input type="text" id="wsName" value="${esc(t("defaultName"))}" placeholder="${esc(t("namePlaceholder"))}" /></div>
      <div class="field"><label>${esc(t("description"))} <span style="color:var(--text-faint);">${esc(t("descHint"))}</span></label>
        <textarea id="wsDesc" placeholder="${esc(t("descPlaceholder"))}"></textarea></div>
      <div class="field"><label>${esc(t("defaultAgent"))}</label><select id="wsAgent">${agentOptions(null, agentLabel(settings.defaultAgent) || t("notSet"))}</select></div>
      <div class="field">
        <label>${esc(t("projects"))}</label>
        <div id="projRows"></div>
        <button class="btn btn-ghost btn-sm" id="addFolderBtn" style="margin-top:6px;">${esc(t("addFolder"))}</button>
      </div>
      <div style="margin-top:18px;display:flex;gap:8px;">
        <button class="btn btn-primary" id="createBtn">${esc(t("create"))}</button>
        <button class="btn btn-ghost" id="cancelBtn">${esc(t("cancel"))}</button>
      </div>
    </div>`;
}

function renderProjRows() {
  const el = $("projRows");
  if (!el) return;
  el.innerHTML = "";
  if (pending.length === 0) { el.innerHTML = `<div class="proj-empty">${esc(t("noFoldersYet"))}</div>`; return; }
  pending.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "proj-row";
    row.innerHTML = `
      <div class="path" title="${esc(p.path)}">${esc(p.path)}</div>
      <input type="text" placeholder="${esc(t("projDescPlaceholder"))}" data-desc="${i}" value="${esc(p.description)}" />
      <button class="btn btn-danger btn-sm" data-rm="${i}">✕</button>`;
    el.appendChild(row);
  });
}

function wireCreateForm() {
  pending = [];
  renderProjRows();
  const nameInput = $("wsName") as HTMLInputElement;
  nameInput.focus();
  nameInput.select(); // pre-filled "untitled": typing replaces it
  $("projRows").addEventListener("input", (e) => {
    const t2 = e.target as HTMLInputElement;
    if (t2.dataset.desc !== undefined) pending[Number(t2.dataset.desc)].description = t2.value;
  });
  $("projRows").addEventListener("click", (e) => {
    const t2 = (e.target as HTMLElement).closest("[data-rm]") as HTMLElement;
    if (t2) { pending.splice(Number(t2.dataset.rm), 1); renderProjRows(); }
  });
  $("addFolderBtn").addEventListener("click", async () => {
    // native dialog via tauri-plugin-dialog: instant (no powershell spawn) and
    // parented to our window (ownerless FolderBrowserDialog opened behind us)
    const picked = await open({ directory: true, multiple: true });
    const paths = picked ? (Array.isArray(picked) ? picked : [picked]) : [];
    paths.forEach((p) => { if (!pending.some((x) => x.path === p)) pending.push({ path: p, description: "" }); });
    renderProjRows();
  });
  $("cancelBtn").addEventListener("click", () => {
    view = fallbackView();
    render();
  });
  $("createBtn").addEventListener("click", async () => {
    const name = ($("wsName") as HTMLInputElement).value.trim();
    const description = ($("wsDesc") as HTMLTextAreaElement).value.trim();
    const agent = ($("wsAgent") as HTMLSelectElement).value || null;
    if (!name) { setStatus(t("enterName"), true); return; }
    try {
      const ws = await invoke<Workspace>("create_workspace", { name, description, agent, projects: [...pending] });
      setStatus(`${t("created")} "${ws.name}"`);
      await reload();
      ensureTab(ws.id);
      view = { kind: "workspace", id: ws.id };
      render();
    } catch (err) { setStatus(`${t("createFailed")}：${err}`, true); }
  });
}

// ---------- workspace detail ----------
// collapsed sections per workspace ("<wsId>:projects" / "<wsId>:files");
// session-scoped, default expanded
const collapsedSections = new Set<string>();

function workspaceDetailHtml(ws: Workspace): string {
  const effAgent = ws.agent ?? settings.defaultAgent;
  const { groups, external } = groupFiles(ws);
  const fileRow = (i: number) => {
    const f = ws.files[i];
    return `
      <div class="proj-item file-item">
        <span class="ico">📄</span>
        <span class="p">${esc(f.path)}</span>
        <span class="d editable ${f.description ? "" : "empty-val"}" data-file-desc="${i}" data-placeholder="${esc(t("addDescription"))}" title="${esc(t("clickToEdit"))}">${f.description ? esc(f.description) : ""}</span>
      </div>`;
  };
  const linkRow = (i: number) => {
    const l = ws.links[i];
    return `
      <div class="proj-item link-item">
        <span class="ico">🔗</span>
        <span class="p link-path" data-link-open="${i}" title="${esc(t("open"))}: ${esc(l.path)}">${esc(l.path)}</span>
        <span class="d editable ${l.description ? "" : "empty-val"}" data-link-desc="${i}" data-placeholder="${esc(t("addDescription"))}" title="${esc(t("clickToEdit"))}">${l.description ? esc(l.description) : ""}</span>
      </div>`;
  };
  const projectsHtml = ws.projects.length
    ? ws.projects
        .map((p, i) => `
      <div class="proj-item">
        <span class="ico">📁</span>
        <span class="p">${esc(p.path)}</span>
        <span class="d editable ${p.description ? "" : "empty-val"}" data-proj-desc="${i}" data-placeholder="${esc(t("addDescription"))}" title="${esc(t("clickToEdit"))}">${p.description ? esc(p.description) : ""}</span>
      </div>${groups[i].length ? `\n      <div class="file-group" data-group="${i}">${groups[i].map(fileRow).join("")}</div>` : ""}`)
        .join("")
    : `<div class="proj-empty">${esc(t("noFoldersYet"))}</div>`;
  const externalHtml = external.length
    ? `<div class="field collapsible" data-collapse="files" style="margin:14px 0 10px;"><label>${collapsedSections.has(`${ws.id}:files`) ? "▸" : "▾"} ${esc(t("otherFiles"))}（${external.length}）</label></div>
      <div class="file-list" ${collapsedSections.has(`${ws.id}:files`) ? 'style="display:none;"' : ""}>${external.map(fileRow).join("")}</div>`
    : "";
  const linksHtml = ws.links.length
    ? `<div class="field collapsible" data-collapse="links" style="margin:14px 0 10px;"><label>${collapsedSections.has(`${ws.id}:links`) ? "▸" : "▾"} ${esc(t("links"))}（${ws.links.length}）</label></div>
      <div class="file-list" ${collapsedSections.has(`${ws.id}:links`) ? 'style="display:none;"' : ""}>${ws.links.map((_, i) => linkRow(i)).join("")}</div>`
    : "";
  return `
    <div class="main-head">
      <div class="ws-detail-head">
        <h1>${esc(ws.name)}</h1>
        ${effAgent ? `<span class="chip">${esc(agentLabel(effAgent))}</span>` : ""}
      </div>
      <p><span class="editable ws-desc-edit ${ws.description ? "" : "empty-val"}" id="wsDescEdit" data-placeholder="${esc(t("addDescription"))}" title="${esc(t("clickToEdit"))}">${ws.description ? esc(ws.description) : ""}</span></p>
    </div>
    <div class="card">
      <div class="field collapsible" data-collapse="projects" style="margin-bottom:10px;"><label>${collapsedSections.has(`${ws.id}:projects`) ? "▸" : "▾"} ${esc(t("projectCount"))}（${ws.projects.length}）</label></div>
      <div class="proj-list" ${collapsedSections.has(`${ws.id}:projects`) ? 'style="display:none;"' : ""}>${projectsHtml}</div>
      ${externalHtml}
      ${linksHtml}
      <div class="launch-bar">
        <label style="color:var(--text-dim);font-size:0.92rem;">${esc(t("agent"))}</label>
        <select id="wsAgentSel">${agentOptions(ws.agent, agentLabel(settings.defaultAgent) || t("notSet"))}</select>
        <span class="spacer"></span>
        <button class="btn btn-primary" id="launchBtn" ${effAgent ? "" : "disabled"}>${esc(t("launch"))}</button>
      </div>
    </div>`;
}

// Turn a span into an inline input; commit on blur/Enter, cancel on Esc.
// Returns a trigger function so it can be started programmatically (e.g. context menu).
function makeEditable(el: HTMLElement, current: string, onCommit: (val: string) => Promise<void>): () => void {
  const start = () => {
    if (el.dataset.editing) return;
    if (!el.isConnected) return;
    el.dataset.editing = "1";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "inline-edit";
    input.value = current;
    el.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const finish = async (commit: boolean) => {
      if (done) return;
      done = true;
      const val = input.value.trim();
      if (commit && val !== current) {
        await onCommit(val);
      }
      await reload();
      render();
    };
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
      else if (e.key === "Escape") { e.preventDefault(); finish(false); }
    });
  };
  el.addEventListener("click", () => {
    if (Date.now() < suppressClickUntil) return; // click trailing a drag, not an edit intent
    start();
  });
  return start;
}

// holds the trigger for the currently-rendered workspace description editor
let wsDescTrigger: (() => void) | null = null;
function triggerWsDescEdit() {
  // wait a tick for render to finish wiring
  setTimeout(() => wsDescTrigger?.(), 0);
}

// ---------- tabs ----------
// Two-level model: workspaces are top-level tabs (unclosable); every launch
// opens a terminal SUB-tab under its workspace. Sub-tabs are not shared:
// switching workspace hides (but keeps) the previous workspace's terminals.
// A special "agents" top tab aggregates all live sessions across workspaces.
interface Tab { key: string; wsId: string; pinned?: boolean } // top level: workspaces only
let openTabs: Tab[] = [];

function ensureTab(wsId: string) {
  if (!openTabs.some((tb) => tb.wsId === wsId)) openTabs.push({ key: `ws:${wsId}`, wsId });
}
function fallbackView(): View {
  if (openTabs.length) return { kind: "workspace", id: openTabs[openTabs.length - 1].wsId };
  return workspaces.length ? { kind: "workspace", id: workspaces[0].id } : { kind: "settings" };
}
// the workspace whose content is currently shown (for sidebar highlight)
function activeWsId(): string | null {
  if (view.kind === "workspace") return (view as { id: string }).id;
  if (view.kind === "terminal") return termSessions.get(Number((view as { id: string }).id))?.wsId ?? null;
  return null;
}

// terminal sub-tab order per workspace; sessions hold the runtime state
const termOrder = new Map<string, number[]>(); // wsId -> [termId]
const lastTermByWs = new Map<string, number>(); // wsId -> last active termId
function orderOf(wsId: string): number[] {
  let o = termOrder.get(wsId);
  if (!o) {
    o = [];
    termOrder.set(wsId, o);
  }
  return o;
}
function killTerm(termId: number) {
  const s = termSessions.get(termId);
  if (s) {
    invoke("term_kill", { id: s.id });
    s.imeDetach?.();
    s.term.dispose();
    termSessions.delete(termId);
  }
}
function closeSubTabs(wsId: string, termIds: number[]) {
  const kill = new Set(termIds);
  termOrder.set(wsId, orderOf(wsId).filter((id) => {
    if (!kill.has(id)) return true;
    killTerm(id);
    return false;
  }));
  if (view.kind === "terminal" && kill.has(Number((view as { id: string }).id))) {
    const remaining = orderOf(wsId);
    view = remaining.length ? { kind: "terminal", id: String(remaining[remaining.length - 1]) } : { kind: "workspace", id: wsId };
  }
  render();
}
// top-level (workspace) tab close/pin. Closing a workspace tab never kills its
// terminals ? they keep running and stay reachable in the agents view.
function closeTopTab(key: string) {
  const i = openTabs.findIndex((tb) => tb.key === key);
  if (i < 0) return;
  const tb = openTabs[i];
  if (tb.pinned) return;
  openTabs.splice(i, 1);
  if (view.kind === "workspace" && (view as { id: string }).id === tb.wsId) {
    view = openTabs.length ? { kind: "workspace", id: openTabs[openTabs.length - 1].wsId } : { kind: "settings" };
  }
  render();
}
function closeOtherTopTabs(keepKey: string) {
  openTabs = openTabs.filter((tb) => tb.pinned || tb.key === keepKey);
  if (view.kind === "workspace" && !openTabs.some((tb) => tb.wsId === (view as { id: string }).id)) {
    view = openTabs.length ? { kind: "workspace", id: openTabs[openTabs.length - 1].wsId } : { kind: "settings" };
  }
  render();
}
function closeAllTopTabs() {
  openTabs = openTabs.filter((tb) => tb.pinned);
  if (view.kind === "workspace" && !openTabs.some((tb) => tb.wsId === (view as { id: string }).id)) {
    view = openTabs.length ? { kind: "workspace", id: openTabs[openTabs.length - 1].wsId } : { kind: "settings" };
  }
  render();
}
// pinned workspace tabs sort to the front
function pinTopTab(key: string) {
  const i = openTabs.findIndex((tb) => tb.key === key);
  if (i < 0) return;
  const tb = openTabs[i];
  if (tb.pinned) {
    tb.pinned = false;
    render();
    return;
  }
  tb.pinned = true;
  openTabs.splice(i, 1);
  let pos = 0;
  while (pos < openTabs.length && openTabs[pos].pinned) pos++;
  openTabs.splice(pos, 0, tb);
  render();
}

function pinSubTab(wsId: string, termId: number) {
  const s = termSessions.get(termId);
  if (!s) return;
  if (s.pinned) {
    s.pinned = false; // unpin: stays in place
  } else {
    s.pinned = true; // pin: move to the front of this workspace's sub-tabs
    const rest = orderOf(wsId).filter((id) => id !== termId);
    let pos = 0;
    while (pos < rest.length && termSessions.get(rest[pos])?.pinned) pos++;
    rest.splice(pos, 0, termId);
    termOrder.set(wsId, rest);
  }
  render();
}
// ---------- embedded terminal (PROTOTYPE — experiment branch) ----------
// terminal palette/fonts read from the live CSS variables (theme-aware)
function termTheme() {
  const cs = getComputedStyle(document.documentElement);
  const cssVar = (n: string) => cs.getPropertyValue(n).trim() || undefined;
  return {
    background: cssVar("--bg"),
    foreground: cssVar("--text"),
    cursor: cssVar("--text"),
    cursorAccent: cssVar("--bg"),
    selectionBackground: cssVar("--bg-active"),
    red: cssVar("--danger"),
    green: cssVar("--green"),
    blue: cssVar("--accent"),
    yellow: cssVar("--yellow"),
    magenta: cssVar("--term-magenta"),
    cyan: cssVar("--term-cyan"),
    brightBlack: cssVar("--text-faint"),
    brightWhite: cssVar("--text"),
  };
}

interface TermSession {
  term: Terminal; fit: FitAddon; el: HTMLElement; id: number; wsId: string;
  agentKey: string; sessionId: string; sessionLabel: string; resume: boolean;
  exited: boolean; pinned: boolean; spawned: boolean;
  unread: boolean; // exited while not being viewed ? yellow dot on the sidebar
  entries: { text: string; line: number; time: number }[]; // submitted prompts
  inputBuf: string; // line currently being typed (conversation capture)
  imeDetach?: () => void;
}
const termSessions = new Map<number, TermSession>(); // termId -> session
let nextTermId = 1;

async function openTerminal(ws: Workspace, opts: { activate?: boolean; sessionId?: string; sessionLabel?: string; resume?: boolean; pinned?: boolean; agentKey?: string; entries?: { text: string; line: number; time: number }[] } = {}): Promise<TermSession> {
  // every launch spawns a NEW session/sub-tab; the PTY itself starts lazily on
  // first activation (restored tabs don't spawn processes until opened)
  const id = nextTermId++;
  const term = new Terminal({
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--mono").trim() || "monospace",
    fontSize: settings.fontSize ?? 13,
    fontWeight: (settings.fontWeight ?? 400) as 400,
    fontWeightBold: 700,
    lineHeight: 1.18,
    theme: termTheme(),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  const el = document.createElement("div");
  el.className = "term-el";
  const agentKey = opts.agentKey ?? ws.agent ?? settings.defaultAgent ?? "";
  // per-agent sequence within this workspace ? distinguishes same-workspace
  // sessions in resume pickers (matches the sub-tab numbering)
  const seq = orderOf(ws.id).filter((id2) => termSessions.get(id2)?.agentKey === agentKey).length + 1;
  const sessionLabel = opts.sessionLabel ?? (agentLabel(agentKey) + (seq > 1 ? ` ${seq}` : ""));
  const sess: TermSession = {
    term, fit, el, id, wsId: ws.id,
    agentKey,
    sessionId: opts.sessionId ?? crypto.randomUUID(),
    sessionLabel,
    resume: opts.resume ?? false,
    exited: false,
    pinned: opts.pinned ?? false,
    spawned: false,
    entries: [...(opts.entries ?? [])],
    inputBuf: "",
    unread: false,
  };
  termSessions.set(id, sess);
  // console-style clipboard: Ctrl+C copies when there's a selection (otherwise
  // it's ^C), Ctrl+V pastes; right-click copies the selection or pastes
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== "keydown") return true;
    const key = e.key.toLowerCase();
    if (e.ctrlKey && key === "c" && term.hasSelection()) {
      navigator.clipboard.writeText(term.getSelection());
      term.clearSelection();
      return false;
    }
    if (e.ctrlKey && key === "v") {
      navigator.clipboard.readText().then((t2) => t2 && invoke("term_write", { id, data: t2 }));
      return false;
    }
    return true;
  });
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (term.hasSelection()) {
      navigator.clipboard.writeText(term.getSelection());
      term.clearSelection();
    } else {
      navigator.clipboard.readText().then((t2) => t2 && invoke("term_write", { id, data: t2 }));
    }
  });
  term.onData((d) => {
    if (sess.spawned) invoke("term_write", { id, data: d });
    // conversation capture (prototype): accumulate printable input, record on Enter
    if (d === "\r") {
      const text = sess.inputBuf.trim();
      if (text) {
        sess.entries.push({ text, line: term.buffer.active.baseY + term.buffer.active.cursorY, time: Date.now() });
        renderConvBar(sess);
      }
      sess.inputBuf = "";
    } else if (d === "\x7f") {
      sess.inputBuf = sess.inputBuf.slice(0, -1);
    } else if (d === "\x03" || d === "\x04") {
      sess.inputBuf = "";
    } else if (/^[\x20-\x7e\u00a0-\uffff]+$/.test(d)) {
      sess.inputBuf += d; // printable chunk (incl. CJK / IME commits)
    } // escape sequences and other control chunks: ignore
  });
  // ConPTY dies on a 0x0 resize ? never forward zero dimensions (they happen transiently on tab switches)
  term.onResize(({ cols, rows }) => { if (sess.spawned && cols > 0 && rows > 0) invoke("term_resize", { id, cols, rows }); });
  // reflow on window/pane resize (only while attached)
  new ResizeObserver(() => {
    if (sess.el.isConnected && sess.spawned && sess.el.clientWidth > 0 && sess.el.clientHeight > 0) sess.fit.fit();
  }).observe(el);
  await listen<string>(`term-data-${id}`, (e) => term.write(e.payload));
  await listen(`term-exit-${id}`, () => {
    sess.exited = true;
    // unread if the user isn't looking at this terminal right now
    sess.unread = !(view.kind === "terminal" && Number((view as { id: string }).id) === id);
    term.write("\r\n\x1b[90m[process exited]\x1b[0m\r\n"); // tab stays until closed
    render(); // refresh tab labels / agents count / sidebar dots
  });
  ensureTab(ws.id);
  const order = orderOf(ws.id);
  if (sess.pinned) {
    let pos = 0;
    while (pos < order.length && termSessions.get(order[pos])?.pinned) pos++;
    order.splice(pos, 0, id);
  } else {
    order.push(id);
  }
  lastTermByWs.set(ws.id, id);
  if (opts.activate !== false) {
    view = { kind: "terminal", id: String(id) };
    render(); // wireTerminal → startTerminal
  }
  return sess;
}

// opens the xterm DOM and spawns the PTY on first activation
async function startTerminal(sess: TermSession) {
  if (sess.spawned) return;
  sess.spawned = true;
  sess.term.open(sess.el);
  // pin the IME candidate window to the TUI's visual caret (inverse-video
  // cell), not the hardware cursor parked at the end of output
  sess.imeDetach = attachImeHeuristic(sess.term).detach;
  sess.fit.fit();
  sess.term.focus();
  setStatus(t("launching"));
  try {
    // spawn at the terminal's real size so the agent draws one correct frame
    const info = await invoke<{ prog: string; initial_prompt: string | null }>("launch_agent_embedded", {
      workspaceId: sess.wsId, agentOverride: sess.agentKey || null, termId: sess.id,
      cols: sess.term.cols, rows: sess.term.rows, sessionId: sess.sessionId, resume: sess.resume,
      sessionLabel: sess.sessionLabel,
    });
    // the injected first prompt belongs in the conversation record too
    if (info.initial_prompt) {
      sess.entries.push({ text: info.initial_prompt, line: 0, time: Date.now() });
      renderConvBar(sess);
    }
    setStatus("");
  } catch (err) {
    setStatus(`${t("launchFailed")}：${err}`, true);
  }
}
// workspace actions usable from sidebar context menu
// launch mode: embedded terminal tab (default) | cmd window | powershell window
async function launchWs(ws: Workspace) {
  const mode = settings.launchMode ?? "embedded";
  if (mode === "embedded") {
    await openTerminal(ws);
    return;
  }
  setStatus(t("launching"));
  try {
    const cmd = mode === "powershell" ? "launch_agent_ps" : "launch_agent";
    const r = await invoke<string>(cmd, { workspaceId: ws.id, agentOverride: null });
    setStatus(`${t("launched")}：${r}`);
  } catch (err) { setStatus(`${t("launchFailed")}：${err}`, true); }
}
async function renameWs(ws: Workspace) {
  const trimmed = await modal({ title: t("rename"), input: ws.name, okLabel: t("rename") });
  if (trimmed === null) return;
  if (!trimmed || trimmed === ws.name) return;
  await invoke("update_workspace", { ws: { ...ws, name: trimmed } });
  setStatus(t("saved"));
  await reload();
  render();
}
async function deleteWs(ws: Workspace) {
  const ok = await modal({ title: ws.name, body: t("confirmDelete"), okLabel: t("delete"), danger: true });
  if (ok === null) return;
  await invoke("delete_workspace", { id: ws.id });
  // close its top tab and kill all its terminal sessions
  openTabs = openTabs.filter((tb) => tb.wsId !== ws.id);
  (termOrder.get(ws.id) ?? []).forEach(killTerm);
  termOrder.delete(ws.id);
  setStatus(t("deleted"));
  await reload();
  if ((view.kind === "workspace" && (view as { id: string }).id === ws.id) ||
      (view.kind === "terminal" && !termSessions.has(Number((view as { id: string }).id)))) {
    view = fallbackView();
  }
  render();
}
// group file indices by containing project (longest path prefix wins);
// files outside all projects are "external"
function groupFiles(ws: Workspace): { groups: number[][]; external: number[] } {
  const norm = (s: string) => s.replace(/\//g, "\\").toLowerCase().replace(/\\+$/, "");
  const groups: number[][] = ws.projects.map(() => []);
  const external: number[] = [];
  ws.files.forEach((f, i) => {
    const fp = norm(f.path);
    let best = -1;
    ws.projects.forEach((p, j) => {
      const pp = norm(p.path);
      if (fp.startsWith(pp + "\\") && (best < 0 || norm(ws.projects[best].path).length < pp.length)) best = j;
    });
    if (best >= 0) groups[best].push(i);
    else external.push(i);
  });
  return { groups, external };
}

// filter `paths` down to ones not already in `existing` (normalized compare:
// separators/case differ between drag sources and the folder picker)
function dedupeNew(existing: { path: string }[], paths: string[]): Project[] {
  const norm = (s: string) => s.replace(/\//g, "\\").toLowerCase();
  const have = new Set(existing.map((e) => norm(e.path)));
  return paths.filter((p) => !have.has(norm(p))).map((p) => ({ path: p, description: "" }));
}

// add folders (as projects) and files to an existing workspace in one update
async function addPathsToWs(ws: Workspace, dirs: string[], files: string[]) {
  const addedP = dedupeNew(ws.projects, dirs);
  const addedF = dedupeNew(ws.files, files);
  if (!addedP.length && !addedF.length) return;
  await invoke("update_workspace", { ws: { ...ws, projects: [...ws.projects, ...addedP], files: [...ws.files, ...addedF] } });
  setStatus(t("saved"));
  await reload();
  render();
}

async function removeProject(ws: Workspace, index: number) {
  const proj = ws.projects[index];
  const ok = await modal({ title: proj.path, body: t("confirmRemoveProject"), okLabel: t("removeProject"), danger: true });
  if (ok === null) return;
  const projects = ws.projects.filter((_, j) => j !== index);
  await invoke("update_workspace", { ws: { ...ws, projects } });
  setStatus(t("removed"));
  await reload();
  render();
}

async function removeFile(ws: Workspace, index: number) {
  const f = ws.files[index];
  const ok = await modal({ title: f.path, body: t("confirmRemoveFile"), okLabel: t("removeFile"), danger: true });
  if (ok === null) return;
  const files = ws.files.filter((_, j) => j !== index);
  await invoke("update_workspace", { ws: { ...ws, files } });
  setStatus(t("removed"));
  await reload();
  render();
}

async function removeLink(ws: Workspace, index: number) {
  const l = ws.links[index];
  const ok = await modal({ title: l.path, body: t("confirmRemoveLink"), okLabel: t("removeLink"), danger: true });
  if (ok === null) return;
  const links = ws.links.filter((_, j) => j !== index);
  await invoke("update_workspace", { ws: { ...ws, links } });
  setStatus(t("removed"));
  await reload();
  render();
}

// ---------- modal ----------
// In-app dialog for confirms/prompts. Native window.alert/confirm/prompt are
// banned: they ignore the CSS-variable theme. Resolves with the (trimmed)
// input value, "" when no input, or null on cancel.
function modal(opts: { title: string; body?: string; input?: string; okLabel: string; danger?: boolean }): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-title">${esc(opts.title)}</div>
        ${opts.body !== undefined ? `<div class="modal-body">${esc(opts.body)}</div>` : ""}
        ${opts.input !== undefined ? `<input type="text" class="modal-input" value="${esc(opts.input)}" />` : ""}
        <div class="modal-actions">
          <button class="btn btn-ghost" data-act="cancel">${esc(t("cancel"))}</button>
          <button class="btn ${opts.danger ? "btn-danger-solid" : "btn-primary"}" data-act="ok">${esc(opts.okLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector(".modal-input") as HTMLInputElement | null;
    const close = (val: string | null) => {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve(val);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); close(null); }
      else if (e.key === "Enter") { e.stopPropagation(); close(input ? input.value.trim() : ""); }
    };
    document.addEventListener("keydown", onKey, true);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
    overlay.querySelector('[data-act="cancel"]')!.addEventListener("click", () => close(null));
    overlay.querySelector('[data-act="ok"]')!.addEventListener("click", () => close(input ? input.value.trim() : ""));
    if (input) { input.focus(); input.select(); }
    else (overlay.querySelector('[data-act="ok"]') as HTMLElement).focus();
  });
}

// ---------- context menu ----------
let ctxMenuEl: HTMLElement | null = null;
function closeCtxMenu() {
  ctxMenuEl?.remove();
  ctxMenuEl = null;
  document.removeEventListener("click", closeCtxMenu);
  document.removeEventListener("contextmenu", closeCtxMenu, true);
  window.removeEventListener("blur", closeCtxMenu);
}
function showCtxMenu(x: number, y: number, items: { label: string; onClick: () => void }[]) {
  closeCtxMenu();
  const menu = document.createElement("div");
  menu.className = "ctx-menu";
  items.forEach((it) => {
    const el = document.createElement("div");
    el.className = "ctx-item";
    el.textContent = it.label;
    el.addEventListener("click", () => { closeCtxMenu(); it.onClick(); });
    menu.appendChild(el);
  });
  document.body.appendChild(menu);
  // clamp to viewport
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, window.innerWidth - r.width - 8) + "px";
  menu.style.top = Math.min(y, window.innerHeight - r.height - 8) + "px";
  ctxMenuEl = menu;
  setTimeout(() => {
    document.addEventListener("click", closeCtxMenu);
    document.addEventListener("contextmenu", closeCtxMenu, true);
    window.addEventListener("blur", closeCtxMenu);
  }, 0);
}

function wireWorkspaceDetail(ws: Workspace) {
  // collapsible section headers
  document.querySelectorAll("[data-collapse]").forEach((el) => {
    el.addEventListener("click", () => {
      const key = `${ws.id}:${(el as HTMLElement).dataset.collapse}`;
      if (collapsedSections.has(key)) collapsedSections.delete(key);
      else collapsedSections.add(key);
      render();
    });
  });
  // workspace description inline edit; expose trigger for sidebar context menu
  const wsDesc = $("wsDescEdit");
  if (wsDesc) {
    wsDescTrigger = makeEditable(wsDesc, ws.description, async (val) => {
      await invoke("update_workspace", { ws: { ...ws, description: val } });
      setStatus(t("saved"));
    });
    wsDesc.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showCtxMenu(e.clientX, e.clientY, [
        { label: t("editDescription"), onClick: () => wsDescTrigger?.() },
      ]);
    });
  } else {
    wsDescTrigger = null;
  }
  // project description inline edits (+ right-click on row)
  document.querySelectorAll("[data-proj-desc]").forEach((el) => {
    const i = Number((el as HTMLElement).dataset.projDesc);
    const trigger = makeEditable(el as HTMLElement, ws.projects[i].description, async (val) => {
      const projects = ws.projects.map((p, j) => (j === i ? { ...p, description: val } : p));
      await invoke("update_workspace", { ws: { ...ws, projects } });
      setStatus(t("saved"));
    });
    const row = el.closest(".proj-item") as HTMLElement;
    row?.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showCtxMenu(e.clientX, e.clientY, [
        { label: t("editDescription"), onClick: () => trigger() },
        { label: t("removeProject"), onClick: () => removeProject(ws, i) },
      ]);
    });
  });
  // file rows: same interactions as project rows
  document.querySelectorAll("[data-file-desc]").forEach((el) => {
    const i = Number((el as HTMLElement).dataset.fileDesc);
    const trigger = makeEditable(el as HTMLElement, ws.files[i].description, async (val) => {
      const files = ws.files.map((f, j) => (j === i ? { ...f, description: val } : f));
      await invoke("update_workspace", { ws: { ...ws, files } });
      setStatus(t("saved"));
    });
    const row = el.closest(".file-item") as HTMLElement;
    row?.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showCtxMenu(e.clientX, e.clientY, [
        { label: t("editDescription"), onClick: () => trigger() },
        { label: t("removeFile"), onClick: () => removeFile(ws, i) },
      ]);
    });
  });
  // file rows: drag-reorder within their group (grouping is path-derived, so
  // cross-group moves are meaningless) + trash delete; indices are global
  const { groups, external } = groupFiles(ws);
  const wireFileRows = (rows: HTMLElement[], indices: number[]) =>
    wireDragReorder(rows, async (from, to) => {
      const local = indices.map((g) => ws.files[g]);
      local.splice(to, 0, ...local.splice(from, 1));
      const files = [...ws.files];
      indices.forEach((g, k) => { files[g] = local[k]; });
      await invoke("update_workspace", { ws: { ...ws, files } });
      setStatus(t("saved"));
      await reload();
      render();
    }, (localIdx) => removeFile(ws, indices[localIdx]));
  document.querySelectorAll<HTMLElement>(".file-group").forEach((groupEl) => {
    const gi = Number(groupEl.dataset.group);
    wireFileRows(Array.from(groupEl.querySelectorAll(".file-item")), groups[gi]);
  });
  wireFileRows(Array.from(document.querySelectorAll<HTMLElement>(".file-list .file-item")), external);
  // link rows: click path to open, desc edit, right-click, drag-reorder + trash
  document.querySelectorAll("[data-link-desc]").forEach((el) => {
    const i = Number((el as HTMLElement).dataset.linkDesc);
    const trigger = makeEditable(el as HTMLElement, ws.links[i].description, async (val) => {
      const links = ws.links.map((l, j) => (j === i ? { ...l, description: val } : l));
      await invoke("update_workspace", { ws: { ...ws, links } });
      setStatus(t("saved"));
    });
    const row = el.closest(".link-item") as HTMLElement;
    row?.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showCtxMenu(e.clientX, e.clientY, [
        { label: t("open"), onClick: () => invoke("open_url", { url: ws.links[i].path }) },
        { label: t("editDescription"), onClick: () => trigger() },
        { label: t("removeLink"), onClick: () => removeLink(ws, i) },
      ]);
    });
  });
  document.querySelectorAll("[data-link-open]").forEach((el) =>
    el.addEventListener("click", () => {
      if (Date.now() < suppressClickUntil) return; // trailing click after a drag
      invoke("open_url", { url: ws.links[Number((el as HTMLElement).dataset.linkOpen)].path });
    })
  );
  wireDragReorder(Array.from(document.querySelectorAll<HTMLElement>(".link-item")), async (from, to) => {
    const links = [...ws.links];
    links.splice(to, 0, ...links.splice(from, 1));
    await invoke("update_workspace", { ws: { ...ws, links } });
    setStatus(t("saved"));
    await reload();
    render();
  }, (i) => removeLink(ws, i));

  // right-click empty space in the project card: add project
  const card = document.querySelector(".main .card") as HTMLElement | null;
  card?.addEventListener("contextmenu", (e) => {
    const t2 = e.target as HTMLElement;
    if (t2.closest("select, button, input, textarea")) return; // rows stopPropagation themselves
    e.preventDefault();
    e.stopPropagation();
    showCtxMenu(e.clientX, e.clientY, [
      {
        label: t("addProject"),
        onClick: async () => {
          const picked = await open({ directory: true, multiple: true });
          const paths = picked ? (Array.isArray(picked) ? picked : [picked]) : [];
          if (paths.length) await addPathsToWs(ws, paths, []);
        },
      },
      {
        label: t("addFile"),
        onClick: async () => {
          const picked = await open({ multiple: true });
          const paths = picked ? (Array.isArray(picked) ? picked : [picked]) : [];
          if (paths.length) await addPathsToWs(ws, [], paths);
        },
      },
      {
        label: t("addLink"),
        onClick: async () => {
          const val = await modal({ title: t("addLink"), input: "", okLabel: t("addLink") });
          if (val === null || !val) return;
          const url = val.includes("://") ? val : `https://${val}`;
          await invoke("update_workspace", { ws: { ...ws, links: [...ws.links, { path: url, description: "" }] } });
          setStatus(t("saved"));
          await reload();
          render();
        },
      },
    ]);
  });
  // project rows are drag-reorderable; first row is the primary dir
  wireDragReorder(
    Array.from(document.querySelectorAll<HTMLElement>(".proj-item:not(.file-item)")),
    async (from, to) => {
      const projects = [...ws.projects];
      projects.splice(to, 0, ...projects.splice(from, 1));
      await invoke("update_workspace", { ws: { ...ws, projects } });
      setStatus(t("saved"));
      await reload();
      render();
    },
    (i) => removeProject(ws, i)
  );
  $("wsAgentSel").addEventListener("change", async (e) => {
    const val = (e.target as HTMLSelectElement).value || null;
    await invoke("update_workspace", { ws: { ...ws, agent: val } });
    setStatus(`${t("agentUpdated")} "${ws.name}"`);
    await reload();
    render();
  });
  $("launchBtn").addEventListener("click", () => launchWs(ws)); // goes through the launch-mode setting
}

// ---------- OS file drop ----------
// Tauri intercepts OS file drops (dragDropEnabled is on by default) and reports
// full paths via onDragDropEvent. Drop on a workspace detail's main area adds
// the folders as projects; drop anywhere else (sidebar, settings…) creates one
// workspace per folder. Event positions are physical pixels → divide by scale.
function wireFileDrop() {
  const win = getCurrentWebviewWindow();
  let scale = 1;
  win.scaleFactor().then((s) => (scale = s));
  const setHint = (zone: "project" | "workspace" | "terminal" | null) => {
    document.querySelector(".sidebar")?.classList.toggle("drop-hint", zone === "workspace");
    document.querySelector(".main")?.classList.toggle("drop-hint", zone === "project");
  };
  const zoneAt = (x: number, y: number): "project" | "workspace" | "terminal" => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (el?.closest(".term-wrap")) return "terminal";
    return view.kind === "workspace" && el?.closest(".main") ? "project" : "workspace";
  };
  win.onDragDropEvent(async (event) => {
    const p = event.payload;
    if (p.type === "leave") return setHint(null);
    const x = p.position.x / scale, y = p.position.y / scale;
    if (p.type === "enter" || p.type === "over") return setHint(zoneAt(x, y));
    setHint(null);
    // terminal drop: type the paths into the PTY (quote paths with spaces), no Enter
    if (zoneAt(x, y) === "terminal" && view.kind === "terminal") {
      const sess = termSessions.get(Number((view as { id: string }).id));
      if (sess?.spawned) {
        const text = p.paths.map((s) => (/\s/.test(s) ? `"${s}"` : s)).join(" ");
        invoke("term_write", { id: sess.id, data: text });
        sess.term.focus();
      }
      return;
    }
    const [dirs, files] = await invoke<[string[], string[]]>("classify_paths", { paths: p.paths });
    if (!dirs.length && !files.length) return setStatus(t("dropNoDirs"), true);
    if (zoneAt(x, y) === "project" && view.kind === "workspace") {
      const id = (view as { kind: "workspace"; id: string }).id;
      const ws = workspaces.find((w) => w.id === id);
      if (ws) await addPathsToWs(ws, dirs, files);
      return;
    }
    if (!dirs.length) return setStatus(t("dropNoDirs"), true);
    let firstId: string | null = null;
    for (const d of dirs) {
      const name = d.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || d;
      const ws = await invoke<Workspace>("create_workspace", { name, description: "", agent: null, projects: [{ path: d, description: "" }] });
      if (!firstId) firstId = ws.id;
    }
    setStatus(t("created"));
    if (firstId) view = { kind: "workspace", id: firstId };
    await reload();
    render();
  });
}

// ---------- sidebar splitter ----------
function wireSplitter() {
  const splitter = $("splitter");
  const sidebar = document.querySelector(".sidebar") as HTMLElement;
  splitter.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    splitter.setPointerCapture(e.pointerId);
    splitter.classList.add("dragging");
    const onMove = (ev: PointerEvent) => {
      const w = Math.min(480, Math.max(180, Math.round(ev.clientX)));
      sidebar.style.width = w + "px";
      sidebar.style.flex = `0 0 ${w}px`;
    };
    const onUp = () => {
      splitter.removeEventListener("pointermove", onMove);
      splitter.removeEventListener("pointerup", onUp);
      splitter.removeEventListener("pointercancel", onUp);
      splitter.classList.remove("dragging");
      patchSettings({ sidebarWidth: Math.round(sidebar.getBoundingClientRect().width) });
    };
    splitter.addEventListener("pointermove", onMove);
    splitter.addEventListener("pointerup", onUp);
    splitter.addEventListener("pointercancel", onUp);
  });
}

// ---------- render ----------
async function reload() {
  workspaces = await invoke<Workspace[]>("list_workspaces");
  settings = await invoke<Settings>("get_settings");
}

// ---------- UI session state (persist open tabs / pins / active page) ----------
interface UiState {
  tabs: { wsId: string; pinned: boolean }[];
  active: string | null; // wsId | "agents" | "settings" | "term:<sessionId>"
  terms?: { wsId: string; agentKey: string; sessionId: string; sessionLabel: string; pinned: boolean; entries: { text: string; line: number; time: number }[] }[];
}
let uiRestored = false;
function persistUi() {
  if (!uiRestored) return;
  let active: string | null;
  if (view.kind === "terminal") {
    const s = termSessions.get(Number((view as { id: string }).id));
    active = s ? `term:${s.sessionId}` : null;
  } else {
    active = activeWsId() ?? (view.kind === "agents" ? "agents" : view.kind === "settings" ? "settings" : null);
  }
  const state: UiState = {
    tabs: openTabs.map((tb) => ({ wsId: tb.wsId, pinned: !!tb.pinned })),
    active,
    terms: [...termSessions.values()]
      .sort((a, b) => a.id - b.id)
      .map((s) => ({ wsId: s.wsId, agentKey: s.agentKey, sessionId: s.sessionId, sessionLabel: s.sessionLabel, pinned: s.pinned, entries: s.entries })),
  };
  invoke("save_ui_state", { state });
}

function render() {
  renderNav();
  renderMain();
  persistUi();
}

// suppress the browser's default context menu everywhere except text inputs
// (where cut/copy/paste is still useful). Custom menus call stopPropagation.
document.addEventListener("contextmenu", (e) => {
  const t2 = e.target as HTMLElement;
  const isTextField = t2.tagName === "INPUT" || t2.tagName === "TEXTAREA";
  if (!isTextField) e.preventDefault();
});

// ---------- undo/redo ----------
// Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y over the workspace list. Text fields keep
// their native undo; renderMain falls back to settings if the viewed
// workspace vanished in the time travel.
document.addEventListener("keydown", async (e) => {
  const t2 = e.target as HTMLElement;
  if (t2.tagName === "INPUT" || t2.tagName === "TEXTAREA") return;
  const key = e.key.toLowerCase();
  if (!(e.ctrlKey || e.metaKey) || (key !== "z" && key !== "y")) return;
  e.preventDefault();
  const redo = e.shiftKey || key === "y";
  const list = await invoke<Workspace[] | null>(redo ? "redo_workspaces" : "undo_workspaces");
  if (list) {
    workspaces = list;
    setStatus(t(redo ? "redone" : "undone"));
    render();
  } else {
    setStatus(t("nothingToUndo"));
  }
});

(async () => {
  agents = await invoke<AgentInfo[]>("list_agents");
  await reload();
  applyAppearance();
  wireFileDrop();
  wireSplitter();
  getVersion().then((v) => (appVersion = v));
  // restore UI session: open tabs (+pins), terminal sub-tabs (resumed lazily on
  // first activation via the stored session id), and the active page.
  let restored = false;
  const ui = await invoke<UiState | null>("load_ui_state");
  if (ui) {
    openTabs = ui.tabs
      .filter((tb) => workspaces.some((w) => w.id === tb.wsId))
      .map((tb) => ({ key: `ws:${tb.wsId}`, wsId: tb.wsId, pinned: tb.pinned }));
    for (const tt of ui.terms ?? []) {
      const ws = workspaces.find((w) => w.id === tt.wsId);
      if (!ws) continue;
      await openTerminal(ws, { activate: false, sessionId: tt.sessionId, sessionLabel: tt.sessionLabel, resume: true, pinned: tt.pinned, agentKey: tt.agentKey, entries: tt.entries });
    }
    if (ui.active?.startsWith("term:")) {
      const sid = ui.active.slice(5);
      const sess = [...termSessions.values()].find((s) => s.sessionId === sid);
      if (sess) {
        view = { kind: "terminal", id: String(sess.id) };
        restored = true;
      }
    } else if (ui.active === "agents") {
      view = { kind: "agents" };
      restored = true;
    } else if (ui.active === "settings") {
      view = { kind: "settings" };
      restored = true;
    } else if (ui.active && workspaces.some((w) => w.id === ui.active)) {
      ensureTab(ui.active);
      view = { kind: "workspace", id: ui.active };
      restored = true;
    } else if (openTabs.length) {
      view = { kind: "workspace", id: openTabs[openTabs.length - 1].wsId };
      restored = true;
    }
  }
  if (!restored) {
    if (workspaces.length) {
      ensureTab(workspaces[0].id);
      view = { kind: "workspace", id: workspaces[0].id };
    } else {
      view = { kind: "settings" };
    }
  }
  uiRestored = true;
  render();
})();
