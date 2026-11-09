import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { ArrowUp, Pencil, Plus, Square, X } from "lucide-react";
import type { LexicalEditor } from "lexical";
import type { ImageRef, ModelInfo, SkillView } from "../lib/api";
import type { Mode } from "../lib/mode";
import { assetUrl } from "../lib/assetUrl";
import { fileKindOf } from "../lib/fileIcon";
import { loadInputDraft, saveInputDraft } from "../lib/draft";
import { fileItems, findTrigger, type MentionItem, type MentionTrigger } from "../lib/mentions";
import {
  getSessionGoal,
  listSkills,
  listWorkspaceFiles,
  setSessionGoal,
} from "../lib/api";
import {
  SLASH_COMMANDS,
  findSlashTrigger,
  resolveSlashQuery,
  type CommandId,
} from "../lib/slashCommands";
import {
  exportCommandItems,
  modelCommandItems,
  modeCommandItems,
  rootCommandItems,
  skillCommandItems,
  type CommandItem,
} from "../lib/commandItems";
import { downloadSessionZip } from "../lib/exportSession";
import { CONTENT_WIDTH } from "../lib/layout";
import { loadFrecency, rankByFrecency, recordUse } from "../lib/frecency";
import { notify } from "../lib/notices";
import { useMarkdownLive } from "../hooks/useMarkdownLive";
import MarkdownEditor, {
  insertAtCaret,
  replaceTrigger,
  setEditorMarkdown,
  type EditorSnapshot,
} from "./MarkdownEditor";
import CommandMenu from "./CommandMenu";
import AlertBar from "./AlertBar";
import GoalBar from "./GoalBar";
import GoalPanel from "./GoalPanel";
import MentionMenu from "./MentionMenu";
import ModeTabs from "./ModeTabs";
import ModelSelect from "./ModelSelect";
import { StatsPills } from "./StatsPills";
import { ContextWaterBar } from "./ContextWaterBar";
import { TurnUsagePanel } from "./TurnUsagePanel";
import WorkspaceSelect from "./WorkspaceSelect";

interface Props {
  onSend: (text: string, images?: ImageRef[]) => void;
  onStop: () => void;
  busy: boolean;
  models: ModelInfo[];
  selectedModel: string;
  onModelChange: (id: string) => void;
  mode: Mode;
  onModeChange: (m: Mode) => void;
  /** 当前对话已绑定的工作区；空串表示尚未选定 */
  workspace: string;
  onWorkspaceChange: (path: string) => Promise<void>;
  /** 首条消息已发出：工作区锁定，隐藏选择按钮（一个对话唯一对应一个工作区） */
  workspaceLocked?: boolean;
  /** 当前会话 id。草稿按会话隔离，切换对话各自保留 */
  sessionId: string;
  /** 会话标题，导出日志时作为文档标题 */
  sessionTitle?: string;
  /** 最近一条用户消息，供上方向键召回 */
  lastUserMessage?: string;
  /** 编辑历史消息时要把原文放回输入框；null 表示不在编辑 */
  editPrefill?: string | null;
  /**
   * 待插入的文本（拖放文件路径时由外部塞进来）。
   * 用 id 区分先后——连续插入同一段文本也要能被区分开。
   */
  inputInsert?: { text: string; id: number } | null;
  /** 正在编辑：输入框展示提示条，发送走「回滚 + 重发」 */
  editing?: boolean;
  /** 取消编辑 */
  onCancelEdit?: () => void;
  /**
   * 提交入口。普通发送与「编辑后重发」由 store 内部区分，
   * 输入框只调这一个。images 为图片附件（C55），后端多模态就绪前降级携带。
   */
  onSubmit?: (text: string, images?: ImageRef[]) => void;
  /**
   * 布局变体：`bottom`（默认）贴在对话区底部 / `inline` 嵌在开始界面里。
   */
  variant?: "bottom" | "inline";
  /**
   * 覆盖「输入框 Markdown 实时渲染」开关。组件测试显式传 false 走
   * textarea 路径（contenteditable 不响应 fireEvent.change），
   * 生产环境不传、由设置页的开关决定。
   */
  markdownLive?: boolean;
}

type CommandView = CommandId | "root";

/** 输入框本地的图片附件：在 ImageRef 基础上加一个稳定 id 方便增删。 */
type Attachment = ImageRef & { id: string };

/** 单条、且为图片扩展名的路径（拖放单张图片时 inputInsert 会是这种形态）。 */
function isSingleImagePath(text: string): boolean {
  if (/\s/.test(text)) return false;
  return fileKindOf(text) === "image";
}

interface CommandState {
  view: CommandView;
  /** slash = 由输入框的 `/` 触发；plus = 由工具行的加号按钮触发 */
  source: "slash" | "plus";
  /** 二级面板的过滤词 / 目标面板的预填内容 */
  query: string;
  /** 触发词在文本中的起止（plus 来源为 -1，表示没有可替换的文本） */
  start: number;
  end: number;
}

const CMD_TITLES: Record<CommandView, string> = {
  root: "命令",
  skill: "技能",
  goal: "长期目标",
  model: "模型",
  mode: "模式",
  export: "下载日志",
};

const CMD_HINT = "↑↓ 选择 · Enter 确认 · Esc 关闭 · 可直接点击";

/** 文本节点内容 + 光标，供触发判定；textarea 的 line 就是全文。 */
const EMPTY_SNAPSHOT: EditorSnapshot = {
  line: "",
  caret: 0,
  markdown: "",
  indentable: false,
};

/**
 * 输入框消费一次按键：除了阻止默认行为，还要阻止继续冒泡到
 * Lexical 在 contentEditable 上的原生 keydown 监听，否则回车会先
 * 插段落、Tab 会先插制表符，再轮到输入框处理。
 */
function consume(e: KeyboardEvent<HTMLElement>): void {
  e.preventDefault();
  e.stopPropagation();
}

export default function InputArea({
  onSend,
  onStop,
  busy,
  models,
  selectedModel,
  onModelChange,
  mode,
  onModeChange,
  workspace,
  onWorkspaceChange,
  workspaceLocked = false,
  sessionId,
  sessionTitle,
  lastUserMessage,
  editPrefill = null,
  inputInsert = null,
  editing = false,
  onCancelEdit,
  onSubmit,
  variant = "bottom",
  markdownLive: markdownLiveProp,
}: Props) {
  const [value, setValueState] = useState(() => loadInputDraft(sessionId));
  const valueRef = useRef(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<LexicalEditor | null>(null);
  const loadedForRef = useRef<string | null>(sessionId);
  const lastSnapshotRef = useRef<EditorSnapshot>(EMPTY_SNAPSHOT);
  /** Esc 关掉的那一版触发文本：文本没变就不要因光标变动重新弹出来。 */
  const dismissedRef = useRef<string | null>(null);

  // ── 图片附件（C55）：粘贴 / 拖放产生的图片，发送前以 chip 展示 ──────
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const liveSetting = useMarkdownLive();
  const markdownLive = markdownLiveProp ?? liveSetting;

  const setValue = useCallback((next: string) => {
    valueRef.current = next;
    setValueState(next);
  }, []);

  // ── @ 文件引用（保留旧行为）──────────────────────────────────────
  const [trigger, setTrigger] = useState<MentionTrigger | null>(null);
  const [mentionItems, setMentionItems] = useState<MentionItem[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionReqRef = useRef(0);

  // ── / 命令面板 ───────────────────────────────────────────────────
  const [cmd, setCmd] = useState<CommandState | null>(null);
  const [cmdIndex, setCmdIndex] = useState(0);
  const [skills, setSkills] = useState<SkillView[]>([]);
  const [goal, setGoal] = useState("");
  const goalRef = useRef("");

  // 切会话：装入该会话的草稿，同时把富文本编辑器内容一起换掉。
  useEffect(() => {
    if (loadedForRef.current === sessionId) return;
    loadedForRef.current = sessionId;
    const text = loadInputDraft(sessionId);
    setValue(text);
    if (editorRef.current) setEditorMarkdown(editorRef.current, text);
    setCmd(null);
    setCmdIndex(0);
    setTrigger(null);
    setMentionItems([]);
    mentionReqRef.current += 1;
  }, [sessionId, setValue]);

  // 编辑历史消息：原文放回输入框。刻意不写进草稿——编辑态的原文是系统填的。
  useEffect(() => {
    if (editPrefill === null) return;
    setValue(editPrefill);
    if (editorRef.current) setEditorMarkdown(editorRef.current, editPrefill);
    setCmd(null);
    setTrigger(null);
    setMentionItems([]);
    mentionReqRef.current += 1;
  }, [editPrefill, setValue]);

  // 拖放插入的路径：单张图片转成附件 chip（走 asset 通道），其余当作文本追加。
  useEffect(() => {
    if (!inputInsert) return;
    const text = inputInsert.text.trim();
    if (isSingleImagePath(text)) {
      const name = text.split(/[\\/]/).pop() ?? text;
      setAttachments((prev) => [
        ...prev,
        { id: crypto.randomUUID(), name, path: text },
      ]);
      return;
    }
    const next = valueRef.current.trim()
      ? `${valueRef.current} ${inputInsert.text}`
      : inputInsert.text;
    setValue(next);
    if (editorRef.current) setEditorMarkdown(editorRef.current, next);
  }, [inputInsert?.id, setValue]);

  // 每次输入即存。不节流：localStorage 同步写，输入频率下量级可接受。
  useEffect(() => {
    if (loadedForRef.current !== sessionId) return;
    saveInputDraft(sessionId, value);
  }, [value, sessionId]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = Math.floor(window.innerHeight / 3);
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [value, markdownLive]);

  // 长期目标按会话存储，切会话即换成该会话的。
  useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    getSessionGoal(sessionId)
      .then((g) => {
        // 值没变就不 set：测试里 invoke 桩返回 null，避免一次无意义的
        // 异步 setState 触发 act 警告；切会话回落到无目标时也能正确清空。
        const next = typeof g === "string" ? g : "";
        if (alive && goalRef.current !== next) {
          goalRef.current = next;
          setGoal(next);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [sessionId]);

  // 技能列表只在进入技能面板时拉一次，技能不会每敲一个键变一次。
  useEffect(() => {
    if (cmd?.view !== "skill") return;
    let alive = true;
    listSkills()
      .then((s) => {
        if (alive) setSkills(s);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [cmd?.view]);

  const activeItems = useMemo<CommandItem[]>(() => {
    if (!cmd) return [];
    switch (cmd.view) {
      case "root":
        return rootCommandItems(cmd.query);
      case "skill": {
        const items = skillCommandItems(skills, cmd.query);
        // 与全局面板同一套「最近使用」排序，位置不算搜索时由它决定
        return cmd.query
          ? items
          : rankByFrecency(items, loadFrecency(), Date.now());
      }
      case "model":
        return modelCommandItems(models, selectedModel, cmd.query);
      case "mode":
        return modeCommandItems(mode, cmd.query);
      case "export":
        return exportCommandItems();
      case "goal":
        return [];
    }
  }, [cmd, skills, models, selectedModel, mode]);

  function closeMentions() {
    setTrigger(null);
    setMentionItems([]);
    setMentionIndex(0);
    mentionReqRef.current += 1;
  }

  function closeCommand() {
    setCmd(null);
    setCmdIndex(0);
  }

  /** 取文件候选。请求带序号，回来时只认最新的那次。 */
  async function loadMentions(t: MentionTrigger) {
    const req = ++mentionReqRef.current;
    try {
      const files = await listWorkspaceFiles(sessionId, t.query, 50);
      if (req !== mentionReqRef.current) return;
      setMentionItems(fileItems(files, t.query));
      setMentionIndex(0);
    } catch {
      if (req === mentionReqRef.current) setMentionItems([]);
    }
  }

  /**
   * 依据光标处的文本重算浮层。
   *
   * `@` 仍是文件引用；`/` 现在先出**根命令**，精确命中某个别名
   * （`/skill`、`/目标`…）才进入二级面板。参数带空格也支持，因为
   * findSlashTrigger 交给 resolveSlashQuery 的是整段 query。
   */
  function updateTrigger(line: string, caret: number) {
    if (dismissedRef.current !== line) dismissedRef.current = null;

    const at = findTrigger(line, caret);
    if (at?.char === "@") {
      closeCommand();
      setTrigger(at);
      void loadMentions(at);
      return;
    }
    closeMentions();

    const slash = findSlashTrigger(line, caret);
    const dismissed = dismissedRef.current === line;
    if (slash && !dismissed) {
      const res = resolveSlashQuery(slash.query);
      if (res.command || res.matches.length > 0) {
        setCmd({
          view: res.command ?? "root",
          source: "slash",
          query: res.command ? res.args : slash.query,
          start: slash.start,
          end: slash.end,
        });
        setCmdIndex(0);
        return;
      }
    }
    closeCommand();
  }

  /** 两条编辑路径共用的变化入口。programmatic = 外部写入，只同步文本。 */
  function handleSnapshot(s: EditorSnapshot, programmatic: boolean) {
    lastSnapshotRef.current = s;
    setValue(s.markdown);
    if (programmatic) {
      closeCommand();
      closeMentions();
      return;
    }
    updateTrigger(s.line, s.caret);
  }

  function handleTextareaChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const text = e.currentTarget.value;
    const caret = e.currentTarget.selectionStart ?? text.length;
    handleSnapshot(
      { line: text, caret, markdown: text, indentable: false },
      false,
    );
  }

  /**
   * 替换一段文本。programmatic=true 时打标签，让 Lexical 的 OnChange
   * 只同步内容、不重新弹面板；false 用于「选中根命令 → 插入 /skill 」，
   * 需要让下一次解析把面板推进到二级。
   */
  function replaceRange(
    start: number,
    end: number,
    insert: string,
    programmatic: boolean,
  ) {
    const editor = editorRef.current;
    if (editor) {
      replaceTrigger(editor, start, end, insert, programmatic);
      return; // Lexical 的 OnChange 负责后续
    }
    const cur = valueRef.current;
    const next = cur.slice(0, start) + insert + cur.slice(end);
    setValue(next);
    if (programmatic) {
      closeCommand();
      closeMentions();
    } else {
      updateTrigger(next, start + insert.length);
    }
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const caret = start + insert.length;
      el.setSelectionRange(caret, caret);
    });
  }

  function applyText(next: string) {
    setValue(next);
    if (editorRef.current) setEditorMarkdown(editorRef.current, next);
    closeCommand();
    closeMentions();
  }

  function submit() {
    const text = valueRef.current.trim();
    if (busy) return;
    // 没内容也没附件就发不出去；没定工作区同样不行。
    if (!text && attachments.length === 0) return;
    if (!workspace) return;
    const imgs: ImageRef[] = attachments.map(({ id: _id, ...rest }) => rest);
    // 无附件时保持单参数调用（历史行为，测试与既有调用方都按这个签名断言）。
    if (onSubmit) {
      if (imgs.length) onSubmit(text, imgs);
      else onSubmit(text);
    } else if (imgs.length) {
      onSend(text, imgs);
    } else {
      onSend(text);
    }
    applyText("");
    saveInputDraft(sessionId, "");
    setAttachments([]);
  }

  /** 粘贴图片：从剪贴板取出图片文件，生成缩略图 chip（无真实路径，用 blob URL）。 */
  function handlePaste(e: ClipboardEvent<HTMLDivElement>) {
    const dt = e.clipboardData;
    if (!dt) return;
    const files = Array.from(dt.items)
      .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f);
    if (files.length === 0) return;
    e.preventDefault();
    const added = files.map<Attachment>((f) => ({
      id: crypto.randomUUID(),
      name: f.name || `pasted-image-${Date.now()}.png`,
      url: URL.createObjectURL(f),
    }));
    setAttachments((prev) => [...prev, ...added]);
  }

  /** 选中面板条目后的收尾：清掉触发词（plus 来源则按需插入文本）。 */
  function finishCommand(insert = "") {
    const c = cmd;
    closeCommand();
    if (!c) return;
    if (c.source === "slash") {
      replaceRange(c.start, c.end, insert, true);
    } else if (insert) {
      const editor = editorRef.current;
      if (editor) insertAtCaret(editor, insert);
      else setValue(valueRef.current + insert);
    }
  }

  async function runExport() {
    try {
      const ok = await downloadSessionZip(sessionId, sessionTitle);
      if (ok) notify("ok", "日志已导出");
    } catch (e) {
      notify("error", `导出失败：${String(e)}`);
    }
  }

  async function saveGoal(text: string) {
    const trimmed = text.trim();
    try {
      await setSessionGoal(sessionId, trimmed);
      goalRef.current = trimmed;
      setGoal(trimmed);
    } catch (e) {
      notify("error", `目标保存失败：${String(e)}`);
    }
    finishCommand("");
  }

  function pickCommand(item: CommandItem) {
    const c = cmd;
    if (!c) return;
    if (c.view === "root") {
      const id = item.id as CommandId;
      if (c.source === "plus") {
        setCmd({ ...c, view: id, query: "" });
        setCmdIndex(0);
      } else {
        const alias = SLASH_COMMANDS.find((x) => x.id === id)?.aliases[0] ?? id;
        replaceRange(c.start, c.end, `/${alias} `, false);
      }
      return;
    }
    switch (c.view) {
      case "skill":
        recordUse(`skill:${item.id}`);
        finishCommand(`/${item.id} `);
        break;
      case "model":
        onModelChange(item.id);
        finishCommand();
        break;
      case "mode":
        onModeChange(item.id as Mode);
        finishCommand();
        break;
      case "export":
        finishCommand();
        void runExport();
        break;
      case "goal":
        break;
    }
  }

  function pickMention(item: MentionItem) {
    const t = trigger;
    if (!t) return;
    closeMentions();
    replaceRange(t.start, t.end, `${item.insert} `, true);
  }

  function openPlusMenu() {
    closeMentions();
    dismissedRef.current = null;
    setCmd({ view: "root", source: "plus", query: "", start: -1, end: -1 });
    setCmdIndex(0);
  }

  function dismiss() {
    dismissedRef.current = lastSnapshotRef.current.line;
    closeCommand();
    closeMentions();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.nativeEvent.isComposing) return;

    // 命令面板优先：浮层开着时回车是「选中」，不是「发送」。
    if (cmd) {
      if (e.key === "ArrowDown" && activeItems.length > 0) {
        consume(e);
        setCmdIndex((i) => (i + 1) % activeItems.length);
        return;
      }
      if (e.key === "ArrowUp" && activeItems.length > 0) {
        consume(e);
        setCmdIndex((i) => (i - 1 + activeItems.length) % activeItems.length);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        consume(e);
        const item = activeItems[cmdIndex] ?? activeItems[0];
        if (item) pickCommand(item);
        return; // goal 面板由它自己的输入框接管回车
      }
      if (e.key === "Escape") {
        consume(e);
        dismiss();
        return;
      }
      // 面板开着时 Tab 只关面板、不拦默认行为：吞掉 Tab 等于把
      // 键盘用户锁在输入框里（WCAG 2.1.2 无键盘陷阱）。
      if (e.key === "Tab") {
        closeCommand();
        return;
      }
    }

    // @ 文件面板开着时，方向键与回车归它。
    if (mentionItems.length > 0) {
      if (e.key === "ArrowDown") {
        consume(e);
        setMentionIndex((i) => (i + 1) % mentionItems.length);
        return;
      }
      if (e.key === "ArrowUp") {
        consume(e);
        setMentionIndex((i) => (i - 1 + mentionItems.length) % mentionItems.length);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        consume(e);
        pickMention(mentionItems[mentionIndex] ?? mentionItems[0]);
        return;
      }
      if (e.key === "Escape") {
        consume(e);
        closeMentions();
        return;
      }
    }

    // 上方向键召回上一条输入，仅在输入框为空时生效。
    if (e.key === "ArrowUp" && !valueRef.current && lastUserMessage) {
      consume(e);
      applyText(lastUserMessage);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      consume(e);
      submit();
    }
  }

  const placeholder =
    mode === "plan"
      ? "描述你想做的事，先让 Aura 给出计划…"
      : mode === "build"
        ? "描述要执行的任务…"
        : "输入消息…";

  return (
    <div className={variant === "inline" ? "w-full" : "px-6 pb-5 pt-3"}>
      {/* 编辑历史消息时的提示条 */}
      {editing && (
        <AlertBar
          variant="edit"
          className={`mx-auto mb-2 ${CONTENT_WIDTH}`}
          icon={<Pencil size={12} />}
          action={
            onCancelEdit && (
              <button
                type="button"
                onClick={onCancelEdit}
                className="rounded-md border border-line px-2 py-0.5 text-[11px] text-subtle transition-colors hover:border-brand hover:text-brand"
              >
                取消
              </button>
            )
          }
        >
          <span className="text-foreground">正在编辑之前的消息，发送后将替换它</span>
        </AlertBar>
      )}
      <GoalBar
        goal={goal}
        onEdit={() => {
          setCmd({
            view: "goal",
            source: "plus",
            query: goal,
            start: -1,
            end: -1,
          });
          setCmdIndex(0);
        }}
        onClear={() => void saveGoal("")}
      />
      {/* @ 文件引用浮层 */}
      {mentionItems.length > 0 && trigger && (
        <MentionMenu
          kind={trigger.kind}
          items={mentionItems}
          activeIndex={mentionIndex}
          onPick={pickMention}
          onHover={setMentionIndex}
        />
      )}
      {/* / 命令 / 加号共用的面板；鼠标与键盘走同一份 pickCommand。 */}
      {cmd && (
        <CommandMenu
          title={CMD_TITLES[cmd.view]}
          items={activeItems}
          activeIndex={cmdIndex}
          onHover={setCmdIndex}
          onPick={pickCommand}
          header={
            cmd.view === "goal" ? (
              <GoalPanel
                initial={cmd.query}
                onSave={(text) => void saveGoal(text)}
                onClear={() => void saveGoal("")}
              />
            ) : undefined
          }
          hint={
            cmd.view === "skill" && skills.length === 0
              ? "正在加载技能…"
              : CMD_HINT
          }
          emptyText={
            cmd.view === "model" && models.length === 0
              ? "还没有可用模型，请先在设置页添加"
              : undefined
          }
        />
      )}
      {/* 图片附件 chip：粘贴 / 拖放图片后出现在输入框上方 */}
      {attachments.length > 0 && (
        <div className={`mx-auto mb-2 flex flex-wrap gap-2 ${CONTENT_WIDTH}`}>
          {attachments.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-2 rounded-tag border border-line bg-surface px-2 py-1.5"
            >
              <img
                src={a.path ? assetUrl(a.path) : a.url}
                alt={a.name}
                className="h-9 w-9 shrink-0 rounded object-cover"
              />
              <span className="max-w-[10rem] truncate text-[11px] text-foreground" title={a.name}>
                {a.name}
              </span>
              <button
                type="button"
                onClick={() => setAttachments((p) => p.filter((x) => x.id !== a.id))}
                aria-label="移除附件"
                className="shrink-0 rounded p-0.5 text-subtle transition-colors hover:bg-bubble hover:text-danger"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      {/* 不给卡片加 focus-within 描边：整块亮蓝边是网页表单的观感。 */}
      <div
        onPaste={handlePaste}
        className={`mx-auto flex ${CONTENT_WIDTH} flex-col rounded-card border border-line bg-surface px-4 py-3 shadow-xs transition-[border-color,box-shadow] duration-200 focus-within:border-brand/30 focus-within:shadow-sm`}
      >
        {markdownLive ? (
          <MarkdownEditor
            initialValue={value}
            editorRef={editorRef}
            onChange={handleSnapshot}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
          />
        ) : (
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            aria-label="消息输入框"
            className="max-h-[33vh] min-h-12 w-full resize-none overflow-y-auto bg-transparent py-0.5 text-[15px] leading-6 outline-none placeholder:text-subtle"
          />
        )}
        {/* 工具行。flex-wrap：窄屏时右侧控件折行而不是被挤掉。 */}
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {/* 加号：与输入 `/` 打开同一个命令面板 */}
            <button
              type="button"
              onClick={openPlusMenu}
              aria-label="插入命令"
              title="插入命令"
              className="rounded-full border border-line p-1.5 text-subtle transition-colors hover:bg-bubble hover:text-foreground"
            >
              <Plus size={14} aria-hidden />
            </button>
            <ModeTabs mode={mode} onChange={onModeChange} />
          </div>
          <div className="flex min-w-0 items-center gap-3">
            {!workspaceLocked && (
              <WorkspaceSelect
                workspace={workspace}
                onChange={onWorkspaceChange}
              />
            )}
            <ModelSelect
              models={models}
              selectedModel={selectedModel}
              onChange={onModelChange}
            />
            {busy ? (
              <button
                type="button"
                onClick={onStop}
                aria-label="停止生成"
                className="rounded-full border border-line p-2 text-subtle transition-colors hover:bg-bubble hover:text-foreground"
              >
                <Square size={14} />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={(!value.trim() && attachments.length === 0) || !workspace}
                aria-label={workspace ? "发送" : "请先选择工作区"}
                className="rounded-full bg-brand p-2 text-white transition-colors enabled:hover:bg-brand-strong disabled:opacity-30"
              >
                <ArrowUp size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
      {/* 统计行固定两段：左侧数据、右侧提示。此前按「有没有输入」插入第三个
          子元素，justify-between 会把两侧一起推着左右跳。 */}
      <div className={`mx-auto mt-2 flex ${CONTENT_WIDTH} items-center justify-between gap-3`}>
        <div className="flex min-w-0 items-center gap-3">
          <StatsPills />
          <TurnUsagePanel />
          <ContextWaterBar
            contextLimit={
              models.find((m) => m.key === selectedModel)?.context_limit ??
              models.find((m) => m.id === selectedModel)?.context_limit
            }
          />
        </div>
        <p className="shrink-0 text-xs text-subtle">
          Enter 发送 · Shift+Enter 换行 · Ctrl+Shift+M 切模式
        </p>
      </div>
    </div>
  );
}
