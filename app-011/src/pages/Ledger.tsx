import { Fragment, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useStore } from '../store';
import { calcMaterials } from '../utils/materialCalc';
import {
  KIND_LABEL,
  deliveredQty,
  isReceiptDup,
  canDeleteEntry,
  rollupByMaterial,
  priceTrack,
} from '../utils/ledger';
import type { LedgerKind } from '../types';

const KINDS: LedgerKind[] = ['purchase', 'replenish', 'return'];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function Ledger() {
  const { id } = useParams<{ id: string }>();
  const {
    getPlan,
    addLedgerEntry,
    addDelivery,
    reverseLedgerEntry,
    deleteLedgerEntry,
  } = useStore();
  const plan = getPlan(id!);

  // ---- 记一笔 表单状态 ----
  const [kind, setKind] = useState<LedgerKind>('purchase');
  const [date, setDate] = useState(today());
  const [store, setStore] = useState('');
  const [receiptNo, setReceiptNo] = useState('');
  const [matId, setMatId] = useState('');
  const [spec, setSpec] = useState('');
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [amount, setAmount] = useState(''); // 留空则按 数量×单价 自动算
  const [formErr, setFormErr] = useState('');
  const [rowErr, setRowErr] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  // 记到货 表单状态（挂在展开的分录下）
  const [dDate, setDDate] = useState(today());
  const [dQty, setDQty] = useState('');
  const [dNote, setDNote] = useState('');

  const estimates = useMemo(
    () => (plan ? calcMaterials(plan.rooms, plan.openings, plan.materials) : []),
    [plan]
  );

  if (!plan) {
    return <div className="card">方案不存在</div>;
  }

  const entries = [...plan.ledger].sort((a, b) =>
    a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1
  );

  const matName = (mid: string) => plan.materials.find((m) => m.id === mid)?.name ?? mid;
  const matUnit = (mid: string) => plan.materials.find((m) => m.id === mid)?.unit ?? '';

  const parsedQty = parseFloat(qty);
  const parsedPrice = parseFloat(price);
  const autoAmount =
    !isNaN(parsedQty) && !isNaN(parsedPrice) ? parsedQty * parsedPrice : NaN;

  const resetForm = () => {
    setStore('');
    setReceiptNo('');
    setSpec('');
    setQty('');
    setPrice('');
    setAmount('');
    setFormErr('');
  };

  const handleSubmit = () => {
    setFormErr('');
    if (!date) return setFormErr('请选哪天');
    if (!store.trim()) return setFormErr('请填哪家店');
    if (!matId) return setFormErr('请选什么材料');
    if (isNaN(parsedQty) || parsedQty <= 0) return setFormErr('数量要大于 0');
    if (isNaN(parsedPrice) || parsedPrice < 0) return setFormErr('单价不能为负');
    const amt = amount.trim() === '' ? autoAmount : parseFloat(amount);
    if (isNaN(amt) || amt < 0) return setFormErr('金额不对');
    // 同店同小票号重复拦截（提交前再拦一次，错误直接显示在表单上）
    if (isReceiptDup(plan.ledger, store, receiptNo)) {
      return setFormErr(
        `「${store.trim()}」的小票号「${receiptNo.trim()}」已经录过一笔了，同一批货不要重复记账`
      );
    }
    const err = addLedgerEntry(plan.id, {
      kind,
      date,
      store: store.trim(),
      receiptNo: receiptNo.trim(),
      matId,
      spec: spec.trim(),
      quantity: parsedQty,
      unitPrice: parsedPrice,
      amount: amt,
    });
    if (err) return setFormErr(err);
    resetForm();
  };

  const handleAddDelivery = (entryId: string) => {
    const q = parseFloat(dQty);
    if (!dDate) return setRowErr({ ...rowErr, [entryId]: '请选送货日期' });
    if (isNaN(q) || q <= 0) return setRowErr({ ...rowErr, [entryId]: '送货数量要大于 0' });
    addDelivery(plan.id, entryId, { date: dDate, quantity: q, note: dNote.trim() });
    setDQty('');
    setDNote('');
    setRowErr({ ...rowErr, [entryId]: '' });
  };

  const handleReverse = (entryId: string) => {
    const err = reverseLedgerEntry(plan.id, entryId);
    if (err) setRowErr({ ...rowErr, [entryId]: err });
  };

  const handleDelete = (entryId: string) => {
    const err = deleteLedgerEntry(plan.id, entryId);
    if (err) {
      setRowErr({ ...rowErr, [entryId]: err });
    } else {
      const next = { ...rowErr };
      delete next[entryId];
      setRowErr(next);
    }
  };

  // ---- 材料汇总：买了多少 / 退了多少 / 净用多少 / 跟预估差多少 ----
  const rollupMats = plan.materials
    .map((m) => {
      const r = rollupByMaterial(plan.ledger, m.id);
      const est = estimates.find((e) => e.matId === m.id);
      const delivered = plan.ledger
        .filter((e) => e.matId === m.id)
        .reduce((s, e) => s + deliveredQty(e), 0);
      return { mat: m, r, estQty: est?.quantity ?? 0, delivered };
    })
    .filter((x) => x.r.bought !== 0 || x.r.returned !== 0 || x.estQty > 0);

  return (
    <div>
      <h2 className="page-title">{plan.name} - 采购台账</h2>

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
          采购台账
        </Link>
        <Link to={`/plan/${id}/print`} className="tab">
          导出打印
        </Link>
      </div>

      {/* ============ 记一笔 ============ */}
      <div className="card">
        <h3 className="card-title">记一笔</h3>
        <div className="ledger-form">
          <div className="form-group">
            <label>类型</label>
            <select value={kind} onChange={(e) => setKind(e.target.value as LedgerKind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>哪天</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label>哪家店</label>
            <input
              type="text"
              placeholder="如：城东建材市场老王五金"
              value={store}
              onChange={(e) => setStore(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>小票号</label>
            <input
              type="text"
              placeholder="同店同号会拦重复"
              value={receiptNo}
              onChange={(e) => setReceiptNo(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>什么材料</label>
            <select value={matId} onChange={(e) => setMatId(e.target.value)}>
              <option value="">-- 选材料 --</option>
              {plan.materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}（{m.unit}）
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>什么规格</label>
            <input
              type="text"
              placeholder="如：800×800 / 5L装"
              value={spec}
              onChange={(e) => setSpec(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>数量{matId ? `（${matUnit(matId)}）` : ''}</label>
            <input
              type="number"
              min="0"
              step="any"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>单价（元）</label>
            <input
              type="number"
              min="0"
              step="any"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>{kind === 'return' ? '实退金额（元）' : '实付金额（元）'}</label>
            <input
              type="number"
              min="0"
              step="any"
              placeholder={isNaN(autoAmount) ? '数量×单价' : autoAmount.toFixed(2)}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </div>
        {formErr && <div className="form-error">{formErr}</div>}
        <div className="toolbar">
          <button className="btn btn-primary" onClick={handleSubmit}>
            记上
          </button>
          <button className="btn btn-secondary" onClick={resetForm}>
            清空
          </button>
        </div>
      </div>

      {/* ============ 台账流水 ============ */}
      <div className="card">
        <h3 className="card-title">台账流水（{entries.length} 笔）</h3>
        {entries.length === 0 ? (
          <p style={{ color: '#999', textAlign: 'center', padding: '24px 0' }}>
            还没有记录，先在上方记一笔采购
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>类型</th>
                <th>店 / 小票号</th>
                <th>材料 / 规格</th>
                <th>数量</th>
                <th>单价</th>
                <th>金额</th>
                <th>送货进度</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const delivered = deliveredQty(e);
                const reversal = !!e.reversesId;
                const del = canDeleteEntry(e);
                const isBuy = e.kind !== 'return';
                return (
                  <Fragment key={e.id}>
                    <tr className={reversal ? 'row-reversal' : ''}>
                      <td>{e.date}</td>
                      <td>
                        <span className={`badge badge-${e.kind}`}>{KIND_LABEL[e.kind]}</span>
                        {reversal && <span className="badge badge-reversal">红字冲销</span>}
                        {e.reversedBy && <span className="badge badge-void">已冲销</span>}
                      </td>
                      <td>
                        {e.store}
                        {e.receiptNo && (
                          <div style={{ fontSize: 12, color: '#999' }}>票号 {e.receiptNo}</div>
                        )}
                      </td>
                      <td>
                        {matName(e.matId)}
                        {e.spec && (
                          <div style={{ fontSize: 12, color: '#999' }}>{e.spec}</div>
                        )}
                      </td>
                      <td className={reversal ? 'neg' : ''}>
                        {e.quantity}
                        {matUnit(e.matId)}
                      </td>
                      <td>¥{e.unitPrice.toFixed(2)}</td>
                      <td className={reversal ? 'neg' : ''}>¥{e.amount.toFixed(2)}</td>
                      <td>
                        {isBuy && !reversal ? (
                          <span
                            className={delivered > e.quantity ? 'neg' : ''}
                            style={{ cursor: 'pointer', textDecoration: 'underline' }}
                            onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                          >
                            已送 {delivered} / 订 {e.quantity}
                            {delivered > e.quantity && '（超送！）'}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        {isBuy && !reversal && (
                          <button
                            className="btn btn-secondary"
                            onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                          >
                            记到货
                          </button>
                        )}
                        {!reversal && !e.reversedBy && (
                          <button
                            className="btn btn-secondary"
                            onClick={() => handleReverse(e.id)}
                          >
                            红字冲销
                          </button>
                        )}
                        <button
                          className="btn btn-danger"
                          disabled={!del.ok}
                          title={del.ok ? '' : del.reason}
                          onClick={() => handleDelete(e.id)}
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                    {rowErr[e.id] && (
                      <tr>
                        <td colSpan={9}>
                          <div className="form-error">{rowErr[e.id]}</div>
                        </td>
                      </tr>
                    )}
                    {expanded === e.id && (
                      <tr>
                        <td colSpan={9} style={{ background: '#f8f9fa' }}>
                          <div style={{ padding: '4px 8px' }}>
                            <strong>分批送货记录</strong>（同一批货挂在同一笔下面）
                            {e.deliveries.length === 0 ? (
                              <div style={{ color: '#999', margin: '6px 0' }}>还没送到</div>
                            ) : (
                              <table style={{ margin: '6px 0' }}>
                                <thead>
                                  <tr>
                                    <th>送到日期</th>
                                    <th>本次数量</th>
                                    <th>备注</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {e.deliveries.map((d) => (
                                    <tr key={d.id}>
                                      <td>{d.date}</td>
                                      <td>
                                        {d.quantity}
                                        {matUnit(e.matId)}
                                      </td>
                                      <td>{d.note || '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                            <div className="toolbar" style={{ marginBottom: 0 }}>
                              <input
                                type="date"
                                value={dDate}
                                onChange={(ev) => setDDate(ev.target.value)}
                              />
                              <input
                                type="number"
                                min="0"
                                step="any"
                                placeholder={`本次送到数量（${matUnit(e.matId)}）`}
                                value={dQty}
                                onChange={(ev) => setDQty(ev.target.value)}
                                style={{ width: 180 }}
                              />
                              <input
                                type="text"
                                placeholder="备注（可选）"
                                value={dNote}
                                onChange={(ev) => setDNote(ev.target.value)}
                                style={{ width: 160 }}
                              />
                              <button
                                className="btn btn-primary"
                                onClick={() => handleAddDelivery(e.id)}
                              >
                                记一次到货
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ============ 材料汇总 ============ */}
      <div className="card">
        <h3 className="card-title">材料汇总：买了多少 / 退了多少 / 净用多少 / 跟预估差多少</h3>
        {rollupMats.length === 0 ? (
          <p style={{ color: '#999', textAlign: 'center', padding: '24px 0' }}>
            暂无数据
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>材料</th>
                <th>预估用量</th>
                <th>累计买入</th>
                <th>累计退回</th>
                <th>净用掉</th>
                <th>跟预估差</th>
                <th>已送到</th>
                <th>净花费</th>
              </tr>
            </thead>
            <tbody>
              {rollupMats.map(({ mat, r, estQty, delivered }) => {
                const diff = r.net - estQty;
                return (
                  <tr key={mat.id}>
                    <td>{mat.name}</td>
                    <td>
                      {estQty.toFixed(2)}
                      {mat.unit}
                    </td>
                    <td>
                      {r.bought.toFixed(2)}
                      {mat.unit}
                    </td>
                    <td>
                      {r.returned.toFixed(2)}
                      {mat.unit}
                    </td>
                    <td>
                      <strong>
                        {r.net.toFixed(2)}
                        {mat.unit}
                      </strong>
                    </td>
                    <td className={diff > 0 ? 'neg' : 'pos'}>
                      {diff > 0 ? '+' : ''}
                      {diff.toFixed(2)}
                      {mat.unit}
                    </td>
                    <td>
                      {delivered.toFixed(2)}
                      {mat.unit}
                    </td>
                    <td>¥{r.netAmount.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ============ 单价变动 ============ */}
      <div className="card">
        <h3 className="card-title">单价变动轨迹（从哪一笔开始变的）</h3>
        {plan.materials.every((m) => priceTrack(plan.ledger, m.id).changes.length === 0) ? (
          <p style={{ color: '#999', textAlign: 'center', padding: '24px 0' }}>
            各材料单价暂时没有变动
          </p>
        ) : (
          plan.materials.map((m) => {
            const { points, changes } = priceTrack(plan.ledger, m.id);
            if (changes.length === 0) return null;
            return (
              <div key={m.id} style={{ marginBottom: 16 }}>
                <strong>{m.name}</strong>
                <div style={{ fontSize: 13, color: '#666', margin: '4px 0' }}>
                  价格轨迹：
                  {points.map((p, i) => (
                    <span key={p.entryId}>
                      {i > 0 && ' → '}
                      ¥{p.unitPrice.toFixed(2)}
                    </span>
                  ))}
                </div>
                {changes.map((c, i) => (
                  <div key={i} className="price-change">
                    从 <strong>{c.to.date}</strong> 在「{c.to.store}」那笔
                    {KIND_LABEL[c.to.kind]}起：¥{c.from.unitPrice.toFixed(2)} →{' '}
                    <span className={c.to.unitPrice > c.from.unitPrice ? 'neg' : 'pos'}>
                      ¥{c.to.unitPrice.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
