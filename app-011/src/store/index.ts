import { create } from 'zustand';
import type { Plan, Room, Opening, Outlet, MatSpec, LedgerEntry, Delivery } from '../types';
import { DEFAULT_MATS } from '../utils/materialCalc';
import { isReceiptDup, canDeleteEntry } from '../utils/ledger';

interface AppState {
  plans: Plan[];
  currentPlanId: string | null;
  scale: number;
  setScale: (s: number) => void;
  addPlan: (name: string) => string;
  deletePlan: (id: string) => void;
  getPlan: (id: string) => Plan | undefined;
  updatePlan: (id: string, updater: (plan: Plan) => Plan) => void;
  addRoom: (planId: string, room: Room) => void;
  updateRoom: (planId: string, roomId: string, updater: (room: Room) => Room) => void;
  deleteRoom: (planId: string, roomId: string) => void;
  addOpening: (planId: string, opening: Opening) => void;
  deleteOpening: (planId: string, openingId: string) => void;
  addOutlet: (planId: string, outlet: Outlet) => void;
  deleteOutlet: (planId: string, outletId: string) => void;
  updateMaterials: (planId: string, mats: MatSpec[]) => void;
  /** 记一笔台账；同店同小票号重复时返回错误文案，成功返回 null */
  addLedgerEntry: (
    planId: string,
    entry: Omit<LedgerEntry, 'id' | 'createdAt' | 'deliveries'>
  ) => string | null;
  /** 同一批货分次送到：在某笔分录下挂一条送货记录 */
  addDelivery: (planId: string, entryId: string, d: Omit<Delivery, 'id'>) => void;
  /** 红字冲销：生成一笔数量为负的红字单把原分录抵掉 */
  reverseLedgerEntry: (planId: string, entryId: string) => string | null;
  /** 删除分录；已有送货/已冲销/红字单会被拦截并返回原因 */
  deleteLedgerEntry: (planId: string, entryId: string) => string | null;
}

function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const useStore = create<AppState>((set, get) => ({
  plans: [],
  currentPlanId: null,
  scale: 1,

  setScale: (s) => set({ scale: s }),

  addPlan: (name) => {
    const id = genId();
    const plan: Plan = {
      id,
      name,
      createdAt: Date.now(),
      rooms: [],
      openings: [],
      outlets: [],
      materials: [...DEFAULT_MATS],
      ledger: [],
    };
    set((state) => ({ plans: [...state.plans, plan], currentPlanId: id }));
    return id;
  },

  deletePlan: (id) =>
    set((state) => ({
      plans: state.plans.filter((p) => p.id !== id),
      currentPlanId: state.currentPlanId === id ? null : state.currentPlanId,
    })),

  getPlan: (id) => get().plans.find((p) => p.id === id),

  updatePlan: (id, updater) =>
    set((state) => ({
      plans: state.plans.map((p) => (p.id === id ? updater(p) : p)),
    })),

  addRoom: (planId, room) =>
    set((state) => ({
      plans: state.plans.map((p) =>
        p.id === planId ? { ...p, rooms: [...p.rooms, room] } : p
      ),
    })),

  updateRoom: (planId, roomId, updater) =>
    set((state) => ({
      plans: state.plans.map((p) =>
        p.id === planId
          ? { ...p, rooms: p.rooms.map((r) => (r.id === roomId ? updater(r) : r)) }
          : p
      ),
    })),

  deleteRoom: (planId, roomId) =>
    set((state) => ({
      plans: state.plans.map((p) =>
        p.id === planId
          ? {
              ...p,
              rooms: p.rooms.filter((r) => r.id !== roomId),
              openings: p.openings.filter((o) => o.roomId !== roomId),
            }
          : p
      ),
    })),

  addOpening: (planId, opening) =>
    set((state) => ({
      plans: state.plans.map((p) =>
        p.id === planId ? { ...p, openings: [...p.openings, opening] } : p
      ),
    })),

  deleteOpening: (planId, openingId) =>
    set((state) => ({
      plans: state.plans.map((p) =>
        p.id === planId
          ? { ...p, openings: p.openings.filter((o) => o.id !== openingId) }
          : p
      ),
    })),

  addOutlet: (planId, outlet) =>
    set((state) => ({
      plans: state.plans.map((p) =>
        p.id === planId ? { ...p, outlets: [...p.outlets, outlet] } : p
      ),
    })),

  deleteOutlet: (planId, outletId) =>
    set((state) => ({
      plans: state.plans.map((p) =>
        p.id === planId
          ? { ...p, outlets: p.outlets.filter((o) => o.id !== outletId) }
          : p
      ),
    })),

  updateMaterials: (planId, mats) =>
    set((state) => ({
      plans: state.plans.map((p) => (p.id === planId ? { ...p, materials: mats } : p)),
    })),

  addLedgerEntry: (planId, entry) => {
    const plan = get().plans.find((p) => p.id === planId);
    if (!plan) return '方案不存在';
    if (isReceiptDup(plan.ledger, entry.store, entry.receiptNo)) {
      return `「${entry.store}」的小票号「${entry.receiptNo}」已录过一笔，不能重复录入`;
    }
    const full: LedgerEntry = {
      ...entry,
      id: genId(),
      deliveries: [],
      createdAt: Date.now(),
    };
    set((state) => ({
      plans: state.plans.map((p) =>
        p.id === planId ? { ...p, ledger: [...p.ledger, full] } : p
      ),
    }));
    return null;
  },

  addDelivery: (planId, entryId, d) =>
    set((state) => ({
      plans: state.plans.map((p) =>
        p.id === planId
          ? {
              ...p,
              ledger: p.ledger.map((e) =>
                e.id === entryId
                  ? { ...e, deliveries: [...e.deliveries, { ...d, id: genId() }] }
                  : e
              ),
            }
          : p
      ),
    })),

  reverseLedgerEntry: (planId, entryId) => {
    const plan = get().plans.find((p) => p.id === planId);
    const orig = plan?.ledger.find((e) => e.id === entryId);
    if (!plan || !orig) return '记录不存在';
    if (orig.reversedBy) return '该笔已被红字冲销过，不能重复冲';
    if (orig.reversesId) return '红字冲销单本身不能再冲';
    const reversal: LedgerEntry = {
      ...orig,
      id: genId(),
      quantity: -orig.quantity,
      amount: -orig.amount,
      deliveries: [],
      reversesId: orig.id,
      reversedBy: undefined,
      createdAt: Date.now(),
    };
    set((state) => ({
      plans: state.plans.map((p) =>
        p.id === planId
          ? {
              ...p,
              ledger: [
                ...p.ledger.map((e) =>
                  e.id === entryId ? { ...e, reversedBy: reversal.id } : e
                ),
                reversal,
              ],
            }
          : p
      ),
    }));
    return null;
  },

  deleteLedgerEntry: (planId, entryId) => {
    const plan = get().plans.find((p) => p.id === planId);
    const entry = plan?.ledger.find((e) => e.id === entryId);
    if (!plan || !entry) return '记录不存在';
    const check = canDeleteEntry(entry);
    if (!check.ok) return check.reason!;
    set((state) => ({
      plans: state.plans.map((p) =>
        p.id === planId
          ? { ...p, ledger: p.ledger.filter((e) => e.id !== entryId) }
          : p
      ),
    }));
    return null;
  },
}));
