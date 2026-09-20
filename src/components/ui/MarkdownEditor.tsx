import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";

type Props = {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  minHeight?: number;
  maxHeight?: number;
  // 由父组件传入的 ref，挂载后写入 editor.getHTML()，供“复制为富文本”使用
  getHtmlRef?: { current: () => string };
};

// 所见即所得编辑器：不渲染任何工具条/菜单，格式化通过 Markdown 语法或快捷键（Ctrl/Cmd+B、Shift+Enter 换行）完成；对外读写始终是 Markdown 文本，兼容既有日志数据与 AI 链路。
// breaks:true 让段落内的换行（含 Shift+Enter 硬换行）在解析时保留；层级缩进请用嵌套列表，编辑器会原样保留其缩进与换行。
export default function MarkdownEditor({ value, onChange, placeholder, minHeight = 160, maxHeight, getHtmlRef }: Props) {
  const latestRef = useRef(value);
  latestRef.current = value;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
      Markdown.configure({ html: false, tightLists: true, breaks: true }),
      Placeholder.configure({ placeholder: placeholder || "" }),
    ],
    content: value || "",
    editorProps: {
      attributes: {
        class: "md-wysiwyg",
        style: `min-height:${minHeight}px;${maxHeight ? `max-height:${maxHeight}px;overflow:auto;` : ""}`,
      },
    },
    onUpdate: ({ editor }) => {
      const md = (editor.storage as any)?.markdown?.getMarkdown?.() as string ?? "";
      latestRef.current = md;
      onChange(md);
    },
  });

  // 外部值变化（切换日期 / AI 生成回填）时同步进编辑器；打字过程中 value 与 latestRef 相同则不重置，避免光标跳动。
  useEffect(() => {
    if (!editor) return;
    if (value !== latestRef.current) {
      latestRef.current = value;
      editor.commands.setContent(value || "", false);
    }
  }, [value, editor]);

  // 暴露富文本 HTML 读取能力
  useEffect(() => {
    if (getHtmlRef) getHtmlRef.current = () => editor?.getHTML() ?? "";
  }, [editor, getHtmlRef]);

  return <EditorContent editor={editor} />;
}
