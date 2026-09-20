export interface Pt {
  x: number;
  y: number;
}

export interface Room {
  id: string;
  name: string;
  polygon: Pt[];
  heightMm: number;
  floorMat: string;
  wallMat: string;
}

export type OpeningType = 'door' | 'window' | 'arch' | 'sliding';

export interface Opening {
  id: string;
  roomId: string;
  wallIndex: number;
  offsetMm: number;
  widthMm: number;
  heightMm: number;
  type: OpeningType;
}

export type OutletKind = 'socket' | 'switch' | 'net' | 'light' | 'water';

export interface Outlet {
  id: string;
  wallKey: string;
  xMm: number;
  heightMm: number;
  kind: OutletKind;
  circuit?: string;
}

export type Unit = 'm2' | 'm' | 'kg' | 'roll' | 'pcs';

export interface MatSpec {
  id: string;
  name: string;
  unit: Unit;
  coverage?: number;
  lossRate: number;
  price: number;
}

export interface Plan {
  id: string;
  name: string;
  createdAt: number;
  rooms: Room[];
  openings: Opening[];
  outlets: Outlet[];
  materials: MatSpec[];
  entries: LedgerEntry[];
}

/** 账本记录类型:采购 / 补货 / 退货 / 红字冲销 */
export type LedgerKind = 'purchase' | 'replenish' | 'return' | 'reversal';

/** 一次送货(同一批货分几次送到,挂在同一笔采购下面) */
export interface Delivery {
  id: string;
  date: string; // YYYY-MM-DD
  quantity: number;
  note?: string;
}

/** 账本流水(一笔买料记录) */
export interface LedgerEntry {
  id: string;
  kind: LedgerKind;
  date: string; // 业务日期 YYYY-MM-DD
  store: string; // 商家
  receiptNo: string; // 小票号(同店同号视为重复录入)
  matId: string; // 关联材料
  matName: string; // 冗余名称,材料改名后账不变
  spec: string; // 规格
  unit: Unit;
  quantity: number; // 数量,红字冲销为负
  unitPrice: number; // 单价
  amount: number; // 实付金额(退货为退款额,红冲为负)
  deliveries: Delivery[];
  reversesEntryId?: string; // 红冲记录指向被冲的原始记录
  reversedById?: string; // 原始记录被哪笔红冲抵掉
  note?: string;
  createdAt: number;
}

export interface WallSegment {
  roomId: string;
  index: number;
  p1: Pt;
  p2: Pt;
  lengthMm: number;
  angle: number;
}

export interface MaterialResult {
  matId: string;
  name: string;
  unit: Unit;
  quantity: number;
  totalPrice: number;
  details: string;
}
