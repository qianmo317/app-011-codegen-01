import type { LedgerEntry, LedgerKind } from '../types';

export const KIND_LABEL: Record<LedgerKind, string> = {
  purchase: '采购',
  return: '退货',
  replenish: '补货',
};

/** 参与"买入"统计的类型（红冲分录沿用原类型、数量为负，自然抵减） */
const BUY_KINDS: LedgerKind[] = ['purchase', 'replenish'];

export function isReversal(e: LedgerEntry): boolean {
  return !!e.reversesId;
}

/** 一笔分录下分批送货的累计已送数量 */
export function deliveredQty(e: LedgerEntry): number {
  return e.deliveries.reduce((s, d) => s + d.quantity, 0);
}

/**
 * 同一家店同一张小票重复录入拦截。
 * 已被红冲作废的分录及其红字单不占号，允许重录。
 */
export function isReceiptDup(
  entries: LedgerEntry[],
  store: string,
  receiptNo: string,
  excludeId?: string
): boolean {
  const no = receiptNo.trim();
  if (!no) return false;
  return entries.some(
    (e) =>
      e.id !== excludeId &&
      !isReversal(e) &&
      !e.reversedBy &&
      e.store.trim() === store.trim() &&
      e.receiptNo.trim() === no
  );
}

/**
 * 已经"用过"的记录不许直接删：
 * 已有分批送货记录、已被红冲、或本身就是红字单，只能再冲红字抵掉。
 */
export function canDeleteEntry(e: LedgerEntry): { ok: boolean; reason?: string } {
  if (isReversal(e)) return { ok: false, reason: '红字冲销单不能删除' };
  if (e.reversedBy) return { ok: false, reason: '该笔已被红字冲销，冲销双方都要留档' };
  if (e.deliveries.length > 0)
    return { ok: false, reason: '该笔已有送货记录，只能红字冲销抵掉' };
  return { ok: true };
}

export interface MaterialRollup {
  matId: string;
  bought: number; // 累计买入（采购+补货，含红冲抵减）
  returned: number; // 累计退回
  net: number; // 净用掉 = 买入 - 退回
  paid: number; // 累计实付
  refunded: number; // 累计实退
  netAmount: number; // 净花费
}

export function rollupByMaterial(entries: LedgerEntry[], matId: string): MaterialRollup {
  const r: MaterialRollup = {
    matId,
    bought: 0,
    returned: 0,
    net: 0,
    paid: 0,
    refunded: 0,
    netAmount: 0,
  };
  for (const e of entries) {
    if (e.matId !== matId) continue;
    if (BUY_KINDS.includes(e.kind)) {
      r.bought += e.quantity;
      r.paid += e.amount;
    } else if (e.kind === 'return') {
      r.returned += e.quantity;
      r.refunded += e.amount;
    }
  }
  r.net = r.bought - r.returned;
  r.netAmount = r.paid - r.refunded;
  return r;
}

export interface PricePoint {
  entryId: string;
  date: string;
  store: string;
  kind: LedgerKind;
  unitPrice: number;
}

export interface PriceChange {
  from: PricePoint; // 从哪一笔开始变的
  to: PricePoint;
}

/**
 * 单价变动轨迹：按日期排序的采购/补货单价序列，
 * 以及每次变价是从哪一笔开始的。
 */
export function priceTrack(entries: LedgerEntry[], matId: string): {
  points: PricePoint[];
  changes: PriceChange[];
} {
  const points = entries
    .filter((e) => e.matId === matId && BUY_KINDS.includes(e.kind) && !isReversal(e) && !e.reversedBy)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt))
    .map((e) => ({
      entryId: e.id,
      date: e.date,
      store: e.store,
      kind: e.kind,
      unitPrice: e.unitPrice,
    }));
  const changes: PriceChange[] = [];
  for (let i = 1; i < points.length; i++) {
    if (points[i].unitPrice !== points[i - 1].unitPrice) {
      changes.push({ from: points[i - 1], to: points[i] });
    }
  }
  return { points, changes };
}
