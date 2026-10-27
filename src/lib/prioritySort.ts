/** P1 最优先；同优先级青蛙优先，其余保留原顺序。 */
export function sortByPriority<T extends { priority: number; is_frog?: number }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => comparePriorityAndFrog(left.item, right.item) || left.index - right.index)
    .map(({ item }) => item);
}

/** 日期、状态或手动顺序由各入口处理，此处只比较优先级和青蛙标记。 */
export function comparePriorityAndFrog(
  left: { priority: number; is_frog?: number },
  right: { priority: number; is_frog?: number },
) {
  return left.priority - right.priority || Number(right.is_frog === 1) - Number(left.is_frog === 1);
}

