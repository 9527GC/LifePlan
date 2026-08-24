import type { ReactNode } from "react";
import { Modal as AntModal } from "antd";

export default function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  return <AntModal open={open} title={title} onCancel={onClose} footer={null} destroyOnHidden>{children}</AntModal>;
}
