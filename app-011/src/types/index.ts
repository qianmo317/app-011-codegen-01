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
  ledger: LedgerEntry[];
}

/** 台账分录类型：采购 / 退货 / 补货 */
export type LedgerKind = 'purchase' | 'return' | 'replenish';

/** 同一批货分几次送到，每次送货挂在一笔采购分录下面 */
export interface Delivery {
  id: string;
  date: string; // YYYY-MM-DD
  quantity: number;
  note?: string;
}

export interface LedgerEntry {
  id: string;
  kind: LedgerKind;
  date: string; // YYYY-MM-DD，哪天
  store: string; // 哪家店
  receiptNo: string; // 小票号，同店同号判重
  matId: string; // 什么材料
  spec: string; // 什么规格
  quantity: number; // 多少数量（退货记正数，汇总时按类型减）
  unitPrice: number; // 单价
  amount: number; // 实付/实退金额
  deliveries: Delivery[]; // 分批送货记录
  reversesId?: string; // 红字冲销：被冲掉的原分录 id
  reversedBy?: string; // 原分录被哪笔红字冲掉了
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
