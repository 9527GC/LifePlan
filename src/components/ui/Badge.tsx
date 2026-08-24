import { Tag } from "antd";

export default function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "blue" | "green" | "orange" | "red" | "neutral" }) {
  const color = tone === "neutral" ? "default" : tone === "orange" ? "gold" : tone;
  return <Tag color={color}>{children}</Tag>;
}
