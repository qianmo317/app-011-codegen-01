import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Plan, Room, Opening, Outlet, MatSpec, LedgerEntry, Delivery } from '../types';
import { DEFAULT_MATS } from '../utils/materialCalc';
import { findDuplicate, lockReason, KIND_LABEL } from '../utils/ledger';

export type EntryDraft = Omit<LedgerEntry, 'id' | 'createdAt' | 'deliveries'>;
export type DeliveryDraft = Omit<Delivery, 'id'>;

export interface ActionResult {
  ok: boolean;
  error?: string;
}

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
  addEntry: (planId: string, draft: EntryDraft) => ActionResult;
  deleteEntry: (planId: string, entryId: string) => ActionResult;
  reverseEntry: (planId: string, entryId: string, date: string, reason: string) => ActionResult;
  addDelivery: (planId: string, entryId: string, draft: DeliveryDraft) => ActionResult;
  deleteDelivery: (planId: string, entryId: string, deliveryId: string) => void;
}

function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
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
          entries: [],
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

      addEntry: (planId, draft) => {
        const plan = get().getPlan(planId);
        if (!plan) return { ok: false, error: '方案不存在' };
        const dup = findDuplicate(plan.entries, draft.store, draft.receiptNo);
        if (dup) {
          return {
            ok: false,
            error: `重复录入:${dup.store} 的小票「${dup.receiptNo}」已在 ${dup.date} 登记过(${KIND_LABEL[dup.kind]})`,
          };
        }
        const entry: LedgerEntry = {
          ...draft,
          id: genId(),
          deliveries: [],
          createdAt: Date.now(),
        };
        get().updatePlan(planId, (p) => ({ ...p, entries: [...p.entries, entry] }));
        return { ok: true };
      },

      deleteEntry: (planId, entryId) => {
        const plan = get().getPlan(planId);
        if (!plan) return { ok: false, error: '方案不存在' };
        const entry = plan.entries.find((e) => e.id === entryId);
        if (!entry) return { ok: false, error: '记录不存在' };
        const locked = lockReason(entry);
        if (locked) return { ok: false, error: locked };
        get().updatePlan(planId, (p) => ({
          ...p,
          entries: p.entries.filter((e) => e.id !== entryId),
        }));
        return { ok: true };
      },

      reverseEntry: (planId, entryId, date, reason) => {
        const plan = get().getPlan(planId);
        if (!plan) return { ok: false, error: '方案不存在' };
        const entry = plan.entries.find((e) => e.id === entryId);
        if (!entry) return { ok: false, error: '记录不存在' };
        if (entry.kind === 'reversal') return { ok: false, error: '红字冲销记录不能再冲销' };
        if (entry.reversedById) return { ok: false, error: '该记录已被冲销,不能重复冲销' };
        const reversal: LedgerEntry = {
          id: genId(),
          kind: 'reversal',
          date,
          store: entry.store,
          receiptNo: entry.receiptNo,
          matId: entry.matId,
          matName: entry.matName,
          spec: entry.spec,
          unit: entry.unit,
          quantity: -entry.quantity,
          unitPrice: entry.unitPrice,
          amount: -entry.amount,
          deliveries: [],
          reversesEntryId: entry.id,
          note: reason || `冲销 ${entry.date} 的${KIND_LABEL[entry.kind]}记录`,
          createdAt: Date.now(),
        };
        get().updatePlan(planId, (p) => ({
          ...p,
          entries: [
            ...p.entries.map((e) => (e.id === entryId ? { ...e, reversedById: reversal.id } : e)),
            reversal,
          ],
        }));
        return { ok: true };
      },

      addDelivery: (planId, entryId, draft) => {
        const plan = get().getPlan(planId);
        if (!plan) return { ok: false, error: '方案不存在' };
        const entry = plan.entries.find((e) => e.id === entryId);
        if (!entry) return { ok: false, error: '记录不存在' };
        if (entry.kind === 'return' || entry.kind === 'reversal')
          return { ok: false, error: '只有采购/补货记录才能登记送货' };
        if (entry.reversedById) return { ok: false, error: '该记录已被冲销,不能再登记送货' };
        const delivery: Delivery = { ...draft, id: genId() };
        get().updatePlan(planId, (p) => ({
          ...p,
          entries: p.entries.map((e) =>
            e.id === entryId ? { ...e, deliveries: [...e.deliveries, delivery] } : e
          ),
        }));
        return { ok: true };
      },

      deleteDelivery: (planId, entryId, deliveryId) =>
        get().updatePlan(planId, (p) => ({
          ...p,
          entries: p.entries.map((e) =>
            e.id === entryId
              ? { ...e, deliveries: e.deliveries.filter((d) => d.id !== deliveryId) }
              : e
          ),
        })),
    }),
    {
      name: 'renovation-planner',
      version: 1,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        return {
          ...current,
          ...p,
          // 兼容旧数据:没有账本字段的方案补上空数组
          plans: (p.plans ?? []).map((plan) => ({ ...plan, entries: plan.entries ?? [] })),
        };
      },
    }
  )
);
