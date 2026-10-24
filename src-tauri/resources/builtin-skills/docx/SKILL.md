---
name: docx
description: 创建、读取或修改 Word 文档（.docx/.dotx）时使用。触发场景：提到 Word 文档、.docx/.dotx 后缀、需要目录/标题/页码/页眉信纸等排版的专业文档，或从现有 docx 提取、重排内容，插入替换图片，查找替换，处理修订（红线）与批注，以及把内容整理成一份精致 Word 文档。用户要「报告」「备忘录」「信函」「模板」且以 Word 形式交付时也用本技能。不要用于 PDF、电子表格、在线协作文档或与文档生成无关的编码任务。
version: 1.0.0
license: Proprietary. LICENSE.txt has complete terms
allowed-tools:
  - read_file
  - list_files
  - search_workspace
  - write_file
  - string_replace
  - replace_lines
  - run_script
---

# Aura 运行约定（先读这一节）

这一节覆盖下文所有与「怎么跑命令」有关的描述，冲突时以本节为准。

**执行环境**

- `run_script` 的工作目录是**用户工作区根目录**，相对路径都相对它；一次只跑一条命令（用 `&` 串接也算一条）。
- 路径一律用正斜杠。`read_file` / 写入工具只能访问工作区内的文件。
- 默认 shell 是 Windows `cmd`：**没有 bash**，`unzip` / `zip` / `find` / `rm -rf` / `pdftoppm` 都不保证存在。要解包 / 打包 docx 用下面给的小脚本（Python 标准库）。
- 本技能自带的脚本在 `<skill_dir>/scripts/`，`<skill_dir>` 见 `load_skill` 回执里的「技能目录」。调用它们必须写**绝对路径**，因为它不在工作区里：

  ```cmd
  python "C:/<skill_dir>/scripts/merge_runs.py" unpacked/
  ```

- 读技能自带的参考文档或脚本源码，用 `load_skill` 的 `file` 参数：
  `{"name": "docx", "file": "scripts/comment.py"}`。

**依赖并非预装**。动手前先探测，缺什么就直接告诉用户，不要连着试到报错：

| 用途 | 探测命令 | 缺了怎么办 |
|---|---|---|
| Node + docx（新建文档） | `node -e "require('docx');console.log('ok')"` | 在工作区里 `npm init -y` 后 `npm install docx` |
| Python（自带脚本） | `python --version` | 让用户装 Python 3 |
| defusedxml（校验 / 批注 / 合并 run） | `python -c "import defusedxml;print('ok')"` | `pip install defusedxml` |
| LibreOffice（渲染核对、.doc 转换） | `soffice --version` | 跳过渲染核对，只做 XML 级校验，并向用户说明 |
| pandoc（快速读文本） | `pandoc --version` | 改用 python-docx，或直接解析 XML |

# 核心判断：怎么改这份文档

`.docx` 就是一个装着 XML 的 zip。先按任务选路子：

| 任务 | 做法 |
|---|---|
| **新建**文档 | 在工作区写一个 `docx` (npm) 脚本并 `node` 跑它——见下面的坑 |
| **修改**已有文档 | 解包 → 改 `word/document.xml` → 重新打包（docx-js 打不开已有文件） |
| **读取**内容 | 有 pandoc 用 `pandoc -t markdown in.docx`；没有就用 python-docx，或直接解析 XML |

## 解包 / 重新打包（Windows 可用）

在工作区建两个小脚本，之后反复用（比记 bash 单行命令可靠）：

```python
# unpack.py
import sys, zipfile
zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])
```

```python
# pack.py
import sys, zipfile, os
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk(src):
        for f in files:
            p = os.path.join(root, f)
            z.write(p, os.path.relpath(p, src).replace("\\", "/"))
```

```cmd
python unpack.py in.docx unpacked & python pack.py unpacked out.docx
```

**改 XML 的纪律**：只改需要改的节点，**不要格式化、不要美化缩进**——重排会导致 Word 打不开或整段失去格式。用 `string_replace` 做定点替换，别整文件重写。

Word 会把一段文字拆成许多 `<w:r>` run（修订号、拼写标记），所以你能看见的一句话在 XML 里常常不是连续字符串。`merge_runs.py` 会合并相邻且格式相同的 run，不改内容也不影响观感，跑完再替换：

```cmd
python "C:/<skill_dir>/scripts/merge_runs.py" unpacked/
```

## 用 docx-js 新建——容易踩的坑

`docx` 没有预装，先按上表探测。API 你可以直接回忆，真正坑人的是这些默认值：

- **页面默认 A4**。要 US Letter 得显式给 `page: { size: { width: 12240, height: 15840 } }`（单位 DXA，1440 = 1 英寸）。
- **横向**：传纵向尺寸再加 `orientation: PageOrientation.LANDSCAPE`——docx-js 内部会自己交换宽高。
- **表格要双份宽度**：表格设 `columnWidths`，每个单元格再设 `width`，都用 `WidthType.DXA`（`PERCENTAGE` 在 Google Docs 里会崩）。列宽之和必须等于表格宽度。
- **表格底纹**用 `ShadingType.CLEAR`，绝不要 `SOLID`（渲染成黑块）。
- **列表**不要手打 `•`，用 `numbering` 配 `LevelFormat.BULLET`。
- **`ImageRun` 必须给 `type:`**（`"png"`、`"jpg"` …）。
- **`PageBreak` 只能放在 `Paragraph` 里**。
- **不要用 `\n` 换行**，用多个 `Paragraph`。
- **目录**：标题必须用内置 `HeadingLevel.*`；自定义标题样式要设 `outlineLevel`，否则不进目录。
- **别用表格画横线**，用段落底边框。
- **点线引导 / 同一行左右对齐**：用 `PositionalTab`（`alignment: PositionalTabAlignment.RIGHT`、`leader: PositionalTabLeader.DOT`）放进 `TextRun`，不要靠打点或补空格。

## 交付前核对

有 LibreOffice 就渲染出来看一眼（这是唯一能发现「表格串版、文字压字」的办法）：

```cmd
python "C:/<skill_dir>/scripts/office/soffice.py" --headless --convert-to pdf out.docx
```

再把 PDF 转成图片检查。没有 `pdftoppm` 时用 Python：若 `python -c "import fitz"` 可用就用 PyMuPDF 逐页导出 PNG；否则退回 XML 级校验，并明确告诉用户「我没能渲染核对」：

```cmd
python "C:/<skill_dir>/scripts/office/validate.py" out.docx --original in.docx
```

（`validate.py` 做 XSD 校验，`--auto-repair` 修常见问题；做红线时加 `--author "<你的名字>"` 检查每处改动都被修订包裹。需要 `defusedxml`。）

## .doc（旧格式）

先转换再处理，没有 LibreOffice 就直说做不了：

```cmd
python "C:/<skill_dir>/scripts/office/soffice.py" --headless --convert-to docx file.doc
```

## 修订（红线）与批注

**修订**：改动要用 `<w:ins>` / `<w:del>` 包住，带 `w:id`、`w:author`、`w:date`。`<w:del>` 内部的文字元素是 `<w:delText>` 而不是 `<w:t>`。删除段落标记（`<w:pPr><w:rPr><w:del .../></w:rPr></w:pPr>`）表示「与下一段合并」，所以彻底删掉一段 = 加这个 + 给每个 run 套 `<w:del>`。`<w:del/>` 必须排在 `rPr` 其它子元素**之前**，顺序是 schema 强制的。

全盘接受修订另存干净版：`python "C:/<skill_dir>/scripts/accept_changes.py" in.docx out.docx`（需要 LibreOffice）。

> 接受被删的段落标记后，该段应与下一段合并，所以「run 全被删除」的段落本该消失。Word 这么做，但 `accept_changes.py`（走 LibreOffice）与 `pandoc --track-changes=accept` 不一定：两者都会清掉文字却留下空段落，自动编号时看起来像一个多余的空条目。这是视图产物，不是文档缺陷——判据是看 XML 里的段落删除标记。

**批注**要牵动六个互相引用的部件，别手写，用脚本：

```cmd
python "C:/<skill_dir>/scripts/comment.py" unpacked/ "这里的费用上限偏低"
python "C:/<skill_dir>/scripts/comment.py" unpacked/ "同意" --parent 0
python "C:/<skill_dir>/scripts/comment.py" contract.docx "这段要改" -o annotated.docx
```

它会写好 `comments.xml`、`commentsExtended.xml`、`commentsIds.xml`、`commentsExtensible.xml`、关系与 content-type 覆盖，ID 自动分配。之后会打印一段 `<w:commentRangeStart/>` / `<w:commentRangeEnd/>` / `<w:commentReference/>` 片段——**必须把这段插进 `word/document.xml` 的对应位置**，否则批注存在但看不见。

## 交付

产物写到工作区里，用相对路径告诉用户在哪。不要声称做过渲染核对，除非真的跑成功了。
