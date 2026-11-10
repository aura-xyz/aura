/**
 * 流式 Markdown 的「稳定片段」切分（v0.8.1 P02）。
 *
 * 流式期间最后一条消息每帧都会拿到新的 content，整段交给 react-markdown
 * 重解析：回答越长，每帧重复解析的已完成正文越多。这里把文本按 CommonMark
 * 的块边界（空行）切成若干片段，前面的片段文本恒定，用 React.memo 缓存后
 * 就不再参与解析；只有尾部那段「正在写」的文本每帧重解析，长度天然有界。
 *
 * 两个关键约束：
 * - 切片必须**无损**：parts.join("") === content。因此按字符下标切，而不是
 *   把 split("\n") 的结果再 join 回去（后者会吞掉分隔用的换行）。
 * - 围栏代码块内部绝不切开：里面可能有空行，也可能正处在「未闭合」状态。
 *   切开会得到两段各带半个 ``` 的非法 Markdown。
 */

/** 短回答不切：切分本身有成本，短文本每帧重解析也便宜。 */
const MIN_SPLIT_CHARS = 800;
/** 只在累计够长时才落一个稳定片段，避免长回答里切出成百上千个碎片段。 */
const MIN_SEGMENT_CHARS = 200;

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/**
 * 把 Markdown 文本切成可直接拼接还原的片段数组。
 *
 * 每个片段单独交给 react-markdown 解析；相邻片段之间不产生额外 DOM 包装，
 * 因此 `.md > * + *` 之类的样式与整段解析时完全一致。
 *
 * 已知边界：跨片段的 Markdown 引用（链接引用定义、脚注定义）会失效，
 * 这类写法在模型输出里极少，用「不重复解析长正文」换它是划算的。
 * 完全没有空行的超长单段落无法再切，仍是整段解析。
 */
export function splitMarkdown(content: string): string[] {
  if (content.length < MIN_SPLIT_CHARS) return [content];

  // 每行起始的字符下标。用它切片才能让片段首尾自带原本的换行符。
  const lineStarts: number[] = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") lineStarts.push(i + 1);
  }
  const lines = content.split("\n");

  const parts: string[] = [];
  let segStart = 0;
  let fenceChar = "";
  let fenceLen = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (fenceChar) {
      const close = FENCE_CLOSE.exec(line);
      if (
        close &&
        close[1][0] === fenceChar &&
        close[1].length >= fenceLen
      ) {
        fenceChar = "";
        fenceLen = 0;
      }
      // 围栏内的空行不是块边界
      continue;
    }

    const open = FENCE_OPEN.exec(line);
    if (open) {
      fenceChar = open[1][0];
      fenceLen = open[1].length;
      continue;
    }

    if (line.trim() !== "") continue;
    const at = lineStarts[i];
    if (at === undefined || at - segStart < MIN_SEGMENT_CHARS) continue;
    parts.push(content.slice(segStart, at));
    segStart = at;
  }

  parts.push(content.slice(segStart));
  return parts;
}

/**
 * 文本里是否存在**未闭合**的围栏代码块（v0.8.1 P03）。
 *
 * 流式输出代码时，尾部几乎每帧都是半个 ``` 代码块；rehype-highlight 会对
 * 这段残缺代码反复尝试高亮，是长回答掉帧的主要来源之一。P03 用它让尾部
 * 片段先走纯文本渲染，等围栏闭合了再一次性高亮。
 */
export function hasUnclosedFence(content: string): boolean {
  const lines = content.split("\n");
  let fenceChar = "";
  let fenceLen = 0;

  for (const line of lines) {
    if (fenceChar) {
      const close = FENCE_CLOSE.exec(line);
      if (
        close &&
        close[1][0] === fenceChar &&
        close[1].length >= fenceLen
      ) {
        fenceChar = "";
        fenceLen = 0;
      }
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      fenceChar = open[1][0];
      fenceLen = open[1].length;
    }
  }
  return fenceChar !== "";
}
