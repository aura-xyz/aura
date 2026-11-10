/**
 * 把焦点交回输入框（v0.8.1 P09）。
 *
 * InputArea 自持 textareaRef / editorRef，且可能渲染 textarea 或 Lexical
 * 编辑器两条路径；用自定义事件比层层 forwardRef 更省事，也不会让浮层组件
 * 依赖输入框组件的实例类型。没挂载时事件静默丢弃，不会抛错。
 */
const EVENT = "aura:focus-input";

export const FOCUS_INPUT_EVENT = EVENT;

export function focusInput(): void {
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function onFocusInput(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
