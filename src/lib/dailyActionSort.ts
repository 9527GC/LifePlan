import type { Action } from "../types/index.ts";
import { comparePriorityAndFrog } from "./prioritySort.ts";

export function sortDailyActions(actions: Action[]): Action[] {
  return actions
    .map((action, index) => ({ action, index }))
    .sort((left, right) => {
      const leftHasStartDate = Boolean(left.action.start_date);
      const rightHasStartDate = Boolean(right.action.start_date);

      if (leftHasStartDate !== rightHasStartDate) {
        return leftHasStartDate ? -1 : 1;
      }

      if (leftHasStartDate && rightHasStartDate) {
        const dateCompare = left.action.start_date!.localeCompare(right.action.start_date!);
        if (dateCompare !== 0) {
          return dateCompare;
        }
      }

      return comparePriorityAndFrog(left.action, right.action) || left.index - right.index;
    })
    .map(({ action }) => action);
}
