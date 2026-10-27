import HelpTooltip from "./HelpTooltip";

export default function FrogHelp() {
  return <HelpTooltip label="青蛙法则说明"><p>出自博恩・崔西的《吃掉那只青蛙》一书，青蛙法则（Eat That Frog ）核心思想为<span className="frog-core-idea">「一天里最重要、最难、最容易拖延的任务，建议早上精力最好的时候优先干掉它」</span>。</p><p>实操组合用法：</p><ol><li>收集所有事务，加工为下一步行动；</li><li>每日结束，从行动清单里选出 1-2 只 “青蛙” 打上标记；</li><li>第二天高精力时段优先处理标记的青蛙，再根据排序逻辑完成该日其他行动。</li></ol></HelpTooltip>;
}
