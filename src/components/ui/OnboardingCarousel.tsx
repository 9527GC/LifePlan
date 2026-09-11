import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, Circle, Clock3, Flag, Inbox, ListChecks, Play, Sparkles, Target, Timer, X } from "lucide-react";
import { track } from "@/lib/analytics";

type OnboardingCarouselProps = { onFinish: () => void };

type Slide = {
  eyebrow: string;
  problem: string;
  solutionTitle: string;
  solution: string;
  accent: string;
  accentSoft: string;
  illustration: (accent: string, accentSoft: string) => ReactNode;
};

const slides: Slide[] = [
  {
    eyebrow: "01 / 收集",
    problem: "要做的事情繁多杂乱，千头万绪，不知道从哪里下手",
    solutionTitle: "先把事情放进事件篮",
    solution: "把脑海里的事项全部记录下来，再像整理衣柜一样，把乱衣服一件件拿出来，分清轻重缓急，逐项处理。",
    accent: "#5b6cff",
    accentSoft: "#e9edff",
    illustration: (accent, soft) => <div className="onboarding-art art-inbox"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="art-inbox-card"><Inbox size={28} /><span>事件篮</span><small>把杂乱先放进来</small></div><div className="art-chip chip-one"><Check size={13} />买菜</div><div className="art-chip chip-two"><Circle size={13} />写报告</div><div className="art-chip chip-three"><Flag size={13} />预约体检</div><Sparkles className="art-sparkle" size={22} color={accent} /><div className="art-glow" style={{ background: soft }} /></div>,
  },
  {
    eyebrow: "02 / 拆解",
    problem: "某件事情难度大，难以启动、无从着手",
    solutionTitle: "从最小的一步开始",
    solution: "把大目标拆成一个个看得见的小行动，用更低的开始成本，一步一步啃下看似难以完成的事情。",
    accent: "#11a683",
    accentSoft: "#e2f8f1",
    illustration: (accent, soft) => <div className="onboarding-art art-steps"><div className="art-stair stair-back" /><div className="art-stair stair-mid" /><div className="art-stair stair-front" /><div className="art-step-label label-one">明确下一步</div><div className="art-step-label label-two">完成一个小动作</div><div className="art-step-label label-three">持续向前</div><div className="art-person"><div className="person-head" /><div className="person-body" style={{ background: accent }} /><div className="person-leg leg-left" /><div className="person-leg leg-right" /></div><div className="art-glow" style={{ background: soft }} /></div>,
  },
  {
    eyebrow: "03 / 计划",
    problem: "一天时间匆匆流逝，回顾却不知道干了什么",
    solutionTitle: "让每一天都清晰可控",
    solution: "制定每日计划，记录每个时间段做了什么、没做什么，晚上复盘，找到让明天更好的方法。",
    accent: "#e58a25",
    accentSoft: "#fff2dc",
    illustration: (accent, soft) => <div className="onboarding-art art-calendar"><div className="calendar-card"><div className="calendar-head"><span>今日计划</span><Clock3 size={17} /></div><div className="calendar-row done"><Check size={14} />晨间整理 <b>08:00</b></div><div className="calendar-row active"><Timer size={14} />专注工作 <b>09:30</b></div><div className="calendar-row"><Circle size={14} />晚间复盘 <b>21:30</b></div><div className="calendar-progress"><span style={{ background: accent, width: "68%" }} /></div><small>今天已完成 68%</small></div><div className="art-note note-one">时间</div><div className="art-note note-two">目标</div><div className="art-glow" style={{ background: soft }} /></div>,
  },
  {
    eyebrow: "04 / 专注",
    problem: "做事时，难以专注，难以坚持",
    solutionTitle: "专注25分钟&休息5分钟",
    solution: "使用番茄工作法，一次只做一件事，专注和休息交替，搭建自己的奖励系统。你养成习惯，习惯改变你。",
    accent: "#e65e72",
    accentSoft: "#ffe8ed",
    illustration: (accent, soft) => <div className="onboarding-art art-focus"><div className="timer-ring" style={{ borderColor: accent }}><div className="timer-inner"><strong>25</strong><span>专注分钟</span></div></div><div className="focus-pill pill-left"><Target size={15} />一个目标</div><div className="focus-pill pill-right"><Sparkles size={15} />一个奖励</div><div className="focus-dots"><i /><i /><i /><i /></div><div className="art-glow" style={{ background: soft }} /></div>,
  },
  {
    eyebrow: "05 / 行动",
    problem: "想做的事，总是停留在‘以后再说’",
    solutionTitle: "把想做的事变成今天完成的事",
    solution: "LifePlan 是一套从人生目标到每日行动的个人执行系统，帮你把愿望落到每一个真实的今天。",
    accent: "#1778ff",
    accentSoft: "#e5f1ff",
    illustration: (accent, soft) => <div className="onboarding-art art-finish"><div className="finish-path"><span /><span /><span /><span /></div><div className="finish-target" style={{ borderColor: accent }}><Check size={34} color={accent} strokeWidth={2.5} /></div><div className="finish-card card-top"><Flag size={16} />人生目标</div><div className="finish-card card-bottom"><ListChecks size={16} />今日行动</div><div className="art-glow" style={{ background: soft }} /></div>,
  },
];

export default function OnboardingCarousel({ onFinish }: OnboardingCarouselProps) {
  const [current, setCurrent] = useState(0);
  const slide = slides[current];
  const isLast = current === slides.length - 1;

  useEffect(() => { track("查看新用户引导", { slide: current + 1 }); }, [current]);

  const finish = () => { localStorage.setItem("lifeplan-onboarding-completed", "1"); track("完成新用户引导"); onFinish(); };
  const next = () => isLast ? finish() : setCurrent((value) => value + 1);
  const previous = () => setCurrent((value) => Math.max(0, value - 1));

  return <div className="onboarding-overlay" role="dialog" aria-modal="true" aria-label="LifePlan 新用户引导">
    <div className="onboarding-shell">
      <button className="onboarding-close" type="button" aria-label="跳过引导" onClick={finish}><X size={18} /></button>
      <div className="onboarding-brand"><span className="onboarding-brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32" focusable="false"><rect x="1.5" y="1.5" width="29" height="29" rx="8" fill="currentColor" /><path d="M15 19V9.5M15 19H21.5" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg></span><span>LifePlan</span></div>
      <div className="onboarding-progress">{slides.map((item, index) => <button key={item.eyebrow} type="button" className={index === current ? "is-active" : index < current ? "is-done" : ""} onClick={() => setCurrent(index)} aria-label={`第 ${index + 1} 幅引导图`}><span /></button>)}</div>
      <main className="onboarding-content" style={{ "--slide-accent": slide.accent } as CSSProperties}>
        <section className="onboarding-copy">
          <div className="onboarding-eyebrow">{slide.eyebrow}</div>
          <h1>{slide.problem}</h1>
          <div className="onboarding-divider" />
          <div className="onboarding-solution-label"><Sparkles size={15} /> LifePlan 的解决方案</div>
          <h2>{slide.solutionTitle}</h2>
          <p>{slide.solution}</p>
        </section>
        <section className="onboarding-visual" aria-hidden="true">{slide.illustration(slide.accent, slide.accentSoft)}</section>
      </main>
      <footer className="onboarding-footer">
        <span className="onboarding-counter">{String(current + 1).padStart(2, "0")} <em>/</em> 05</span>
        <div className="onboarding-actions">{current > 0 && <button className="onboarding-back" type="button" onClick={previous}><ArrowLeft size={16} /> 上一页</button>}{isLast ? <button className="onboarding-start" type="button" onClick={finish}>开始使用 <Play size={15} fill="currentColor" /></button> : <button className="onboarding-next" type="button" onClick={next}>继续 <ArrowRight size={16} /></button>}</div>
      </footer>
    </div>
  </div>;
}








