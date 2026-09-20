import { message } from "antd";
import { FolderOpen } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

/** 展示"文件已保存"提示，并提供带图标的"查看"按钮打开文件所在文件夹。 */
export function showSavedToast(text: string, path: string) {
  const node = (
    <span className="saved-file-toast">
      <span className="saved-file-toast-text">{text}</span>
      <button type="button" className="saved-file-toast-link" onClick={() => {
        void revealItemInDir(path).catch(() => message.error("无法打开所在文件夹"));
      }}>
        <FolderOpen size={14} />
        <span>查看</span>
      </button>
    </span>
  );
  message.success({ key: "saved-file-toast", duration: 6, content: node });
}
