import { useEffect, useRef } from "react";
import { init, use } from "echarts/core";
import { PieChart } from "echarts/charts";
import { TooltipComponent, GraphicComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";

use([PieChart, TooltipComponent, GraphicComponent, CanvasRenderer]);

type Quadrant = { name: string; count: number; minutes: number; done: number };

export default function ReviewPriorityChart({ quadrants }: { quadrants: Quadrant[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = init(container);
    const total = quadrants.reduce((sum, item) => sum + item.minutes, 0);
    // 图表使用柔和的中等饱和度配色，保留四象限的红、绿、橙、灰语义。
    const colors = ["#E98787", "#8DBB91", "#E7AD72", "#A8B2C1"];
    const option: EChartsOption = {
      color: colors,
      tooltip: {
        trigger: "item",
        // 限制提示框在图表内，避免被外层滚动容器裁切。
        confine: true,
        backgroundColor: "#fff",
        borderColor: "#e8edf3",
        textStyle: { color: "#46556f", fontSize: 12 },
        formatter: (params) => {
          const itemParams = Array.isArray(params) ? params[0] : params;
          const item = quadrants[itemParams.dataIndex];
          if (!item) return "暂无计划时长";
          const percentage = total ? Math.round(item.minutes / total * 100) : 0;
          const titleColor = ["#c85f5f", "#56855b", "#ad7439", "#68778c"][itemParams.dataIndex];
          return '<strong style="color:' + titleColor + '">' + item.name + '</strong>' + "<br/>计划行动：" + item.count + " 项<br/>计划时长：" + item.minutes + " 分钟（" + percentage + "%）<br/>已完成：" + item.done + " 项";
        },
      },
      graphic: [{
        // 整组文案按实际文字高度居中，数字、单位与说明使用不同视觉层级。
        type: "text", left: "center", top: "middle", silent: true,
        style: {
          text: '{value|' + total + '}{unit| 分钟}\n{caption|' + (total ? '计划时长占比' : '暂无计划时长') + '}',
          align: "center",
          rich: {
            value: { fontSize: 28, fontWeight: 600, fill: "#25324b", lineHeight: 36 },
            unit: { fontSize: 11, fontWeight: 400, fill: "#8491a5", padding: [8, 0, 0, 3] },
            caption: { fontSize: 12, fontWeight: 400, fill: "#8b98ab", lineHeight: 22, align: "center" },
          },
        },
      }],
      series: [{
        type: "pie", radius: ["50%", "78%"], center: ["50%", "50%"],
        // 零占比保留在数据与右侧四象限中，不为其虚构时间面积。
        stillShowZeroSum: false,
        itemStyle: { borderRadius: 8, borderColor: "#fff", borderWidth: 2 },
        label: { show: false }, labelLine: { show: false },
        // 悬停只显示详细提示框，不额外显示扇区标题。
        emphasis: { scale: true, scaleSize: 5, label: { show: false }, labelLine: { show: false } },
        data: quadrants.map(item => ({ name: item.name, value: item.minutes })),
      }],
    };
    chart.setOption(option);
    chart.on("mouseover", () => chart.setOption({ graphic: [{ invisible: true }] }));
    chart.on("mouseout", () => chart.setOption({ graphic: [{ invisible: false }] }));
    chart.on("globalout", () => chart.setOption({ graphic: [{ invisible: false }] }));
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(container);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [quadrants]);
  return <div ref={containerRef} className="review-priority-echart" role="img" aria-label={quadrants.map(item => item.name + "：" + item.minutes + " 分钟，" + item.count + " 项，已完成 " + item.done + " 项").join("；")} />;
}
