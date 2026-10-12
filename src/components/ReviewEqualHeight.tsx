import { Children, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "antd";
import { ChevronDown, ChevronUp } from "lucide-react";

/** 取两侧自然高度中的较小值，仅折叠较高的一侧。 */
export default function ReviewEqualHeight({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [heights, setHeights] = useState<number[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  useLayoutEffect(() => {
    const contents = Array.from(rootRef.current?.querySelectorAll<HTMLElement>(".review-equal-content") ?? []);
    const measure = () => {
      const next = contents.map(content => Math.ceil(content.getBoundingClientRect().height) + 2);
      setHeights(previous => next.every((height, index) => height === previous[index]) ? previous : next);
    };
    const observer = new ResizeObserver(measure);
    contents.forEach(content => observer.observe(content));
    measure();
    return () => observer.disconnect();
  }, []);
  const minimum = heights.length ? Math.min(...heights) : undefined;
  return <div ref={rootRef} className="review-execution-focus-grid review-equal-grid">
    {Children.toArray(children).map((child, index) => {
      const overflows = minimum != null && heights[index] > minimum + 1;
      const isExpanded = overflows && expanded === index;
      return <div key={index} className={`review-equal-panel${overflows && !isExpanded ? " is-collapsed" : ""}`} style={{ height: minimum == null || isExpanded ? undefined : minimum }}>
        <div className="review-equal-viewport"><div className="review-equal-content">{child}</div></div>
        {overflows && <div className="review-equal-actions"><Button type="text" aria-expanded={isExpanded} icon={isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />} onClick={() => setExpanded(isExpanded ? null : index)}>{isExpanded ? "收起" : "展开全部"}</Button></div>}
      </div>;
    })}
  </div>;
}
