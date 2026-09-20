import type { LedgerEntry, LedgerKind, MaterialResult, Unit } from '../types';

export const KIND_LABEL: Record<LedgerKind, string> = {
  purchase: '采购',
  replenish: '补货',
  return: '退货',
  reversal: '红字冲销',
};

export function today(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * 是否参与账务合计。
 * 红字冲销与被它冲掉的原始记录互相抵销,两者都只留在账上备查,不再计入合计。
 */
export function isEffective(e: LedgerEntry): boolean {
  return e.kind !== 'reversal' && !e.reversedById;
}

/** 同一家店同一张小票重复录入检查(已被冲销的记录不再占用小票号) */
export function findDuplicate(
  entries: LedgerEntry[],
  store: string,
  receiptNo: string,
  excludeId?: string
): LedgerEntry | undefined {
  const s = store.trim().toLowerCase();
  const r = receiptNo.trim().toLowerCase();
  if (!s || !r) return undefined;
  return entries.find(
    (e) =>
      e.id !== excludeId &&
      isEffective(e) &&
      e.store.trim().toLowerCase() === s &&
      e.receiptNo.trim().toLowerCase() === r
  );
}

/**
 * 已经"用过"的记录不许直接删,只能红字冲销。
 * 返回 null 表示可以删除,否则返回禁止删除的原因。
 */
export function lockReason(e: LedgerEntry): string | null {
  if (e.kind === 'reversal') return '红字冲销是账务凭证,不能删除';
  if (e.reversedById) return '该记录已被红字冲销,不能删除';
  if (e.deliveries.length > 0)
    return '该记录已有送货记录(已使用),不能删除,只能红字冲销';
  return null;
}

/** 送货进度 */
export function deliveredQty(e: LedgerEntry): number {
  return e.deliveries.reduce((s, d) => s + d.quantity, 0);
}

export interface MaterialSummary {
  matId: string;
  name: string;
  unit: Unit | string;
  estimated: number; // 预估用量
  purchased: number; // 累计买入(采购+补货)
  returned: number; // 累计退货
  netUsed: number; // 净用掉 = 买入 - 退货
  diff: number; // 净用 - 预估
  paid: number; // 实付合计
  refunded: number; // 退款合计
  netAmount: number; // 净支出
}

/** 按材料汇总:买了多少、退了多少、净用多少、跟预估差多少 */
export function summarizeByMaterial(
  entries: LedgerEntry[],
  estimates: MaterialResult[]
): MaterialSummary[] {
  const map = new Map<string, MaterialSummary>();
  const ensure = (matId: string, name: string, unit: Unit | string) => {
    let row = map.get(matId);
    if (!row) {
      row = {
        matId,
        name,
        unit,
        estimated: 0,
        purchased: 0,
        returned: 0,
        netUsed: 0,
        diff: 0,
        paid: 0,
        refunded: 0,
        netAmount: 0,
      };
      map.set(matId, row);
    }
    return row;
  };

  for (const est of estimates) {
    ensure(est.matId, est.name, est.unit).estimated += est.quantity;
  }
  for (const e of entries) {
    if (!isEffective(e)) continue;
    const row = ensure(e.matId, e.matName, e.unit);
    if (e.kind === 'return') {
      row.returned += e.quantity;
      row.refunded += e.amount;
    } else {
      row.purchased += e.quantity;
      row.paid += e.amount;
    }
  }
  const rows = Array.from(map.values());
  for (const row of rows) {
    row.netUsed = row.purchased - row.returned;
    row.diff = row.netUsed - row.estimated;
    row.netAmount = row.paid - row.refunded;
  }
  // 有账务活动的排前面,其次按名称
  return rows.sort((a, b) => {
    const actA = a.purchased + a.returned > 0 ? 0 : 1;
    const actB = b.purchased + b.returned > 0 ? 0 : 1;
    return actA - actB || a.name.localeCompare(b.name, 'zh');
  });
}

export interface PricePoint {
  entryId: string;
  date: string;
  store: string;
  receiptNo: string;
  kind: LedgerKind;
  unitPrice: number;
  /** 与上一笔有效买入相比单价变了,这里记下原来的单价 */
  changedFrom?: number;
}

/**
 * 某种材料的买入单价时间线(按日期升序)。
 * 单价从哪一笔开始变,该笔的 changedFrom 会标出变动前的价格。
 */
export function priceTimeline(entries: LedgerEntry[], matId: string): PricePoint[] {
  const list = entries
    .filter(
      (e) =>
        isEffective(e) &&
        e.matId === matId &&
        (e.kind === 'purchase' || e.kind === 'replenish')
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  return list.map((e, i) => ({
    entryId: e.id,
    date: e.date,
    store: e.store,
    receiptNo: e.receiptNo,
    kind: e.kind,
    unitPrice: e.unitPrice,
    changedFrom:
      i > 0 && list[i - 1].unitPrice !== e.unitPrice
        ? list[i - 1].unitPrice
        : undefined,
  }));
}

export function fmtQty(n: number): string {
  return String(Number(n.toFixed(2)));
}

export function fmtMoney(n: number): string {
  return `¥${n.toFixed(2)}`;
}
