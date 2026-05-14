import { MIGRATION_OBJECT_ORDER } from "./objectTypes";

const ORDER_INDEX = new Map(MIGRATION_OBJECT_ORDER.map((type, index) => [type, index]));

export function orderObjectTypes(types) {
  return [...types].sort((left, right) => {
    const leftIndex = ORDER_INDEX.has(left) ? ORDER_INDEX.get(left) : Number.MAX_SAFE_INTEGER;
    const rightIndex = ORDER_INDEX.has(right) ? ORDER_INDEX.get(right) : Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex;
  });
}

export function orderPlanItems(items) {
  return [...items].sort((left, right) => {
    const typeCompare =
      (ORDER_INDEX.get(left.object_type) ?? Number.MAX_SAFE_INTEGER) -
      (ORDER_INDEX.get(right.object_type) ?? Number.MAX_SAFE_INTEGER);

    if (typeCompare !== 0) return typeCompare;
    return Number(left.order ?? 0) - Number(right.order ?? 0);
  });
}

export function isKnownObjectType(type) {
  return ORDER_INDEX.has(type);
}
