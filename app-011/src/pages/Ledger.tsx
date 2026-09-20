import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useStore } from '../store';
import type { ActionResult, EntryDraft } from '../store';
import { calcMaterials } from '../utils/materialCalc';
import {
  KIND_LABEL,
  today,
  isEffective,
  lockReason,
  deliveredQty,
  summarizeByMaterial,
  priceTimeline,
  fmtQty,
  fmtMoney,
} from '../utils/ledger';
import type { LedgerEntry, LedgerKind, MatSpec } from '../types';

export default function Ledger() {
  const { id } = useParams<{ id: string }>();
  const { getPlan, addEntry, deleteEntry, reverseEntry, addDelivery, deleteDelivery } =
    useStore();
  const plan = getPlan(id!);
  const [reversing, setReversing] = useState<LedgerEntry | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  if (!plan) {
    return <div className="card">方案不存在</div>;
  }

  const estimates = calcMaterials(plan.rooms, plan.openings, plan.materials);
  const summary = summarizeByMaterial(plan.entries, estimates);
  const sorted = [...plan.entries].sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt
  );
  const effective = plan.entries.filter(isEffective);
  const totalPaid = effective
    .filter((e) => e.kind !== 'return')
    .reduce((s, e) => s + e.amount, 0);
  const totalRefund = effective
    .filter((e) => e.kind === 'return')
    .reduce((s, e) => s + e.amount, 0);

  const notify = (res: ActionResult, okMsg: string) => {
    if (!res.ok) alert(res.error);
    else {
      setToast(okMsg);
      setTimeout(() => setToast(''), 2000);
    }
  };

  const handleDelete = (e: LedgerEntry) => {
    if (!window.confirm(`确定删除 ${e.date} ${e.store} 的${KIND_LABEL[e.kind]}记录?`)) return;
    notify(deleteEntry(plan.id, e.id), '已删除');
  };

  return (
    <div>
      <h2 className="page-title">{plan.name} - 买料账本</h2>

      <div className="tabs">
        <Link to={`/plan/${id}`} className="tab">
          平面绘制
        </Link>
        <Link to={`/plan/${id}/walls`} className="tab">
          墙面点位
        </Link>
        <Link to={`/plan/${id}/bom`} className="tab">
          材料清单
        </Link>
        <Link to={`/plan/${id}/ledger`} className="tab active">
          买料账本
        </Link>
        <Link to={`/plan/${id}/print`} className="tab">
          导出打印
        </Link>
      </div>

      <div className="info-bar">
        <span>
          有效流水: <strong>{effective.length}</strong> 笔
        </span>
        <span>
          实付合计: <strong>{fmtMoney(totalPaid)}</strong>
        </span>
        <span>
          退货退款: <strong>{fmtMoney(totalRefund)}</strong>
        </span>
        <span>
          净支出:{' '}
          <strong style={{ color: '#e74c3c', fontSize: 18 }}>
            {fmtMoney(totalPaid - totalRefund)}
          </strong>
        </span>
        {toast && <span style={{ color: '#27ae60' }}>{toast}</span>}
      </div>

      <EntryForm materials={plan.materials} onSubmit={(draft) => addEntry(plan.id, draft)} />

      <div className="card">
        <h3 style={{ marginBottom: 12, fontSize: 16 }}>材料对账(预估用量来自材料清单页)</h3>
        {summary.length === 0 ? (
          <p style={{ color: '#999' }}>暂无数据</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>材料</th>
                <th>单位</th>
                <th>预估用量</th>
                <th>累计买入</th>
                <th>累计退货</th>
                <th>净用量</th>
                <th>与预估差</th>
                <th>净支出</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((row) => (
                <tr key={row.matId}>
                  <td>{row.name}</td>
                  <td>{row.unit}</td>
                  <td>{fmtQty(row.estimated)}</td>
                  <td>{fmtQty(row.purchased)}</td>
                  <td>{row.returned > 0 ? fmtQty(row.returned) : '-'}</td>
                  <td>
                    <strong>{fmtQty(row.netUsed)}</strong>
                  </td>
                  <td>
                    {row.estimated === 0 && row.netUsed === 0 ? (
                      '-'
                    ) : row.diff > 0 ? (
                      <span className="text-red">超 {fmtQty(row.diff)}</span>
                    ) : row.diff < 0 ? (
                      <span className="text-green">省 {fmtQty(-row.diff)}</span>
                    ) : (
                      '持平'
                    )}
                  </td>
                  <td>{fmtMoney(row.netAmount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 'bold', background: '#f8f9fa' }}>
                <td colSpan={7}>合计</td>
                <td>{fmtMoney(summary.reduce((s, r) => s + r.netAmount, 0))}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      <PriceCard entries={plan.entries} />

      <div className="card">
        <h3 style={{ marginBottom: 12, fontSize: 16 }}>流水明细</h3>
        {sorted.length === 0 ? (
          <p style={{ color: '#999' }}>暂无流水,先在上方记一笔</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>类型</th>
                <th>商家 / 小票号</th>
                <th>材料 / 规格</th>
                <th>数量</th>
                <th>单价</th>
                <th>金额</th>
                <th>送货进度</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => {
                const locked = lockReason(e);
                const isReversed = !!e.reversedById;
                const canDeliver =
                  (e.kind === 'purchase' || e.kind === 'replenish') && !isReversed;
                const delivered = deliveredQty(e);
                const expanded = expandedId === e.id;
                const original = e.reversesEntryId
                  ? plan.entries.find((o) => o.id === e.reversesEntryId)
                  : undefined;
                return [
                  <tr key={e.id} className={isReversed ? 'strike-row' : undefined}>
                    <td>{e.date}</td>
                    <td>
                      <span className={`badge badge-${e.kind}`}>{KIND_LABEL[e.kind]}</span>
                      {isReversed && <span className="badge badge-void">已冲销</span>}
                    </td>
                    <td>
                      {e.store}
                      {e.receiptNo && (
                        <div style={{ fontSize: 12, color: '#999' }}>小票 {e.receiptNo}</div>
                      )}
                    </td>
                    <td>
                      {e.matName}
                      {e.spec && (
                        <div style={{ fontSize: 12, color: '#999' }}>{e.spec}</div>
                      )}
                      {e.kind === 'reversal' && original && (
                        <div style={{ fontSize: 12, color: '#c0392b' }}>
                          冲抵 {original.date} 的{KIND_LABEL[original.kind]}
                        </div>
                      )}
                      {e.note && e.kind !== 'reversal' && (
                        <div style={{ fontSize: 12, color: '#999' }}>{e.note}</div>
                      )}
                    </td>
                    <td className={e.kind === 'reversal' ? 'text-red' : undefined}>
                      {fmtQty(e.quantity)}
                      {e.unit}
                    </td>
                    <td>{fmtMoney(e.unitPrice)}</td>
                    <td className={e.kind === 'reversal' ? 'text-red' : undefined}>
                      {fmtMoney(e.amount)}
                    </td>
                    <td>
                      {canDeliver ? (
                        <span
                          style={{ cursor: 'pointer', textDecoration: 'underline' }}
                          onClick={() => setExpandedId(expanded ? null : e.id)}
                        >
                          {delivered === 0
                            ? '未送货'
                            : delivered >= e.quantity
                              ? `已齐 ${fmtQty(delivered)}/${fmtQty(e.quantity)}`
                              : `部分 ${fmtQty(delivered)}/${fmtQty(e.quantity)}`}
                          {delivered > e.quantity && (
                            <span className="text-red">(超送)</span>
                          )}
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td>
                      {canDeliver && (
                        <button
                          className="btn btn-secondary"
                          onClick={() => setExpandedId(expanded ? null : e.id)}
                        >
                          送货
                        </button>
                      )}
                      {e.kind !== 'reversal' && !isReversed && (
                        <button
                          className="btn btn-secondary"
                          onClick={() => setReversing(e)}
                        >
                          冲销
                        </button>
                      )}
                      {!locked && (
                        <button className="btn btn-danger" onClick={() => handleDelete(e)}>
                          删除
                        </button>
                      )}
                    </td>
                  </tr>,
                  expanded && canDeliver ? (
                    <tr key={`${e.id}-deliveries`}>
                      <td colSpan={9} style={{ background: '#fafbfc' }}>
                        <DeliveryPanel
                          entry={e}
                          onAdd={(d) => notify(addDelivery(plan.id, e.id, d), '已登记送货')}
                          onDelete={(did) => deleteDelivery(plan.id, e.id, did)}
                        />
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        )}
      </div>

      {reversing && (
        <ReverseModal
          entry={reversing}
          onClose={() => setReversing(null)}
          onConfirm={(date, reason) => {
            const res = reverseEntry(plan.id, reversing.id, date, reason);
            if (res.ok) setReversing(null);
            return res;
          }}
        />
      )}
    </div>
  );
}

function EntryForm({
  materials,
  onSubmit,
}: {
  materials: MatSpec[];
  onSubmit: (draft: EntryDraft) => ActionResult;
}) {
  const [kind, setKind] = useState<LedgerKind>('purchase');
  const [date, setDate] = useState(today());
  const [store, setStore] = useState('');
  const [receiptNo, setReceiptNo] = useState('');
  const [matId, setMatId] = useState(materials[0]?.id ?? '');
  const [spec, setSpec] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [amount, setAmount] = useState('');
  const [amountManual, setAmountManual] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const mat = materials.find((m) => m.id === matId);
  const isReturn = kind === 'return';

  const autoAmount = (q: string, p: string) => {
    if (amountManual) return;
    const qn = parseFloat(q);
    const pn = parseFloat(p);
    setAmount(!isNaN(qn) && !isNaN(pn) ? (qn * pn).toFixed(2) : '');
  };

  const submit = () => {
    const q = parseFloat(quantity);
    const p = parseFloat(unitPrice);
    const a = amount === '' && !isNaN(q) && !isNaN(p) ? q * p : parseFloat(amount);
    if (!date) return setError('请选择日期');
    if (!store.trim()) return setError('请填写商家');
    if (!mat) return setError('请选择材料');
    if (isNaN(q) || q <= 0) return setError('数量必须大于 0');
    if (isNaN(p) || p < 0) return setError('单价不能为负');
    if (isNaN(a) || a < 0) return setError('金额不能为负');
    const res = onSubmit({
      kind,
      date,
      store: store.trim(),
      receiptNo: receiptNo.trim(),
      matId: mat.id,
      matName: mat.name,
      spec: spec.trim(),
      unit: mat.unit,
      quantity: q,
      unitPrice: p,
      amount: a,
      note: note.trim() || undefined,
    });
    if (!res.ok) return setError(res.error ?? '保存失败');
    setError('');
    setStore('');
    setReceiptNo('');
    setSpec('');
    setQuantity('');
    setUnitPrice('');
    setAmount('');
    setAmountManual(false);
    setNote('');
  };

  return (
    <div className="card">
      <h3 style={{ marginBottom: 12, fontSize: 16 }}>记一笔</h3>
      <div className="form-grid">
        <div className="form-group">
          <label>类型</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as LedgerKind)}>
            <option value="purchase">采购</option>
            <option value="replenish">临时补货</option>
            <option value="return">退货</option>
          </select>
        </div>
        <div className="form-group">
          <label>日期</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="form-group">
          <label>商家 *</label>
          <input
            value={store}
            onChange={(e) => setStore(e.target.value)}
            placeholder="如:城东建材市场"
          />
        </div>
        <div className="form-group">
          <label>小票号(同店同号会拦截重复)</label>
          <input
            value={receiptNo}
            onChange={(e) => setReceiptNo(e.target.value)}
            placeholder="如:A20260501"
          />
        </div>
        <div className="form-group">
          <label>材料 *</label>
          <select
            value={matId}
            onChange={(e) => {
              setMatId(e.target.value);
              const m = materials.find((x) => x.id === e.target.value);
              if (m && !unitPrice) setUnitPrice(String(m.price));
            }}
          >
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}({m.unit})
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>规格</label>
          <input
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
            placeholder="如:800×800 浅灰 / 5L装"
          />
        </div>
        <div className="form-group">
          <label>数量 *{mat ? `(${mat.unit})` : ''}</label>
          <input
            type="number"
            min="0"
            step="any"
            value={quantity}
            onChange={(e) => {
              setQuantity(e.target.value);
              autoAmount(e.target.value, unitPrice);
            }}
          />
        </div>
        <div className="form-group">
          <label>单价 *</label>
          <input
            type="number"
            min="0"
            step="any"
            value={unitPrice}
            onChange={(e) => {
              setUnitPrice(e.target.value);
              autoAmount(quantity, e.target.value);
            }}
          />
        </div>
        <div className="form-group">
          <label>{isReturn ? '退款金额' : '实付金额'}</label>
          <input
            type="number"
            min="0"
            step="any"
            value={amount}
            placeholder="默认 数量×单价"
            onChange={(e) => {
              setAmount(e.target.value);
              setAmountManual(true);
            }}
          />
        </div>
        <div className="form-group">
          <label>备注</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      {error && <div style={{ color: '#c0392b', marginBottom: 8, fontSize: 14 }}>{error}</div>}
      <button className="btn btn-primary" onClick={submit}>
        {isReturn ? '记退货' : '记一笔'}
      </button>
    </div>
  );
}

function DeliveryPanel({
  entry,
  onAdd,
  onDelete,
}: {
  entry: LedgerEntry;
  onAdd: (d: { date: string; quantity: number; note?: string }) => void;
  onDelete: (deliveryId: string) => void;
}) {
  const [date, setDate] = useState(today());
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const delivered = deliveredQty(entry);
  const remaining = entry.quantity - delivered;

  const submit = () => {
    const q = parseFloat(qty);
    if (!date) return alert('请选择送货日期');
    if (isNaN(q) || q <= 0) return alert('送货数量必须大于 0');
    onAdd({ date, quantity: q, note: note.trim() || undefined });
    setQty('');
    setNote('');
  };

  return (
    <div style={{ padding: '4px 8px' }}>
      <div style={{ marginBottom: 8, fontSize: 13, color: '#666' }}>
        本笔共 {fmtQty(entry.quantity)}
        {entry.unit},已送 {fmtQty(delivered)}
        {entry.unit},
        {remaining > 0 ? (
          <>
            还剩 <strong>{fmtQty(remaining)}</strong>
            {entry.unit} 未送
          </>
        ) : (
          <span className="text-green"> 已全部送到</span>
        )}
      </div>
      {entry.deliveries.length > 0 && (
        <table style={{ marginBottom: 8 }}>
          <thead>
            <tr>
              <th>送货日期</th>
              <th>数量</th>
              <th>备注</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {entry.deliveries.map((d) => (
              <tr key={d.id}>
                <td>{d.date}</td>
                <td>
                  {fmtQty(d.quantity)}
                  {entry.unit}
                </td>
                <td>{d.note || '-'}</td>
                <td>
                  <button
                    className="btn btn-danger"
                    onClick={() => window.confirm('删除这条送货记录?') && onDelete(d.id)}
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <input
          type="number"
          min="0"
          step="any"
          placeholder={`数量(${entry.unit})`}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          style={{ width: 120 }}
        />
        <input
          placeholder="备注(可选)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{ width: 160 }}
        />
        <button className="btn btn-primary" onClick={submit}>
          登记送货
        </button>
      </div>
    </div>
  );
}

function ReverseModal({
  entry,
  onClose,
  onConfirm,
}: {
  entry: LedgerEntry;
  onClose: () => void;
  onConfirm: (date: string, reason: string) => ActionResult;
}) {
  const [date, setDate] = useState(today());
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const submit = () => {
    if (!date) return setError('请选择冲销日期');
    const res = onConfirm(date, reason.trim());
    if (!res.ok) setError(res.error ?? '冲销失败');
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: 12, fontSize: 16 }}>红字冲销</h3>
        <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
          将生成一笔红字记录,把 {entry.date} 在「{entry.store}」的{KIND_LABEL[entry.kind]}(
          {entry.matName} {fmtQty(entry.quantity)}
          {entry.unit},{fmtMoney(entry.amount)})全额抵掉。原记录保留在账上但不再计入合计,
          冲销记录也不能删除。
        </p>
        <div className="form-group">
          <label>冲销日期</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="form-group">
          <label>冲销原因</label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="如:单价录错了"
          />
        </div>
        {error && <div style={{ color: '#c0392b', marginBottom: 8, fontSize: 14 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-danger" onClick={submit}>
            确认冲销
          </button>
        </div>
      </div>
    </div>
  );
}

function PriceCard({ entries }: { entries: LedgerEntry[] }) {
  const matIds = Array.from(
    new Set(
      entries
        .filter(
          (e) => isEffective(e) && (e.kind === 'purchase' || e.kind === 'replenish')
        )
        .map((e) => e.matId)
    )
  );
  if (matIds.length === 0) return null;

  return (
    <div className="card">
      <h3 style={{ marginBottom: 12, fontSize: 16 }}>单价变动</h3>
      {matIds.map((mid) => {
        const points = priceTimeline(entries, mid);
        const name =
          entries.find((e) => e.matId === mid && e.matName)?.matName ?? mid;
        const changes = points.filter((p) => p.changedFrom !== undefined);
        return (
          <div key={mid} style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 4 }}>
              <strong>{name}</strong>{' '}
              {changes.length > 0 ? (
                <span className="text-red">变动 {changes.length} 次</span>
              ) : (
                <span style={{ color: '#999', fontSize: 13 }}>价格稳定</span>
              )}
            </div>
            <div>
              {points.map((p) => (
                <span
                  key={p.entryId}
                  className={p.changedFrom !== undefined ? 'price-chip changed' : 'price-chip'}
                  title={`${p.store}${p.receiptNo ? ` 小票${p.receiptNo}` : ''}`}
                >
                  {p.date} {KIND_LABEL[p.kind]} {fmtMoney(p.unitPrice)}
                  {p.changedFrom !== undefined && ` ← 由${fmtMoney(p.changedFrom)}变`}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
