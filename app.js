'use strict';

/* ================= константы и утилиты ================= */

const STORAGE_KEY = 'shopping.v1';
const CURRENCIES = ['₽', '₴', '₸', '€', '$', '£'];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** true, когда страница открыта внутри Android-приложения */
function isNativeApp() {
  try {
    return !!(window.AndroidApp && window.AndroidApp.isNative && window.AndroidApp.isNative());
  } catch (err) {
    return false;
  }
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const normKey = (s) => String(s).trim().toLowerCase().replace(/\s+/g, ' ');

function parseNum(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value == null) return 0;
  const cleaned = String(value).replace(/\s|\u00a0/g, '').replace(',', '.');
  const m = cleaned.match(/-?\d*\.?\d+/);
  return m ? parseFloat(m[0]) : 0;
}

function saneQty(value) {
  const n = parseNum(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : 1;
}

function sanePrice(value) {
  const n = parseNum(value);
  return Number.isFinite(n) && n > 0 ? round2(n) : 0;
}

const nf = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const qf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });

function money(value, currency = state.currency) {
  return nf.format(round2(value || 0)) + ' ' + currency;
}

const num = (value) => qf.format(Math.round(value * 1000) / 1000);

/** Цена для поля ввода: 89,90 вместо 89.9 */
const priceForInput = (value) => (value > 0 ? value.toFixed(2).replace('.', ',') : '');

function plural(n, one, few, many) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

/* ================= состояние ================= */

function defaultState() {
  return { v: 1, currency: '₽', items: [], catalog: {}, history: [] };
}

let state = defaultState();
let tab = 'list';
let editId = null;
/** id товара, выбранного первым нажатием (второе нажатие открывает редактор) */
let selectedId = null;
let toastTimer = null;
let toastActionFn = null;
const justAdded = new Set();

function normalizeItem(raw) {
  if (!raw || typeof raw.name !== 'string' || !raw.name.trim()) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
    name: raw.name.trim().slice(0, 120),
    qty: saneQty(raw.qty),
    price: sanePrice(raw.price),
    done: !!raw.done,
  };
}

function normalize(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;

  const items = Array.isArray(raw.items)
    ? raw.items.map(normalizeItem).filter(Boolean)
    : [];

  const catalog = {};
  if (raw.catalog && typeof raw.catalog === 'object' && !Array.isArray(raw.catalog)) {
    for (const [key, value] of Object.entries(raw.catalog)) {
      if (!value || typeof value.name !== 'string' || !value.name.trim()) continue;
      catalog[key] = {
        name: value.name.trim().slice(0, 120),
        price: sanePrice(value.price),
        updated: Number(value.updated) || Date.now(),
      };
    }
  }

  const history = [];
  if (Array.isArray(raw.history)) {
    for (const trip of raw.history) {
      if (!trip || !Array.isArray(trip.items)) continue;
      const tripItems = trip.items.map(normalizeItem).filter(Boolean);
      history.push({
        id: typeof trip.id === 'string' && trip.id ? trip.id : uid(),
        at: Number(trip.at) || Date.now(),
        currency: CURRENCIES.includes(trip.currency) ? trip.currency : base.currency,
        items: tripItems,
        total: round2(tripItems.reduce((sum, it) => sum + it.qty * it.price, 0)),
      });
    }
  }

  return {
    v: 1,
    currency: CURRENCIES.includes(raw.currency) ? raw.currency : base.currency,
    items,
    catalog,
    history,
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (err) {
    console.warn('Не удалось загрузить данные:', err);
  }
  return defaultState();
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error(err);
    showToast('Не удалось сохранить данные на устройстве');
  }
}

function totals(items) {
  let sum = 0;
  let done = 0;
  for (const it of items) {
    sum = round2(sum + it.qty * it.price);
    if (it.done) done += 1;
  }
  return { sum, done, count: items.length };
}

function upsertCatalog(name, price) {
  const key = normKey(name);
  if (!key) return;
  state.catalog[key] = {
    name: String(name).trim().slice(0, 120),
    price: round2(price),
    updated: Date.now(),
  };
}

/* ================= DOM ================= */

const el = {
  title: $('#title'),
  summary: $('#summary'),
  totalValue: $('#totalValue'),
  sumline: $('#sumline'),
  progress: $('#progress'),
  progressBar: $('#progressBar'),
  main: $('#main'),

  viewList: $('#view-list'),
  viewCatalog: $('#view-catalog'),
  viewHistory: $('#view-history'),

  itemsList: $('#items'),
  emptyList: $('#emptyList'),

  catalogList: $('#catalogList'),
  emptyCatalog: $('#emptyCatalog'),
  catalogSearch: $('#catalogSearch'),
  catalogHint: $('#catalogHint'),

  historyList: $('#historyList'),
  emptyHistory: $('#emptyHistory'),
  historyStat: $('#historyStat'),
  historyTotal: $('#historyTotal'),
  historyNote: $('#historyNote'),

  composer: $('#composer'),
  nameInput: $('#nameInput'),
  qtyInput: $('#qtyInput'),
  priceInput: $('#priceInput'),
  curLabel: $('#curLabel'),
  suggest: $('#suggest'),

  tabbar: $('#tabbar'),
  menuBtn: $('#menuBtn'),
  menuDialog: $('#menuDialog'),
  currencyChips: $('#currencyChips'),
  finishBtn: $('#finishBtn'),
  clearListBtn: $('#clearListBtn'),
  exportBtn: $('#exportBtn'),
  importBtn: $('#importBtn'),
  importFile: $('#importFile'),

  editDialog: $('#editDialog'),
  editName: $('#editName'),
  editQty: $('#editQty'),
  editPrice: $('#editPrice'),
  editHint: $('#editHint'),
  editDelete: $('#editDelete'),
  editSave: $('#editSave'),

  toast: $('#toast'),
  toastText: $('#toastText'),
  toastAction: $('#toastAction'),
};

/* ================= рендер ================= */

function renderAll() {
  el.curLabel.textContent = state.currency;
  renderHeader();
  renderList();
  renderCatalog();
  renderHistory();
  renderChips();
}

function renderHeader() {
  const t = totals(state.items);
  if (tab !== 'list') return;
  el.totalValue.textContent = money(t.sum);
  if (t.count === 0) {
    el.summary.textContent = 'Пока ничего нет';
  } else {
    const parts = [`${t.count} ${plural(t.count, 'товар', 'товара', 'товаров')}`];
    if (t.done > 0) parts.push(`куплено ${t.done}`);
    el.summary.textContent = parts.join(' · ');
  }
  const percent = t.count ? Math.round((t.done / t.count) * 100) : 0;
  el.progressBar.style.width = percent + '%';
}

function makeCheckIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
}

function renderList() {
  const sorted = [...state.items].sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0));
  const fragment = document.createDocumentFragment();

  for (const it of sorted) {
    const row = document.createElement('div');
    row.className = 'item' + (it.done ? ' done' : '') + (it.id === selectedId ? ' selected' : '');
    row.dataset.id = it.id;

    const check = document.createElement('button');
    check.type = 'button';
    check.className = 'check';
    check.setAttribute('aria-label', it.done ? 'Снять отметку' : 'Отметить купленным');
    check.innerHTML = makeCheckIcon();

    const body = document.createElement('div');
    body.className = 'item-body';

    const name = document.createElement('div');
    name.className = 'item-name';
    name.textContent = it.name;

    const meta = document.createElement('div');
    meta.className = 'item-meta';
    meta.textContent = `${num(it.qty)} × ${money(it.price)}`;

    body.append(name, meta);

    const total = document.createElement('div');
    total.className = 'item-total';
    total.textContent = money(it.qty * it.price);

    row.append(check, body, total);
    if (justAdded.has(it.id)) row.classList.add('pop');
    fragment.append(row);
  }

  el.itemsList.replaceChildren(fragment);
  justAdded.clear();
  el.emptyList.hidden = state.items.length > 0;
}

function renderCatalog() {
  const query = normKey(el.catalogSearch.value);
  let entries = Object.entries(state.catalog).map(([key, value]) => ({ key, ...value }));
  if (query) entries = entries.filter((entry) => normKey(entry.name).includes(query));
  entries.sort((a, b) => b.updated - a.updated);

  const fragment = document.createDocumentFragment();

  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'item';
    row.dataset.key = entry.key;

    const body = document.createElement('div');
    body.className = 'item-body';
    const name = document.createElement('div');
    name.className = 'item-name';
    name.textContent = entry.name;
    const meta = document.createElement('div');
    meta.className = 'item-meta';
    meta.textContent = entry.price > 0 ? money(entry.price) : 'цена не указана';
    body.append(name, meta);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'mini-btn';
    del.dataset.act = 'del';
    del.setAttribute('aria-label', 'Удалить из справочника');
    del.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M6.5 7l.8 12.2a1.6 1.6 0 0 0 1.6 1.5h6.2a1.6 1.6 0 0 0 1.6-1.5L17.5 7"/></svg>';

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'mini-btn plus';
    add.dataset.act = 'add';
    add.setAttribute('aria-label', 'Добавить в список');
    add.innerHTML = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

    row.append(body, del, add);
    fragment.append(row);
  }

  el.catalogList.replaceChildren(fragment);

  const isEmpty = entries.length === 0;
  el.emptyCatalog.hidden = !isEmpty;
  el.catalogHint.hidden = isEmpty || !!query;
  if (isEmpty && query) {
    el.emptyCatalog.querySelector('.empty-title').textContent = 'Ничего не найдено';
    el.emptyCatalog.querySelector('.empty-text').textContent = 'Попробуйте изменить запрос или добавьте товар в список — он сохранится здесь.';
  } else {
    el.emptyCatalog.querySelector('.empty-title').textContent = 'Справочник пуст';
    el.emptyCatalog.querySelector('.empty-text').textContent = 'Товары, которые вы добавляете в список, автоматически сохраняются здесь вместе с ценой.';
  }
}

const dateFmt = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function renderHistory() {
  const history = state.history;
  el.historyStat.hidden = history.length === 0;
  el.emptyHistory.hidden = history.length > 0;

  const sameCurrency = history.filter((trip) => trip.currency === state.currency);
  const spent = sameCurrency.reduce((sum, trip) => sum + (trip.total || 0), 0);
  el.historyTotal.textContent = money(spent);
  const otherCurrency = history.length - sameCurrency.length;
  el.historyNote.textContent =
    `${sameCurrency.length} ${plural(sameCurrency.length, 'покупка', 'покупки', 'покупок')} в ${state.currency}` +
    (otherCurrency > 0 ? ` · ещё ${otherCurrency} в другой валюте` : '');

  const fragment = document.createDocumentFragment();

  for (const trip of history) {
    const details = document.createElement('details');
    details.className = 'trip';
    details.dataset.id = trip.id;

    const summary = document.createElement('summary');

    const left = document.createElement('div');
    const date = document.createElement('div');
    date.className = 'trip-date';
    date.textContent = dateFmt.format(new Date(trip.at));
    const meta = document.createElement('div');
    meta.className = 'trip-meta';
    meta.textContent = `${trip.items.length} ${plural(trip.items.length, 'товар', 'товара', 'товаров')}`;
    left.append(date, meta);

    const sum = document.createElement('div');
    sum.className = 'trip-sum';
    sum.textContent = money(trip.total, trip.currency);

    summary.append(left, sum);

    const itemsBox = document.createElement('div');
    itemsBox.className = 'trip-items';
    for (const it of trip.items) {
      const line = document.createElement('div');
      line.className = 'trip-line';
      const leftText = document.createElement('span');
      leftText.textContent = `${it.name} · ${num(it.qty)} × ${money(it.price, trip.currency)}`;
      const rightText = document.createElement('span');
      rightText.textContent = money(it.qty * it.price, trip.currency);
      line.append(leftText, rightText);
      itemsBox.append(line);
    }

    const actions = document.createElement('div');
    actions.className = 'trip-actions';

    const repeat = document.createElement('button');
    repeat.type = 'button';
    repeat.className = 'btn';
    repeat.dataset.act = 'repeat';
    repeat.textContent = 'Повторить';

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn danger';
    del.dataset.act = 'delete';
    del.textContent = 'Удалить';

    actions.append(repeat, del);
    details.append(summary, itemsBox, actions);
    fragment.append(details);
  }

  el.historyList.replaceChildren(fragment);
}

function renderChips() {
  for (const chip of $$('.chip', el.currencyChips)) {
    chip.classList.toggle('active', chip.dataset.cur === state.currency);
  }
}

/* ================= подсказки ================= */

function hideSuggest() {
  el.suggest.hidden = true;
  el.suggest.replaceChildren();
}

function updateSuggest() {
  const query = normKey(el.nameInput.value);
  let entries = Object.entries(state.catalog)
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => b.updated - a.updated);

  if (query) entries = entries.filter((entry) => normKey(entry.name).includes(query));
  entries = entries.filter((entry) => normKey(entry.name) !== query).slice(0, 6);

  if (entries.length === 0) {
    hideSuggest();
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const entry of entries) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.key = entry.key;

    const label = document.createElement('span');
    label.textContent = entry.name;

    const price = document.createElement('span');
    price.className = 's-price';
    price.textContent = entry.price > 0 ? money(entry.price) : '—';

    button.append(label, price);
    fragment.append(button);
  }

  el.suggest.replaceChildren(fragment);
  el.suggest.hidden = false;
}

/* ================= операции со списком ================= */

function scrollToItem(id) {
  const row = el.itemsList.querySelector(`[data-id="${id}"]`);
  if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function clearSelection() {
  if (selectedId === null) return;
  selectedId = null;
  const row = el.itemsList.querySelector('.item.selected');
  if (row) row.classList.remove('selected');
}

function selectItem(id, row) {
  const current = el.itemsList.querySelector('.item.selected');
  if (current && current !== row) current.classList.remove('selected');
  selectedId = id;
  if (row) row.classList.add('selected');
}

function addItem(name, qty, price) {
  const item = {
    id: uid(),
    name: String(name).trim().slice(0, 120),
    qty: saneQty(qty),
    price: sanePrice(price),
    done: false,
  };
  state.items.push(item);
  if (item.price > 0) upsertCatalog(item.name, item.price);
  justAdded.add(item.id);
  save();
  renderAll();
  scrollToItem(item.id);
  return item;
}

function addFromComposer() {
  const name = el.nameInput.value.trim();
  if (!name) {
    el.nameInput.focus();
    return;
  }
  const qty = parseNum(el.qtyInput.value) || 1;
  const price = parseNum(el.priceInput.value);

  addItem(name, qty, price);

  el.nameInput.value = '';
  el.qtyInput.value = '1';
  el.priceInput.value = '';
  hideSuggest();
  el.nameInput.focus();
}

function toggleItem(id) {
  const item = state.items.find((it) => it.id === id);
  if (!item) return;
  item.done = !item.done;
  save();
  renderAll();
}

function deleteItem(id) {
  const index = state.items.findIndex((it) => it.id === id);
  if (index < 0) return;
  const [removed] = state.items.splice(index, 1);
  save();
  renderAll();
  showToast(`Удалено: ${removed.name}`, 'Отменить', () => {
    state.items.splice(Math.min(index, state.items.length), 0, removed);
    save();
    renderAll();
  });
  return removed;
}

function addFromCatalog(key) {
  const entry = state.catalog[key];
  if (!entry) return;
  addItem(entry.name, 1, entry.price);
  showToast(`Добавлено: ${entry.name}`, 'Открыть', () => setTab('list'));
}

function deleteCatalogEntry(key) {
  const entry = state.catalog[key];
  if (!entry) return;
  delete state.catalog[key];
  save();
  renderAll();
  showToast(`Удалено из справочника: ${entry.name}`, 'Отменить', () => {
    state.catalog[key] = entry;
    save();
    renderAll();
  });
}

function openEditor(id) {
  clearSelection();
  const item = state.items.find((it) => it.id === id);
  if (!item) return;
  editId = id;
  el.editName.value = item.name;
  el.editQty.value = String(item.qty).replace('.', ',');
  el.editPrice.value = priceForInput(item.price);
  updateEditHint();
  el.editDialog.showModal();
}

function updateEditHint() {
  const qty = parseNum(el.editQty.value);
  const price = parseNum(el.editPrice.value);
  el.editHint.textContent = 'Сумма: ' + money(qty * price);
}

function saveEditor() {
  const item = state.items.find((it) => it.id === editId);
  if (!item) {
    el.editDialog.close();
    return;
  }
  const name = el.editName.value.trim();
  if (!name) {
    el.editName.focus();
    return;
  }
  item.name = name.slice(0, 120);
  item.qty = saneQty(el.editQty.value);
  item.price = sanePrice(el.editPrice.value);
  if (item.price > 0) upsertCatalog(item.name, item.price);
  el.editDialog.close();
  save();
  renderAll();
}

function clearList() {
  if (state.items.length === 0) {
    showToast('Список уже пуст');
    return;
  }
  if (!confirm('Очистить список? Товары не попадут в историю.')) return;
  state.items = [];
  save();
  renderAll();
  showToast('Список очищен');
}

function finishTrip() {
  if (state.items.length === 0) {
    showToast('Список пуст');
    return;
  }
  const t = totals(state.items);
  const unbought = t.count - t.done;
  if (unbought > 0) {
    const question =
      `Не отмечено купленными: ${unbought} ${plural(unbought, 'товар', 'товара', 'товаров')}. ` +
      'Всё равно завершить покупку и сохранить список в историю?';
    if (!confirm(question)) return;
  }

  state.history.unshift({
    id: uid(),
    at: Date.now(),
    currency: state.currency,
    items: state.items.map((it) => ({ ...it })),
    total: t.sum,
  });
  state.items = [];
  save();
  renderAll();
  showToast('Покупка сохранена в истории');
}

function repeatTrip(id) {
  const trip = state.history.find((t) => t.id === id);
  if (!trip) return;
  if (state.items.length > 0 && !confirm('Добавить товары из этой покупки к текущему списку?')) return;
  for (const it of trip.items) {
    state.items.push({ ...it, id: uid(), done: false });
  }
  save();
  renderAll();
  setTab('list');
  showToast(`Добавлено ${trip.items.length} ${plural(trip.items.length, 'товар', 'товара', 'товаров')}`);
}

function deleteTrip(id) {
  const index = state.history.findIndex((t) => t.id === id);
  if (index < 0) return;
  if (!confirm('Удалить эту покупку из истории?')) return;
  const [removed] = state.history.splice(index, 1);
  save();
  renderAll();
  showToast('Покупка удалена из истории', 'Отменить', () => {
    state.history.splice(Math.min(index, state.history.length), 0, removed);
    save();
    renderAll();
  });
}

/* ================= вкладки и меню ================= */

function setTab(next) {
  tab = next;
  for (const button of $$('.tab', el.tabbar)) {
    button.classList.toggle('active', button.dataset.tab === next);
  }
  el.viewList.hidden = next !== 'list';
  el.viewCatalog.hidden = next !== 'catalog';
  el.viewHistory.hidden = next !== 'history';
  el.composer.hidden = next !== 'list';
  el.sumline.hidden = next !== 'list';
  el.progress.hidden = next !== 'list';
  el.title.textContent = next === 'list' ? 'Покупки' : next === 'catalog' ? 'Товары' : 'История';
  el.main.scrollTop = 0;
  hideSuggest();
  clearSelection();
  renderHeader();
}

function exportData() {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  const fileName = `покупки-${stamp}.json`;
  const text = JSON.stringify(state, null, 2);

  // В Android-приложении файл пишется напрямую в папку «Загрузки».
  if (isNativeApp()) {
    try {
      window.AndroidApp.saveTextFile(fileName, text);
      return;
    } catch (err) {
      console.warn('Нативное сохранение недоступно, используется скачивание', err);
    }
  }

  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  showToast('Файл с данными сохранён');
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(String(reader.result));
    } catch (err) {
      alert('Не удалось прочитать файл: это не копия данных приложения.');
      return;
    }
    const next = normalize(parsed);
    const totalCount = next.items.length + Object.keys(next.catalog).length;
    if (totalCount === 0) {
      alert('В файле нет данных для загрузки.');
      return;
    }
    if (!confirm('Заменить текущие данные данными из файла?')) return;
    state = next;
    save();
    renderAll();
    setTab('list');
    showToast('Данные загружены');
  };
  reader.onerror = () => alert('Не удалось прочитать файл.');
  reader.readAsText(file);
}

/* ================= тост ================= */

function showToast(message, actionLabel, action) {
  el.toastText.textContent = message;
  if (actionLabel && typeof action === 'function') {
    el.toastAction.hidden = false;
    el.toastAction.textContent = actionLabel;
    toastActionFn = action;
  } else {
    el.toastAction.hidden = true;
    toastActionFn = null;
  }
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, actionLabel ? 6000 : 2400);
}

function hideToast() {
  el.toast.hidden = true;
  toastActionFn = null;
  clearTimeout(toastTimer);
}

/* ================= события ================= */

function bindEvents() {
  // вкладки
  el.tabbar.addEventListener('click', (event) => {
    const button = event.target.closest('.tab');
    if (button) setTab(button.dataset.tab);
  });

  // список
  el.itemsList.addEventListener('click', (event) => {
    const row = event.target.closest('.item');
    if (!row) return;
    const id = row.dataset.id;

    // квадратик слева отмечает купленное, не открывая редактор
    if (event.target.closest('.check')) {
      if (selectedId === id) clearSelection();
      toggleItem(id);
      return;
    }

    // первое нажатие — выделить, второе по тому же товару — открыть редактор
    if (selectedId !== id) {
      selectItem(id, row);
      showToast('Нажмите ещё раз, чтобы изменить товар');
      return;
    }
    openEditor(id);
  });

  // нажатие мимо товаров снимает выделение
  el.main.addEventListener('click', (event) => {
    if (!event.target.closest('.item')) clearSelection();
  });

  // справочник
  el.catalogList.addEventListener('click', (event) => {
    const row = event.target.closest('.item');
    if (!row) return;
    const key = row.dataset.key;
    const action = event.target.closest('[data-act]');
    if (action && action.dataset.act === 'del') deleteCatalogEntry(key);
    else addFromCatalog(key);
  });

  el.catalogSearch.addEventListener('input', renderCatalog);

  // история
  el.historyList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-act]');
    if (!button) return;
    const trip = button.closest('.trip');
    if (!trip) return;
    const id = trip.dataset.id;
    if (button.dataset.act === 'repeat') repeatTrip(id);
    else if (button.dataset.act === 'delete') deleteTrip(id);
  });

  // добавление товара
  el.composer.addEventListener('submit', (event) => {
    event.preventDefault();
    addFromComposer();
  });

  el.composer.addEventListener('click', (event) => {
    const stepButton = event.target.closest('.step');
    if (!stepButton) return;
    const step = Number(stepButton.dataset.step) || 0;
    const current = parseNum(el.qtyInput.value) || 1;
    const next = Math.max(1, Math.round((current + step) * 1000) / 1000);
    el.qtyInput.value = String(next).replace('.', ',');
    el.priceInput.focus();
  });

  el.qtyInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      el.priceInput.focus();
    }
  });

  el.nameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      updateSuggest();
      el.qtyInput.focus();
    }
  });

  el.priceInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      el.composer.requestSubmit();
    }
  });

  // подсказки
  el.nameInput.addEventListener('input', updateSuggest);
  el.nameInput.addEventListener('focus', updateSuggest);
  el.nameInput.addEventListener('blur', () => setTimeout(hideSuggest, 140));

  el.suggest.addEventListener('pointerdown', (event) => {
    const button = event.target.closest('button[data-key]');
    if (!button) return;
    event.preventDefault();
    const entry = state.catalog[button.dataset.key];
    if (!entry) return;
    el.nameInput.value = entry.name;
    if (entry.price > 0) el.priceInput.value = priceForInput(entry.price);
    hideSuggest();
    el.nameInput.blur();
    el.qtyInput.value = '1';
  });

  // редактирование
  el.editSave.addEventListener('click', saveEditor);
  el.editDelete.addEventListener('click', () => {
    const id = editId;
    el.editDialog.close();
    if (id) deleteItem(id);
  });
  el.editQty.addEventListener('input', updateEditHint);
  el.editPrice.addEventListener('input', updateEditHint);
  el.editName.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      el.editQty.focus();
    }
  });
  el.editPrice.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveEditor();
    }
  });

  // меню
  el.menuBtn.addEventListener('click', () => el.menuDialog.showModal());
  el.currencyChips.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;
    state.currency = chip.dataset.cur;
    save();
    renderAll();
  });
  el.finishBtn.addEventListener('click', () => {
    el.menuDialog.close();
    finishTrip();
  });
  el.clearListBtn.addEventListener('click', () => {
    el.menuDialog.close();
    clearList();
  });
  el.exportBtn.addEventListener('click', exportData);
  el.importBtn.addEventListener('click', () => el.importFile.click());
  el.importFile.addEventListener('change', () => {
    const file = el.importFile.files && el.importFile.files[0];
    if (file) importData(file);
    el.importFile.value = '';
  });

  // закрытие диалогов
  document.addEventListener('click', (event) => {
    const closer = event.target.closest('[data-close]');
    if (closer) {
      const dialog = document.getElementById(closer.dataset.close);
      if (dialog) dialog.close();
    }
  });

  for (const dialog of $$('dialog.sheet')) {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  }

  // тост
  el.toastAction.addEventListener('click', () => {
    const action = toastActionFn;
    hideToast();
    if (action) action();
  });

  // сохранение при уходе со страницы
  window.addEventListener('pagehide', save);
}

/* ================= запуск ================= */

function init() {
  state = loadState();

  for (const currency of CURRENCIES) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.dataset.cur = currency;
    chip.textContent = currency;
    el.currencyChips.append(chip);
  }

  bindEvents();
  renderAll();
  setTab('list');

  if ('serviceWorker' in navigator && !isNativeApp()) {
    navigator.serviceWorker
      .register('./sw.js')
      .then((registration) => {
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              showToast('Доступно обновление приложения', 'Обновить', () => location.reload());
            }
          });
        });
      })
      .catch(() => {});
  }
}

init();
