/** 按重要程度和紧急程度计算出的优先级升序排列，P1 最优先。 */
export function sortByPriority<T extends { priority: number }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => left.item.priority - right.item.priority || left.index - right.index)
    .map(({ item }) => item);
}

