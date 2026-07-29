const IS_DEV = false;
const equalFn = (a, b) => a === b;
const $TRACK = Symbol("solid-track");
const signalOptions = {
  equals: equalFn
};
let runEffects = runQueue;
const STALE = 1;
const PENDING = 2;
const UNOWNED = {
  owned: null,
  cleanups: null,
  context: null,
  owner: null
};
var Owner = null;
let Transition = null;
let ExternalSourceConfig = null;
let Listener = null;
let Updates = null;
let Effects = null;
let ExecCount = 0;
function createRoot(fn, detachedOwner) {
  const listener = Listener, owner = Owner, unowned = fn.length === 0, current = detachedOwner === void 0 ? owner : detachedOwner, root = unowned ? UNOWNED : {
    owned: null,
    cleanups: null,
    context: current ? current.context : null,
    owner: current
  }, updateFn = unowned ? fn : () => fn(() => untrack(() => cleanNode(root)));
  Owner = root;
  Listener = null;
  try {
    return runUpdates(updateFn, true);
  } finally {
    Listener = listener;
    Owner = owner;
  }
}
function createSignal(value, options) {
  options = options ? Object.assign({}, signalOptions, options) : signalOptions;
  const s = {
    value,
    observers: null,
    observerSlots: null,
    comparator: options.equals || void 0
  };
  const setter = (value2) => {
    if (typeof value2 === "function") {
      value2 = value2(s.value);
    }
    return writeSignal(s, value2);
  };
  return [readSignal.bind(s), setter];
}
function createRenderEffect(fn, value, options) {
  const c = createComputation(fn, value, false, STALE);
  updateComputation(c);
}
function createEffect(fn, value, options) {
  runEffects = runUserEffects;
  const c = createComputation(fn, value, false, STALE);
  c.user = true;
  Effects ? Effects.push(c) : updateComputation(c);
}
function createMemo(fn, value, options) {
  options = options ? Object.assign({}, signalOptions, options) : signalOptions;
  const c = createComputation(fn, value, true, 0);
  c.observers = null;
  c.observerSlots = null;
  c.comparator = options.equals || void 0;
  updateComputation(c);
  return readSignal.bind(c);
}
function untrack(fn) {
  if (Listener === null) return fn();
  const listener = Listener;
  Listener = null;
  try {
    if (ExternalSourceConfig) ;
    return fn();
  } finally {
    Listener = listener;
  }
}
function onCleanup(fn) {
  if (Owner === null) ;
  else if (Owner.cleanups === null) Owner.cleanups = [fn];
  else Owner.cleanups.push(fn);
  return fn;
}
function createContext(defaultValue, options) {
  const id = Symbol("context");
  return {
    id,
    Provider: createProvider(id),
    defaultValue
  };
}
function useContext(context) {
  let value;
  return Owner && Owner.context && (value = Owner.context[context.id]) !== void 0 ? value : context.defaultValue;
}
function children(fn) {
  const children2 = createMemo(fn);
  const memo2 = createMemo(() => resolveChildren(children2()));
  memo2.toArray = () => {
    const c = memo2();
    return Array.isArray(c) ? c : c != null ? [c] : [];
  };
  return memo2;
}
function readSignal() {
  if (this.sources && this.state) {
    if (this.state === STALE) updateComputation(this);
    else {
      const updates = Updates;
      Updates = null;
      runUpdates(() => lookUpstream(this), false);
      Updates = updates;
    }
  }
  if (Listener) {
    const observers = this.observers;
    if (!observers || observers[observers.length - 1] !== Listener) {
      const sSlot = observers ? observers.length : 0;
      if (!Listener.sources) {
        Listener.sources = [this];
        Listener.sourceSlots = [sSlot];
      } else {
        Listener.sources.push(this);
        Listener.sourceSlots.push(sSlot);
      }
      if (!observers) {
        this.observers = [Listener];
        this.observerSlots = [Listener.sources.length - 1];
      } else {
        observers.push(Listener);
        this.observerSlots.push(Listener.sources.length - 1);
      }
    }
  }
  return this.value;
}
function writeSignal(node, value, isComp) {
  let current = node.value;
  if (!node.comparator || !node.comparator(current, value)) {
    node.value = value;
    if (node.observers && node.observers.length) {
      runUpdates(() => {
        for (let i = 0; i < node.observers.length; i += 1) {
          const o = node.observers[i];
          const TransitionRunning = Transition && Transition.running;
          if (TransitionRunning && Transition.disposed.has(o)) ;
          if (TransitionRunning ? !o.tState : !o.state) {
            if (o.pure) Updates.push(o);
            else Effects.push(o);
            if (o.observers) markDownstream(o);
          }
          if (!TransitionRunning) o.state = STALE;
        }
        if (Updates.length > 1e6) {
          Updates = [];
          if (IS_DEV) ;
          throw new Error();
        }
      }, false);
    }
  }
  return value;
}
function updateComputation(node) {
  if (!node.fn) return;
  cleanNode(node);
  const time = ExecCount;
  runComputation(node, node.value, time);
}
function runComputation(node, value, time) {
  let nextValue;
  const owner = Owner, listener = Listener;
  Listener = Owner = node;
  try {
    nextValue = node.fn(value);
  } catch (err) {
    if (node.pure) {
      {
        node.state = STALE;
        node.owned && node.owned.forEach(cleanNode);
        node.owned = null;
      }
    }
    node.updatedAt = time + 1;
    return handleError(err);
  } finally {
    Listener = listener;
    Owner = owner;
  }
  if (!node.updatedAt || node.updatedAt <= time) {
    if (node.updatedAt != null && "observers" in node) {
      writeSignal(node, nextValue);
    } else node.value = nextValue;
    node.updatedAt = time;
  }
}
function createComputation(fn, init, pure, state = STALE, options) {
  const c = {
    fn,
    state,
    updatedAt: null,
    owned: null,
    sources: null,
    sourceSlots: null,
    cleanups: null,
    value: init,
    owner: Owner,
    context: Owner ? Owner.context : null,
    pure
  };
  if (Owner === null) ;
  else if (Owner !== UNOWNED) {
    {
      if (!Owner.owned) Owner.owned = [c];
      else Owner.owned.push(c);
    }
  }
  return c;
}
function runTop(node) {
  if (node.state === 0) return;
  if (node.state === PENDING) return lookUpstream(node);
  if (node.suspense && untrack(node.suspense.inFallback)) return node.suspense.effects.push(node);
  const ancestors = [node];
  while ((node = node.owner) && (!node.updatedAt || node.updatedAt < ExecCount)) {
    if (node.state) ancestors.push(node);
  }
  for (let i = ancestors.length - 1; i >= 0; i--) {
    node = ancestors[i];
    if (node.state === STALE) {
      updateComputation(node);
    } else if (node.state === PENDING) {
      const updates = Updates;
      Updates = null;
      runUpdates(() => lookUpstream(node, ancestors[0]), false);
      Updates = updates;
    }
  }
}
function runUpdates(fn, init) {
  if (Updates) return fn();
  let wait = false;
  if (!init) Updates = [];
  if (Effects) wait = true;
  else Effects = [];
  ExecCount++;
  try {
    const res = fn();
    completeUpdates(wait);
    return res;
  } catch (err) {
    if (!wait) Effects = null;
    Updates = null;
    handleError(err);
  }
}
function completeUpdates(wait) {
  if (Updates) {
    runQueue(Updates);
    Updates = null;
  }
  if (wait) return;
  const e = Effects;
  Effects = null;
  if (e.length) runUpdates(() => runEffects(e), false);
}
function runQueue(queue) {
  for (let i = 0; i < queue.length; i++) runTop(queue[i]);
}
function runUserEffects(queue) {
  let i, userLength = 0;
  for (i = 0; i < queue.length; i++) {
    const e = queue[i];
    if (!e.user) runTop(e);
    else queue[userLength++] = e;
  }
  for (i = 0; i < userLength; i++) runTop(queue[i]);
}
function lookUpstream(node, ignore) {
  node.state = 0;
  for (let i = 0; i < node.sources.length; i += 1) {
    const source = node.sources[i];
    if (source.sources) {
      const state = source.state;
      if (state === STALE) {
        if (source !== ignore && (!source.updatedAt || source.updatedAt < ExecCount)) runTop(source);
      } else if (state === PENDING) lookUpstream(source, ignore);
    }
  }
}
function markDownstream(node) {
  for (let i = 0; i < node.observers.length; i += 1) {
    const o = node.observers[i];
    if (!o.state) {
      o.state = PENDING;
      if (o.pure) Updates.push(o);
      else Effects.push(o);
      o.observers && markDownstream(o);
    }
  }
}
function cleanNode(node) {
  let i;
  if (node.sources) {
    while (node.sources.length) {
      const source = node.sources.pop(), index = node.sourceSlots.pop(), obs = source.observers;
      if (obs && obs.length) {
        const n = obs.pop(), s = source.observerSlots.pop();
        if (index < obs.length) {
          n.sourceSlots[s] = index;
          obs[index] = n;
          source.observerSlots[index] = s;
        }
      }
    }
  }
  if (node.tOwned) {
    for (i = node.tOwned.length - 1; i >= 0; i--) cleanNode(node.tOwned[i]);
    delete node.tOwned;
  }
  if (node.owned) {
    for (i = node.owned.length - 1; i >= 0; i--) cleanNode(node.owned[i]);
    node.owned = null;
  }
  if (node.cleanups) {
    for (i = node.cleanups.length - 1; i >= 0; i--) node.cleanups[i]();
    node.cleanups = null;
  }
  node.state = 0;
}
function castError(err) {
  if (err instanceof Error) return err;
  return new Error(typeof err === "string" ? err : "Unknown error", {
    cause: err
  });
}
function handleError(err, owner = Owner) {
  const error = castError(err);
  throw error;
}
function resolveChildren(children2) {
  if (typeof children2 === "function" && !children2.length) return resolveChildren(children2());
  if (Array.isArray(children2)) {
    const results = [];
    for (let i = 0; i < children2.length; i++) {
      const result = resolveChildren(children2[i]);
      if (Array.isArray(result)) {
        if (result.length < 32768) results.push.apply(results, result);
        else for (let j = 0; j < result.length; j++) results.push(result[j]);
      } else {
        results.push(result);
      }
    }
    return results;
  }
  return children2;
}
function createProvider(id, options) {
  return function provider(props) {
    let res;
    createRenderEffect(() => res = untrack(() => {
      Owner.context = {
        ...Owner.context,
        [id]: props.value
      };
      return children(() => props.children);
    }), void 0);
    return res;
  };
}
const FALLBACK = Symbol("fallback");
function dispose(d) {
  for (let i = 0; i < d.length; i++) d[i]();
}
function mapArray(list, mapFn, options = {}) {
  let items = [], mapped = [], disposers = [], len = 0, indexes = mapFn.length > 1 ? [] : null;
  onCleanup(() => dispose(disposers));
  return () => {
    let newItems = list() || [], newLen = newItems.length, i, j;
    newItems[$TRACK];
    return untrack(() => {
      let newIndices, newIndicesNext, temp, tempdisposers, tempIndexes, start, end, newEnd, item;
      if (newLen === 0) {
        if (len !== 0) {
          dispose(disposers);
          disposers = [];
          items = [];
          mapped = [];
          len = 0;
          indexes && (indexes = []);
        }
        if (options.fallback) {
          items = [FALLBACK];
          mapped[0] = createRoot((disposer) => {
            disposers[0] = disposer;
            return options.fallback();
          });
          len = 1;
        }
      } else if (len === 0) {
        mapped = new Array(newLen);
        for (j = 0; j < newLen; j++) {
          items[j] = newItems[j];
          mapped[j] = createRoot(mapper);
        }
        len = newLen;
      } else {
        temp = new Array(newLen);
        tempdisposers = new Array(newLen);
        indexes && (tempIndexes = new Array(newLen));
        for (start = 0, end = Math.min(len, newLen); start < end && items[start] === newItems[start]; start++) ;
        for (end = len - 1, newEnd = newLen - 1; end >= start && newEnd >= start && items[end] === newItems[newEnd]; end--, newEnd--) {
          temp[newEnd] = mapped[end];
          tempdisposers[newEnd] = disposers[end];
          indexes && (tempIndexes[newEnd] = indexes[end]);
        }
        newIndices = /* @__PURE__ */ new Map();
        newIndicesNext = new Array(newEnd + 1);
        for (j = newEnd; j >= start; j--) {
          item = newItems[j];
          i = newIndices.get(item);
          newIndicesNext[j] = i === void 0 ? -1 : i;
          newIndices.set(item, j);
        }
        for (i = start; i <= end; i++) {
          item = items[i];
          j = newIndices.get(item);
          if (j !== void 0 && j !== -1) {
            temp[j] = mapped[i];
            tempdisposers[j] = disposers[i];
            indexes && (tempIndexes[j] = indexes[i]);
            j = newIndicesNext[j];
            newIndices.set(item, j);
          } else disposers[i]();
        }
        for (j = start; j < newLen; j++) {
          if (j in temp) {
            mapped[j] = temp[j];
            disposers[j] = tempdisposers[j];
            if (indexes) {
              indexes[j] = tempIndexes[j];
              indexes[j](j);
            }
          } else mapped[j] = createRoot(mapper);
        }
        mapped = mapped.slice(0, len = newLen);
        items = newItems.slice(0);
      }
      return mapped;
    });
    function mapper(disposer) {
      disposers[j] = disposer;
      if (indexes) {
        const [s, set] = createSignal(j);
        indexes[j] = set;
        return mapFn(newItems[j], s);
      }
      return mapFn(newItems[j]);
    }
  };
}
function createComponent(Comp, props) {
  return untrack(() => Comp(props || {}));
}
const narrowedError = (name) => `Stale read from <${name}>.`;
function For(props) {
  const fallback = "fallback" in props && {
    fallback: () => props.fallback
  };
  return createMemo(mapArray(() => props.each, props.children, fallback || void 0));
}
function Switch(props) {
  const chs = children(() => props.children);
  const switchFunc = createMemo(() => {
    const ch = chs();
    const mps = Array.isArray(ch) ? ch : [ch];
    let func = () => void 0;
    for (let i = 0; i < mps.length; i++) {
      const index = i;
      const mp = mps[i];
      const prevFunc = func;
      const conditionValue = createMemo(() => prevFunc() ? void 0 : mp.when, void 0, void 0);
      const condition = mp.keyed ? conditionValue : createMemo(conditionValue, void 0, {
        equals: (a, b) => !a === !b
      });
      func = () => prevFunc() || (condition() ? [index, conditionValue, mp] : void 0);
    }
    return func;
  });
  return createMemo(() => {
    const sel = switchFunc()();
    if (!sel) return props.fallback;
    const [index, conditionValue, mp] = sel;
    const child = mp.children;
    const fn = typeof child === "function" && child.length > 0;
    return fn ? untrack(() => child(mp.keyed ? conditionValue() : () => {
      if (untrack(switchFunc)()?.[0] !== index) throw narrowedError("Match");
      return conditionValue();
    })) : child;
  }, void 0, void 0);
}
function Match(props) {
  return props;
}
const memo = (fn) => createMemo(() => fn());
function reconcileArrays(parentNode, a, b) {
  let bLength = b.length, aEnd = a.length, bEnd = bLength, aStart = 0, bStart = 0, after = a[aEnd - 1].nextSibling, map = null;
  while (aStart < aEnd || bStart < bEnd) {
    if (a[aStart] === b[bStart]) {
      aStart++;
      bStart++;
      continue;
    }
    while (a[aEnd - 1] === b[bEnd - 1]) {
      aEnd--;
      bEnd--;
    }
    if (aEnd === aStart) {
      const node = bEnd < bLength ? bStart ? b[bStart - 1].nextSibling : b[bEnd - bStart] : after;
      while (bStart < bEnd) parentNode.insertBefore(b[bStart++], node);
    } else if (bEnd === bStart) {
      while (aStart < aEnd) {
        if (!map || !map.has(a[aStart])) a[aStart].remove();
        aStart++;
      }
    } else if (a[aStart] === b[bEnd - 1] && b[bStart] === a[aEnd - 1]) {
      const node = a[--aEnd].nextSibling;
      parentNode.insertBefore(b[bStart++], a[aStart++].nextSibling);
      parentNode.insertBefore(b[--bEnd], node);
      a[aEnd] = b[bEnd];
    } else {
      if (!map) {
        map = /* @__PURE__ */ new Map();
        let i = bStart;
        while (i < bEnd) map.set(b[i], i++);
      }
      const index = map.get(a[aStart]);
      if (index != null) {
        if (bStart < index && index < bEnd) {
          let i = aStart, sequence = 1, t;
          while (++i < aEnd && i < bEnd) {
            if ((t = map.get(a[i])) == null || t !== index + sequence) break;
            sequence++;
          }
          if (sequence > index - bStart) {
            const node = a[aStart];
            while (bStart < index) parentNode.insertBefore(b[bStart++], node);
          } else parentNode.replaceChild(b[bStart++], a[aStart++]);
        } else aStart++;
      } else a[aStart++].remove();
    }
  }
}
const $$EVENTS = "_$DX_DELEGATE";
function render(code, element, init, options = {}) {
  let disposer;
  createRoot((dispose2) => {
    disposer = dispose2;
    element === document ? code() : insert(element, code(), element.firstChild ? null : void 0, init);
  }, options.owner);
  return () => {
    disposer();
    element.textContent = "";
  };
}
function template(html, isImportNode, isSVG, isMathML) {
  let node;
  const create = () => {
    const t = isMathML ? document.createElementNS("http://www.w3.org/1998/Math/MathML", "template") : document.createElement("template");
    t.innerHTML = html;
    return isSVG ? t.content.firstChild.firstChild : isMathML ? t.firstChild : t.content.firstChild;
  };
  const fn = isImportNode ? () => untrack(() => document.importNode(node || (node = create()), true)) : () => (node || (node = create())).cloneNode(true);
  fn.cloneNode = fn;
  return fn;
}
function delegateEvents(eventNames, document2 = window.document) {
  const e = document2[$$EVENTS] || (document2[$$EVENTS] = /* @__PURE__ */ new Set());
  for (let i = 0, l = eventNames.length; i < l; i++) {
    const name = eventNames[i];
    if (!e.has(name)) {
      e.add(name);
      document2.addEventListener(name, eventHandler);
    }
  }
}
function setAttribute(node, name, value) {
  if (value == null) node.removeAttribute(name);
  else node.setAttribute(name, value);
}
function className(node, value) {
  if (value == null) node.removeAttribute("class");
  else node.className = value;
}
function setStyleProperty(node, name, value) {
  value != null ? node.style.setProperty(name, value) : node.style.removeProperty(name);
}
function insert(parent, accessor, marker, initial) {
  if (marker !== void 0 && !initial) initial = [];
  if (typeof accessor !== "function") return insertExpression(parent, accessor, initial, marker);
  createRenderEffect((current) => insertExpression(parent, accessor(), current, marker), initial);
}
function eventHandler(e) {
  let node = e.target;
  const key = `$$${e.type}`;
  const oriTarget = e.target;
  const oriCurrentTarget = e.currentTarget;
  const retarget = (value) => Object.defineProperty(e, "target", {
    configurable: true,
    value
  });
  const handleNode = () => {
    const handler = node[key];
    if (handler && !node.disabled) {
      const data = node[`${key}Data`];
      data !== void 0 ? handler.call(node, data, e) : handler.call(node, e);
      if (e.cancelBubble) return;
    }
    node.host && typeof node.host !== "string" && !node.host._$host && node.contains(e.target) && retarget(node.host);
    return true;
  };
  const walkUpTree = () => {
    while (handleNode() && (node = node._$host || node.parentNode || node.host)) ;
  };
  Object.defineProperty(e, "currentTarget", {
    configurable: true,
    get() {
      return node || document;
    }
  });
  if (e.composedPath) {
    const path = e.composedPath();
    retarget(path[0]);
    for (let i = 0; i < path.length - 2; i++) {
      node = path[i];
      if (!handleNode()) break;
      if (node._$host) {
        node = node._$host;
        walkUpTree();
        break;
      }
      if (node.parentNode === oriCurrentTarget) {
        break;
      }
    }
  } else walkUpTree();
  retarget(oriTarget);
}
function insertExpression(parent, value, current, marker, unwrapArray) {
  while (typeof current === "function") current = current();
  if (value === current) return current;
  const t = typeof value, multi = marker !== void 0;
  parent = multi && current[0] && current[0].parentNode || parent;
  if (t === "string" || t === "number") {
    if (t === "number") {
      value = value.toString();
      if (value === current) return current;
    }
    if (multi) {
      let node = current[0];
      if (node && node.nodeType === 3) {
        node.data !== value && (node.data = value);
      } else node = document.createTextNode(value);
      current = cleanChildren(parent, current, marker, node);
    } else {
      if (current !== "" && typeof current === "string") {
        current = parent.firstChild.data = value;
      } else current = parent.textContent = value;
    }
  } else if (value == null || t === "boolean") {
    current = cleanChildren(parent, current, marker);
  } else if (t === "function") {
    createRenderEffect(() => {
      let v = value();
      while (typeof v === "function") v = v();
      current = insertExpression(parent, v, current, marker);
    });
    return () => current;
  } else if (Array.isArray(value)) {
    const array = [];
    const currentArray = current && Array.isArray(current);
    if (normalizeIncomingArray(array, value, current, unwrapArray)) {
      createRenderEffect(() => current = insertExpression(parent, array, current, marker, true));
      return () => current;
    }
    if (array.length === 0) {
      current = cleanChildren(parent, current, marker);
      if (multi) return current;
    } else if (currentArray) {
      if (current.length === 0) {
        appendNodes(parent, array, marker);
      } else reconcileArrays(parent, current, array);
    } else {
      current && cleanChildren(parent);
      appendNodes(parent, array);
    }
    current = array;
  } else if (value.nodeType) {
    if (Array.isArray(current)) {
      if (multi) return current = cleanChildren(parent, current, marker, value);
      cleanChildren(parent, current, null, value);
    } else if (current == null || current === "" || !parent.firstChild) {
      parent.appendChild(value);
    } else parent.replaceChild(value, parent.firstChild);
    current = value;
  } else ;
  return current;
}
function normalizeIncomingArray(normalized, array, current, unwrap) {
  let dynamic = false;
  for (let i = 0, len = array.length; i < len; i++) {
    let item = array[i], prev = current && current[normalized.length], t;
    if (item == null || item === true || item === false) ;
    else if ((t = typeof item) === "object" && item.nodeType) {
      normalized.push(item);
    } else if (Array.isArray(item)) {
      dynamic = normalizeIncomingArray(normalized, item, prev) || dynamic;
    } else if (t === "function") {
      if (unwrap) {
        while (typeof item === "function") item = item();
        dynamic = normalizeIncomingArray(normalized, Array.isArray(item) ? item : [item], Array.isArray(prev) ? prev : [prev]) || dynamic;
      } else {
        normalized.push(item);
        dynamic = true;
      }
    } else {
      const value = String(item);
      if (prev && prev.nodeType === 3 && prev.data === value) normalized.push(prev);
      else normalized.push(document.createTextNode(value));
    }
  }
  return dynamic;
}
function appendNodes(parent, array, marker = null) {
  for (let i = 0, len = array.length; i < len; i++) parent.insertBefore(array[i], marker);
}
function cleanChildren(parent, current, marker, replacement) {
  if (marker === void 0) return parent.textContent = "";
  const node = replacement || document.createTextNode("");
  if (current.length) {
    let inserted = false;
    for (let i = current.length - 1; i >= 0; i--) {
      const el = current[i];
      if (node !== el) {
        const isParent = el.parentNode === parent;
        if (!inserted && !i) isParent ? parent.replaceChild(node, el) : parent.insertBefore(node, marker);
        else isParent && el.remove();
      } else inserted = true;
    }
  } else parent.insertBefore(node, marker);
  return [node];
}
class MafwClient {
  baseUrl;
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }
  async request(path, init) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...init
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return res.json();
  }
  // ── Projects ──
  async listProjects() {
    const data = await this.request("/api/projects");
    return data.projects || [];
  }
  async getCurrentProject() {
    const data = await this.request("/api/projects/current");
    return data?.project || null;
  }
  async registerProject(projectDir) {
    await this.request("/register", {
      method: "POST",
      body: JSON.stringify({ projectDir, mafwDir: projectDir + "/.mafw" })
    });
  }
  // ── Sessions ──
  async listSessions(projectID) {
    const query = projectID ? `?projectID=${encodeURIComponent(projectID)}` : "";
    const data = await this.request(`/api/sessions${query}`);
    return data.sessions || [];
  }
  async getSession(id) {
    try {
      return await this.request(`/api/sessions/${id}`);
    } catch {
      return null;
    }
  }
  // ── Goals ──
  async getGoals() {
    const data = await this.request("/api/goals");
    return data.goals || [];
  }
  async getGoalDetail(goalId) {
    try {
      return await this.request(`/api/goals/${goalId}`);
    } catch {
      return null;
    }
  }
  // ── Memory ──
  async searchMemory(query) {
    const data = await this.request(`/api/memory/search?q=${encodeURIComponent(query)}`);
    return data.results || [];
  }
  // ── Chat ──
  async sendChatMessage(message) {
    return fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message })
    });
  }
  // ── Config ──
  async getConfig() {
    return this.request("/api/config");
  }
  async saveConfig(config) {
    await fetch(`${this.baseUrl}/api/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config)
    });
  }
  // ── Automations ──
  async getAutomations() {
    const data = await this.request("/api/automations");
    return data.rules || [];
  }
}
const GatewayContext = createContext();
function GatewayProvider(props) {
  const [connected, setConnected] = createSignal(false);
  const [client2, setClient] = createSignal(null);
  createEffect(() => {
    window.mafwAPI.getPort().then((port) => {
      setClient(new MafwClient(`http://localhost:${port}`));
    });
  });
  createEffect(() => {
    const unsub = window.mafwAPI.onHealth((ok) => setConnected(ok));
    window.mafwAPI.healthCheck().then(setConnected);
    onCleanup(unsub);
  });
  return createComponent(GatewayContext.Provider, {
    value: {
      ready: () => client2() !== null,
      connected,
      client: () => client2()
    },
    get children() {
      return props.children;
    }
  });
}
function useGateway() {
  const ctx = useContext(GatewayContext);
  if (!ctx) throw new Error("useGateway() must be used within GatewayProvider");
  return ctx;
}
function useSidebar() {
  const gw = useGateway();
  const [projects, setProjects] = createSignal([]);
  const [currentProject, setCurrentProject] = createSignal(null);
  const [sessions, setSessions] = createSignal([]);
  let fetching = false;
  const fetchProjects = async () => {
    if (!gw.ready()) return;
    try {
      const list = await gw.client().listProjects();
      setProjects(list);
      const cur = await gw.client().getCurrentProject();
      setCurrentProject(cur);
    } catch {
    }
  };
  const fetchSessions = async (projectID) => {
    if (!gw.ready()) return;
    try {
      const list = await gw.client().listSessions(projectID);
      setSessions(list);
    } catch {
    }
  };
  createEffect(() => {
    if (!gw.ready() || fetching) return;
    fetching = true;
    fetchProjects();
  });
  createEffect(() => {
    const pid = currentProject()?.id;
    if (pid) fetchSessions(pid);
    else fetchSessions();
  });
  const selectProject = async (project) => {
    setCurrentProject(project);
    try {
      await gw.client().registerProject(project.worktree);
    } catch {
    }
    fetchSessions(project.id);
  };
  return { projects, currentProject, sessions, selectProject };
}
var _tmpl$$6 = /* @__PURE__ */ template(`<div><h2 class="text-13 font-medium mb-5"style=color:var(--text-strong)>Dashboard</h2><div class="grid grid-cols-4 gap-3 mb-6"></div><div class=space-y-1>`), _tmpl$2$6 = /* @__PURE__ */ template(`<div class=kpi-card><div class="text-lg font-semibold"style=color:var(--text-strong);font-variant-numeric:tabular-nums></div><div class="text-11 mt-0.5"style=color:var(--text-muted)>`), _tmpl$3$6 = /* @__PURE__ */ template(`<div class=text-13 style=color:var(--text-muted)>Loading...`), _tmpl$4$4 = /* @__PURE__ */ template(`<div class=text-13 style=color:var(--text-muted)>No goals yet`), _tmpl$5$3 = /* @__PURE__ */ template(`<div class="goal-row flex items-center justify-between"><div><div class="text-13 font-medium"style=color:var(--text-strong)></div><div class="text-11 mt-0.5"style=color:var(--text-muted)>Wave <!>/<!> · Loop </div></div><div class="flex items-center gap-3"><span class=badge style="border:0.5px solid rgba(255,255,255,0.08)"></span><span class=text-11 style=color:var(--text-muted)>`);
function DashboardPage() {
  const gw = useGateway();
  const [goals, setGoals] = createSignal([]);
  const [loading, setLoading] = createSignal(true);
  createEffect(() => {
    const fetch2 = async () => {
      if (!gw.ready()) return;
      setLoading(true);
      const list = await gw.client().getGoals();
      setGoals(list);
      setLoading(false);
    };
    fetch2();
    const interval = setInterval(fetch2, 15e3);
    return () => clearInterval(interval);
  });
  return (() => {
    var _el$ = _tmpl$$6(), _el$2 = _el$.firstChild, _el$3 = _el$2.nextSibling, _el$4 = _el$3.nextSibling;
    insert(_el$3, () => [{
      label: "Total Goals",
      value: goals().length
    }, {
      label: "Active",
      value: goals().filter((g) => g.phase !== "COMPLETED" && g.phase !== "FAILED").length
    }, {
      label: "Completed",
      value: goals().filter((g) => g.phase === "COMPLETED").length
    }, {
      label: "Total Loops",
      value: goals().reduce((s, g) => s + g.loop, 0)
    }].map((kpi) => (() => {
      var _el$5 = _tmpl$2$6(), _el$6 = _el$5.firstChild, _el$7 = _el$6.nextSibling;
      insert(_el$6, () => kpi.value);
      insert(_el$7, () => kpi.label);
      return _el$5;
    })()));
    insert(_el$4, (() => {
      var _c$ = memo(() => !!loading());
      return () => _c$() ? _tmpl$3$6() : memo(() => goals().length === 0)() ? _tmpl$4$4() : goals().map((g) => (() => {
        var _el$0 = _tmpl$5$3(), _el$1 = _el$0.firstChild, _el$10 = _el$1.firstChild, _el$11 = _el$10.nextSibling, _el$12 = _el$11.firstChild, _el$15 = _el$12.nextSibling, _el$13 = _el$15.nextSibling, _el$16 = _el$13.nextSibling;
        _el$16.nextSibling;
        var _el$17 = _el$1.nextSibling, _el$18 = _el$17.firstChild, _el$19 = _el$18.nextSibling;
        insert(_el$10, () => g.goalId);
        insert(_el$11, () => g.currentWave, _el$15);
        insert(_el$11, () => g.totalWaves, _el$16);
        insert(_el$11, () => g.loop, null);
        insert(_el$18, () => g.phase);
        insert(_el$19, (() => {
          var _c$2 = memo(() => !!g.updatedAt);
          return () => _c$2() ? new Date(g.updatedAt).toLocaleString() : "";
        })());
        createRenderEffect((_p$) => {
          var _v$ = g.phase === "COMPLETED" || g.phase === "ARCHIVED" ? "var(--success-bg)" : g.phase === "FAILED" ? "var(--danger-bg)" : "var(--accent-bg)", _v$2 = g.phase === "COMPLETED" || g.phase === "ARCHIVED" ? "var(--success)" : g.phase === "FAILED" ? "var(--danger)" : "var(--accent)";
          _v$ !== _p$.e && setStyleProperty(_el$18, "background", _p$.e = _v$);
          _v$2 !== _p$.t && setStyleProperty(_el$18, "color", _p$.t = _v$2);
          return _p$;
        }, {
          e: void 0,
          t: void 0
        });
        return _el$0;
      })());
    })());
    return _el$;
  })();
}
var _tmpl$$5 = /* @__PURE__ */ template(`<div><h2 class="text-13 font-medium mb-5"style=color:var(--text-strong)>Memory</h2><div class="flex gap-2 mb-5"><input type=text placeholder="Search memories..."class="input-base flex-1 h-7 px-2.5 text-13"><button class="btn btn-primary"></button></div><div class=space-y-1.5>`), _tmpl$2$5 = /* @__PURE__ */ template(`<div class=memory-card><div class="flex items-center justify-between mb-1.5"><div class="text-13 font-medium truncate mr-3"style=color:var(--text-strong)></div><div class="flex items-center gap-2 shrink-0"><span class=badge style="border:0.5px solid rgba(255,255,255,0.08)"></span><span class=text-11 style=color:var(--text-muted)></span></div></div><div class="text-13 leading-5 line-clamp-2"style=color:var(--text-muted)>`), _tmpl$3$5 = /* @__PURE__ */ template(`<div class=text-13 style=color:var(--text-muted)>No memories found`);
function MemoryPage() {
  const gw = useGateway();
  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal([]);
  const [searching, setSearching] = createSignal(false);
  async function handleSearch() {
    if (!query().trim() || !gw.ready()) return;
    setSearching(true);
    const items = await gw.client().searchMemory(query());
    setResults(items);
    setSearching(false);
  }
  return (() => {
    var _el$ = _tmpl$$5(), _el$2 = _el$.firstChild, _el$3 = _el$2.nextSibling, _el$4 = _el$3.firstChild, _el$5 = _el$4.nextSibling, _el$6 = _el$3.nextSibling;
    _el$4.$$keydown = (e) => e.key === "Enter" && handleSearch();
    _el$4.$$input = (e) => setQuery(e.currentTarget.value);
    _el$5.$$click = handleSearch;
    insert(_el$5, () => searching() ? "Searching..." : "Search");
    insert(_el$6, () => results().map((unit) => (() => {
      var _el$7 = _tmpl$2$5(), _el$8 = _el$7.firstChild, _el$9 = _el$8.firstChild, _el$0 = _el$9.nextSibling, _el$1 = _el$0.firstChild, _el$10 = _el$1.nextSibling, _el$11 = _el$8.nextSibling;
      insert(_el$9, () => unit.primary_abstraction);
      insert(_el$1, () => unit.type);
      insert(_el$10, () => unit.energy);
      insert(_el$11, () => unit.memory_value);
      createRenderEffect((_p$) => {
        var _v$ = unit.type === "semantic" ? "var(--accent-bg)" : unit.type === "episodic" ? "var(--success-bg)" : "rgba(168,85,247,0.15)", _v$2 = unit.type === "semantic" ? "var(--accent)" : unit.type === "episodic" ? "var(--success)" : "#a855f7";
        _v$ !== _p$.e && setStyleProperty(_el$1, "background", _p$.e = _v$);
        _v$2 !== _p$.t && setStyleProperty(_el$1, "color", _p$.t = _v$2);
        return _p$;
      }, {
        e: void 0,
        t: void 0
      });
      return _el$7;
    })()), null);
    insert(_el$6, (() => {
      var _c$ = memo(() => !!(results().length === 0 && query() && !searching()));
      return () => _c$() && _tmpl$3$5();
    })(), null);
    createRenderEffect(() => _el$5.disabled = searching());
    createRenderEffect(() => _el$4.value = query());
    return _el$;
  })();
}
delegateEvents(["input", "keydown", "click"]);
function useGatewaySSE(baseUrl) {
  const [connected, setConnected] = createSignal(false);
  const [activeNodeId, setActiveNodeId] = createSignal(null);
  const [currentPhase, setCurrentPhase] = createSignal(null);
  const [lastMessage, setLastMessage] = createSignal("");
  let eventSource = null;
  function connect() {
    if (eventSource) eventSource.close();
    eventSource = new EventSource(`${baseUrl}/api/events`);
    eventSource.onopen = () => setConnected(true);
    eventSource.onerror = () => {
      setConnected(false);
      eventSource?.close();
      setTimeout(connect, 3e3);
    };
    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.activeNodeId) setActiveNodeId(data.activeNodeId);
        if (data.phase) setCurrentPhase(data.phase);
        if (data.content) setLastMessage(data.content);
        if (data.message) setLastMessage(data.message);
      } catch {
      }
    };
  }
  function disconnect() {
    eventSource?.close();
    eventSource = null;
    setConnected(false);
  }
  onCleanup(() => disconnect());
  return { connected, activeNodeId, currentPhase, lastMessage, connect, disconnect };
}
var _tmpl$$4 = /* @__PURE__ */ template(`<div><h2 class="text-13 font-medium mb-4"style=color:var(--text-strong)>Execution Graph</h2><div class="flex items-center gap-3 mb-4"><div class="flex items-center gap-1.5"><span class=status-dot></span><span class=text-11 style=color:var(--text-muted)></span></div></div><div class="panel p-4"><svg viewBox="0 0 500 450"class="w-full h-auto"style=min-height:380px><defs><marker id=arrow viewBox="0 0 10 10"refX=10 refY=5 markerWidth=7 markerHeight=7 orient=auto><path d="M 0 0 L 10 5 L 0 10 Z"fill=rgba(255,255,255,0.25)></path></marker></defs></svg></div><div class="panel p-3 mt-3 space-y-1"><div class=text-11 style=color:var(--text-muted)>Current Phase: <span style=color:var(--text-strong)></span></div><div class=text-11 style=color:var(--text-muted)>Active Node: <span style=color:var(--text-strong)></span></div><div class=text-11 style=color:var(--text-muted)>Last Event: <span style=color:var(--text-strong)>`), _tmpl$2$4 = /* @__PURE__ */ template(`<svg><g><path fill=none stroke-width=1.5 opacity=0.5 marker-end=url(#arrow)></svg>`, false, true, false), _tmpl$3$4 = /* @__PURE__ */ template(`<svg><text font-size=10 text-anchor=middle opacity=0.7></svg>`, false, true, false), _tmpl$4$3 = /* @__PURE__ */ template(`<svg><g><rect width=80 height=36 rx=6></rect><circle r=3></circle><text font-size=11 text-anchor=middle font-weight=500></svg>`, false, true, false), _tmpl$5$2 = /* @__PURE__ */ template(`<svg><circle r=34 opacity=0.1><animate attributeName=r values=34;40;34 dur=2s repeatCount=indefinite></svg>`, false, true, false);
const NODES = ["PLAN", "EXECUTE", "REVIEW", "ARCHIVE_SUCCESS", "ARCHIVE_FAIL", "ARCHIVE_MAX_RETRIES"];
const LAYOUT = {
  PLAN: {
    x: 250,
    y: 30
  },
  EXECUTE: {
    x: 250,
    y: 140
  },
  REVIEW: {
    x: 250,
    y: 250
  },
  ARCHIVE_SUCCESS: {
    x: 80,
    y: 380
  },
  ARCHIVE_FAIL: {
    x: 250,
    y: 380
  },
  ARCHIVE_MAX_RETRIES: {
    x: 420,
    y: 380
  }
};
const COLORS = {
  PLAN: "#7698fd",
  EXECUTE: "#a855f7",
  REVIEW: "#e8b84b",
  ARCHIVE_SUCCESS: "#2bc94a",
  ARCHIVE_FAIL: "#e8636b",
  ARCHIVE_MAX_RETRIES: "#e8636b"
};
const EDGES = [{
  from: "PLAN",
  to: "EXECUTE",
  color: "#7698fd"
}, {
  from: "EXECUTE",
  to: "REVIEW",
  color: "#7698fd"
}, {
  from: "REVIEW",
  to: "ARCHIVE_SUCCESS",
  color: "#2bc94a",
  label: "PASS"
}, {
  from: "REVIEW",
  to: "ARCHIVE_FAIL",
  color: "#e8636b",
  label: "ERROR"
}, {
  from: "REVIEW",
  to: "PLAN",
  color: "#e8b84b",
  label: "FAIL (retry)"
}, {
  from: "REVIEW",
  to: "ARCHIVE_MAX_RETRIES",
  color: "#e8636b",
  label: "max"
}];
function GraphPage() {
  const gw = useGateway();
  const sse = useGatewaySSE(gw.client().baseUrl);
  const [statuses, setStatuses] = createSignal({});
  createEffect(() => {
    const activeId = sse.activeNodeId();
    if (!activeId) return;
    const next = {};
    const idx = NODES.indexOf(activeId);
    for (const id of NODES) {
      const i = NODES.indexOf(id);
      next[id] = id === activeId ? "running" : i < idx ? "done" : "idle";
    }
    setStatuses(next);
  });
  createEffect(() => {
    sse.connect();
  });
  return (() => {
    var _el$ = _tmpl$$4(), _el$2 = _el$.firstChild, _el$3 = _el$2.nextSibling, _el$4 = _el$3.firstChild, _el$5 = _el$4.firstChild, _el$6 = _el$5.nextSibling, _el$7 = _el$3.nextSibling, _el$8 = _el$7.firstChild;
    _el$8.firstChild;
    var _el$0 = _el$7.nextSibling, _el$1 = _el$0.firstChild, _el$10 = _el$1.firstChild, _el$11 = _el$10.nextSibling, _el$12 = _el$1.nextSibling, _el$13 = _el$12.firstChild, _el$14 = _el$13.nextSibling, _el$15 = _el$12.nextSibling, _el$16 = _el$15.firstChild, _el$17 = _el$16.nextSibling;
    insert(_el$6, () => sse.connected() ? "SSE Connected" : "SSE Disconnected");
    insert(_el$8, createComponent(For, {
      each: EDGES,
      children: (edge) => {
        const f = LAYOUT[edge.from], t = LAYOUT[edge.to];
        const midY = (f.y + t.y) / 2;
        const d = edge.from === "REVIEW" && edge.to === "PLAN" ? `M ${f.x} ${f.y + 30} C ${f.x + 80} ${midY}, ${f.x + 80} ${midY}, ${t.x} ${t.y - 30}` : `M ${f.x} ${f.y + 30} L ${t.x} ${t.y - 30}`;
        return (() => {
          var _el$18 = _tmpl$2$4(), _el$19 = _el$18.firstChild;
          setAttribute(_el$19, "d", d);
          insert(_el$18, (() => {
            var _c$ = memo(() => !!edge.label);
            return () => _c$() && (() => {
              var _el$20 = _tmpl$3$4();
              setAttribute(_el$20, "y", midY - 8);
              insert(_el$20, () => edge.label);
              createRenderEffect((_p$) => {
                var _v$3 = (f.x + t.x) / 2, _v$4 = edge.color;
                _v$3 !== _p$.e && setAttribute(_el$20, "x", _p$.e = _v$3);
                _v$4 !== _p$.t && setAttribute(_el$20, "fill", _p$.t = _v$4);
                return _p$;
              }, {
                e: void 0,
                t: void 0
              });
              return _el$20;
            })();
          })(), null);
          createRenderEffect(() => setAttribute(_el$19, "stroke", edge.color));
          return _el$18;
        })();
      }
    }), null);
    insert(_el$8, createComponent(For, {
      each: NODES,
      children: (id) => {
        const p = LAYOUT[id], c = COLORS[id];
        const st = statuses()[id] || "idle";
        const isRun = st === "running";
        return (() => {
          var _el$21 = _tmpl$4$3(), _el$22 = _el$21.firstChild, _el$23 = _el$22.nextSibling, _el$24 = _el$23.nextSibling;
          insert(_el$21, isRun && (() => {
            var _el$25 = _tmpl$5$2();
            setAttribute(_el$25, "fill", c);
            createRenderEffect((_p$) => {
              var _v$1 = p.x, _v$10 = p.y;
              _v$1 !== _p$.e && setAttribute(_el$25, "cx", _p$.e = _v$1);
              _v$10 !== _p$.t && setAttribute(_el$25, "cy", _p$.t = _v$10);
              return _p$;
            }, {
              e: void 0,
              t: void 0
            });
            return _el$25;
          })(), _el$22);
          setAttribute(_el$22, "fill", isRun ? `${c}18` : "var(--bg-layer-02)");
          setAttribute(_el$22, "stroke", isRun ? c : "rgba(255,255,255,0.06)");
          setAttribute(_el$22, "stroke-width", isRun ? 1.5 : 0.5);
          setAttribute(_el$23, "fill", isRun ? c : st === "done" ? "#2bc94a" : "rgba(255,255,255,0.15)");
          setAttribute(_el$24, "fill", isRun ? c : st === "done" ? "rgba(255,255,255,0.6)" : "var(--text-muted)");
          insert(_el$24, () => id === "ARCHIVE_SUCCESS" ? "Success" : id === "ARCHIVE_FAIL" ? "Fail" : id === "ARCHIVE_MAX_RETRIES" ? "Max Retries" : id.charAt(0) + id.slice(1).toLowerCase());
          createRenderEffect((_p$) => {
            var _v$5 = p.x - 40, _v$6 = p.y - 18, _v$7 = p.x - 32, _v$8 = p.y, _v$9 = p.x, _v$0 = p.y + 4;
            _v$5 !== _p$.e && setAttribute(_el$22, "x", _p$.e = _v$5);
            _v$6 !== _p$.t && setAttribute(_el$22, "y", _p$.t = _v$6);
            _v$7 !== _p$.a && setAttribute(_el$23, "cx", _p$.a = _v$7);
            _v$8 !== _p$.o && setAttribute(_el$23, "cy", _p$.o = _v$8);
            _v$9 !== _p$.i && setAttribute(_el$24, "x", _p$.i = _v$9);
            _v$0 !== _p$.n && setAttribute(_el$24, "y", _p$.n = _v$0);
            return _p$;
          }, {
            e: void 0,
            t: void 0,
            a: void 0,
            o: void 0,
            i: void 0,
            n: void 0
          });
          return _el$21;
        })();
      }
    }), null);
    insert(_el$11, () => sse.currentPhase() || "-");
    insert(_el$14, () => sse.activeNodeId() || "-");
    insert(_el$17, () => sse.lastMessage().slice(0, 80) || "-");
    createRenderEffect((_p$) => {
      var _v$ = !!sse.connected(), _v$2 = !sse.connected();
      _v$ !== _p$.e && _el$5.classList.toggle("bg-success", _p$.e = _v$);
      _v$2 !== _p$.t && _el$5.classList.toggle("bg-danger", _p$.t = _v$2);
      return _p$;
    }, {
      e: void 0,
      t: void 0
    });
    return _el$;
  })();
}
var _tmpl$$3 = /* @__PURE__ */ template(`<div class="flex flex-col h-full"><h2 class="text-13 font-medium mb-4 shrink-0"style=color:var(--text-strong)>Chat</h2><div class="flex-1 overflow-auto space-y-3 mb-3 pr-2"></div><div class="flex gap-2 shrink-0"><input type=text placeholder="Type a message..."class="input-base flex-1 h-7 px-2.5 text-13"><button class="btn btn-primary">Send</button></div><style>@keyframes blink { 0%,100% { opacity: 0.3 } 50% { opacity: 1 } }`), _tmpl$2$3 = /* @__PURE__ */ template(`<div><div class="max-w-[70%] rounded-lg px-3.5 py-2 text-13 leading-5">`), _tmpl$3$3 = /* @__PURE__ */ template(`<div class="flex justify-start"><div class="rounded-lg px-3.5 py-2"style="background:var(--bg-layer-01);border:0.5px solid var(--border-base)"><div class="flex gap-1"><div class="w-1.5 h-1.5 rounded-full"style="background:var(--text-muted);animation:blink 1s infinite"></div><div class="w-1.5 h-1.5 rounded-full"style="background:var(--text-muted);animation:blink 1s infinite 0.2s"></div><div class="w-1.5 h-1.5 rounded-full"style="background:var(--text-muted);animation:blink 1s infinite 0.4s">`);
function ChatPage() {
  const gw = useGateway();
  const [messages, setMessages] = createSignal([{
    role: "assistant",
    content: "Hello! I can help manage your MAFW goals.",
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  }]);
  const [input, setInput] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  async function sendMessage() {
    const text = input();
    if (!text.trim() || loading()) return;
    setMessages((prev) => [...prev, {
      role: "user",
      content: text,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    }]);
    setInput("");
    setLoading(true);
    try {
      const res = await gw.client().sendChatMessage(text);
      if (res.ok && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let content = "";
        setMessages((prev) => [...prev, {
          role: "assistant",
          content: "",
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        }]);
        while (true) {
          const {
            done,
            value
          } = await reader.read();
          if (done) break;
          const lines = decoder.decode(value, {
            stream: true
          }).split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === "text" && data.content) content += data.content;
                setMessages((prev) => {
                  const next = [...prev];
                  const last = {
                    ...next[next.length - 1],
                    content
                  };
                  next[next.length - 1] = last;
                  return next;
                });
              } catch {
              }
            }
          }
        }
      }
    } catch (err) {
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: `Error: ${err.message}`,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      }]);
    } finally {
      setLoading(false);
    }
  }
  return (() => {
    var _el$ = _tmpl$$3(), _el$2 = _el$.firstChild, _el$3 = _el$2.nextSibling, _el$4 = _el$3.nextSibling, _el$5 = _el$4.firstChild, _el$6 = _el$5.nextSibling;
    insert(_el$3, () => messages().map((msg, i) => (() => {
      var _el$7 = _tmpl$2$3(), _el$8 = _el$7.firstChild;
      insert(_el$8, () => msg.content);
      createRenderEffect((_p$) => {
        var _v$3 = `flex ${msg.role === "user" ? "justify-end" : "justify-start"}`, _v$4 = msg.role === "user" ? "var(--accent-bg)" : "var(--bg-layer-01)", _v$5 = msg.role === "user" ? "0.5px solid rgba(118,152,253,0.2)" : "0.5px solid var(--border-base)", _v$6 = msg.role === "user" ? "var(--text-strong)" : "var(--text-base)";
        _v$3 !== _p$.e && className(_el$7, _p$.e = _v$3);
        _v$4 !== _p$.t && setStyleProperty(_el$8, "background", _p$.t = _v$4);
        _v$5 !== _p$.a && setStyleProperty(_el$8, "border", _p$.a = _v$5);
        _v$6 !== _p$.o && setStyleProperty(_el$8, "color", _p$.o = _v$6);
        return _p$;
      }, {
        e: void 0,
        t: void 0,
        a: void 0,
        o: void 0
      });
      return _el$7;
    })()), null);
    insert(_el$3, (() => {
      var _c$ = memo(() => !!loading());
      return () => _c$() && _tmpl$3$3();
    })(), null);
    _el$5.$$keydown = (e) => e.key === "Enter" && sendMessage();
    _el$5.$$input = (e) => setInput(e.currentTarget.value);
    _el$6.$$click = sendMessage;
    createRenderEffect((_p$) => {
      var _v$ = loading(), _v$2 = loading() || !input().trim();
      _v$ !== _p$.e && (_el$5.disabled = _p$.e = _v$);
      _v$2 !== _p$.t && (_el$6.disabled = _p$.t = _v$2);
      return _p$;
    }, {
      e: void 0,
      t: void 0
    });
    createRenderEffect(() => _el$5.value = input());
    return _el$;
  })();
}
delegateEvents(["input", "keydown", "click"]);
var _tmpl$$2 = /* @__PURE__ */ template(`<div><h2 class="text-13 font-medium mb-5"style=color:var(--text-strong)>Configuration`), _tmpl$2$2 = /* @__PURE__ */ template(`<div class=text-13 style=color:var(--text-muted)>Loading...`), _tmpl$3$2 = /* @__PURE__ */ template(`<textarea class="input-base w-full min-h-[60vh] p-3 text-13 font-mono leading-5 resize-none">`), _tmpl$4$2 = /* @__PURE__ */ template(`<div class="flex gap-2 mt-3"><button class="btn btn-primary">Save</button><button class="btn btn-secondary">Reset`);
function ConfigPage() {
  const gw = useGateway();
  const [config, setConfig] = createSignal("");
  const [loading, setLoading] = createSignal(true);
  createEffect(() => {
    if (!gw.ready()) return;
    gw.client().getConfig().then((data) => {
      setConfig(JSON.stringify(data, null, 2));
      setLoading(false);
    });
  });
  async function handleSave() {
    try {
      await gw.client().saveConfig(JSON.parse(config()));
    } catch {
    }
  }
  return (() => {
    var _el$ = _tmpl$$2();
    _el$.firstChild;
    insert(_el$, (() => {
      var _c$ = memo(() => !!loading());
      return () => _c$() ? _tmpl$2$2() : [(() => {
        var _el$4 = _tmpl$3$2();
        _el$4.$$input = (e) => setConfig(e.currentTarget.value);
        setAttribute(_el$4, "spellcheck", false);
        createRenderEffect(() => _el$4.value = config());
        return _el$4;
      })(), (() => {
        var _el$5 = _tmpl$4$2(), _el$6 = _el$5.firstChild, _el$7 = _el$6.nextSibling;
        _el$6.$$click = handleSave;
        _el$7.$$click = () => client.getConfig().then((d) => setConfig(JSON.stringify(d, null, 2)));
        return _el$5;
      })()];
    })(), null);
    return _el$;
  })();
}
delegateEvents(["input", "click"]);
var _tmpl$$1 = /* @__PURE__ */ template(`<div><h2 class="text-13 font-medium mb-5"style=color:var(--text-strong)>Automations`), _tmpl$2$1 = /* @__PURE__ */ template(`<div class=text-13 style=color:var(--text-muted)>Loading...`), _tmpl$3$1 = /* @__PURE__ */ template(`<div class=text-13 style=color:var(--text-muted)>No automation rules configured`), _tmpl$4$1 = /* @__PURE__ */ template(`<div class=space-y-1.5>`), _tmpl$5$1 = /* @__PURE__ */ template(`<div class=memory-card><div class="flex items-center justify-between mb-1.5"><div class="text-13 font-medium"style=color:var(--text-strong)></div><span class=badge style="border:0.5px solid rgba(255,255,255,0.08)"></span></div><div class="text-11 space-y-0.5"style=color:var(--text-muted)><div>Schedule: <span style=color:var(--text-base)></span></div><div>Action: <span style=color:var(--text-base)>`);
function AutomationsPage() {
  const gw = useGateway();
  const [rules, setRules] = createSignal([]);
  const [loading, setLoading] = createSignal(true);
  createEffect(() => {
    if (!gw.ready()) return;
    gw.client().getAutomations().then((list) => {
      setRules(list);
      setLoading(false);
    });
  });
  return (() => {
    var _el$ = _tmpl$$1();
    _el$.firstChild;
    insert(_el$, (() => {
      var _c$ = memo(() => !!loading());
      return () => _c$() ? _tmpl$2$1() : memo(() => rules().length === 0)() ? _tmpl$3$1() : (() => {
        var _el$5 = _tmpl$4$1();
        insert(_el$5, () => rules().map((rule) => (() => {
          var _el$6 = _tmpl$5$1(), _el$7 = _el$6.firstChild, _el$8 = _el$7.firstChild, _el$9 = _el$8.nextSibling, _el$0 = _el$7.nextSibling, _el$1 = _el$0.firstChild, _el$10 = _el$1.firstChild, _el$11 = _el$10.nextSibling, _el$12 = _el$1.nextSibling, _el$13 = _el$12.firstChild, _el$14 = _el$13.nextSibling;
          insert(_el$8, () => rule.id);
          insert(_el$9, () => rule.enabled ? "Enabled" : "Disabled");
          insert(_el$11, () => rule.trigger?.schedule || "-");
          insert(_el$14, () => rule.action?.type || rule.skill || "-");
          createRenderEffect((_p$) => {
            var _v$ = rule.enabled ? "var(--success-bg)" : "var(--danger-bg)", _v$2 = rule.enabled ? "var(--success)" : "var(--danger)";
            _v$ !== _p$.e && setStyleProperty(_el$9, "background", _p$.e = _v$);
            _v$2 !== _p$.t && setStyleProperty(_el$9, "color", _p$.t = _v$2);
            return _p$;
          }, {
            e: void 0,
            t: void 0
          });
          return _el$6;
        })()));
        return _el$5;
      })();
    })(), null);
    return _el$;
  })();
}
var _tmpl$ = /* @__PURE__ */ template(`<aside class="w-[240px] flex flex-col shrink-0 border-r"style=border-color:var(--border-base);background:var(--bg-base)><div class="p-2 border-b"style=border-color:var(--border-base)><div class=relative><button class="w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-xs"style=background:var(--bg-raised);color:var(--text-strong)></button></div></div><div class="flex-1 overflow-auto p-2"><div class="text-10 font-medium mb-1 px-1"style=color:var(--text-muted)>Sessions</div></div><div class="flex items-center justify-center py-2 gap-3 border-t"style=border-color:var(--border-base)>`), _tmpl$2 = /* @__PURE__ */ template(`<span class=truncate>`), _tmpl$3 = /* @__PURE__ */ template(`<span class="ml-auto text-10"style=color:var(--text-muted)>▼`), _tmpl$4 = /* @__PURE__ */ template(`<span style=color:var(--text-muted)>No project`), _tmpl$5 = /* @__PURE__ */ template(`<div class="absolute top-full left-0 right-0 mt-1 rounded border z-10 max-h-48 overflow-auto"style=background:var(--bg-raised);border-color:var(--border-base)>`), _tmpl$6 = /* @__PURE__ */ template(`<button class="w-full text-left px-2 py-1.5 text-xs truncate hover:opacity-80"style=color:var(--text-strong)>`), _tmpl$7 = /* @__PURE__ */ template(`<div class="px-2 py-1.5 text-xs"style=color:var(--text-muted)>No projects registered`), _tmpl$8 = /* @__PURE__ */ template(`<div class="px-2 py-1 text-xs truncate rounded hover:opacity-80 cursor-pointer"style=color:var(--text-strong)>`), _tmpl$9 = /* @__PURE__ */ template(`<div class="px-2 py-1 text-xs"style=color:var(--text-muted)>No sessions`), _tmpl$0 = /* @__PURE__ */ template(`<button class="text-xs sidebar-tab-btn"style=color:var(--icon-base)>`), _tmpl$1 = /* @__PURE__ */ template(`<div class="flex h-screen"style=background:var(--bg-deep)><main class="flex-1 flex flex-col min-w-0"><header class="h-9 flex items-center px-3 gap-2 shrink-0 select-none border-b"style=border-color:var(--border-base);background:var(--bg-base)><span class="text-xs font-medium"style=color:var(--text-strong)>MAFW</span><span style=color:var(--text-muted);font-size:12px>/</span><span class=text-xs style=color:var(--icon-base)></span><div class=flex-1></div><div class="flex items-center gap-1.5"><div></div><span class=text-11 style=color:var(--text-muted)></span></div></header><div class="flex-1 overflow-auto"><div class="p-5 max-w-4xl">`), _tmpl$10 = /* @__PURE__ */ template(`<div class="flex items-center justify-center h-40"><div class=text-13 style=color:var(--text-muted)>Connecting to Gateway...`);
const TAB_CONFIG = {
  dashboard: {
    icon: "◉",
    label: "Dashboard"
  },
  memory: {
    icon: "◇",
    label: "Memory"
  },
  graph: {
    icon: "◎",
    label: "Graph"
  },
  chat: {
    icon: "○",
    label: "Chat"
  },
  config: {
    icon: "⚙",
    label: "Config"
  },
  automations: {
    icon: "▶",
    label: "Automations"
  }
};
function SidebarPanel() {
  useGateway();
  const {
    projects,
    currentProject,
    sessions,
    selectProject
  } = useSidebar();
  const [open, setOpen] = createSignal(false);
  return (() => {
    var _el$ = _tmpl$(), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild, _el$4 = _el$3.firstChild, _el$5 = _el$2.nextSibling;
    _el$5.firstChild;
    var _el$7 = _el$5.nextSibling;
    _el$4.$$click = () => setOpen(!open());
    insert(_el$4, (() => {
      var _c$ = memo(() => !!currentProject());
      return () => _c$() ? [(() => {
        var _el$8 = _tmpl$2();
        insert(_el$8, () => currentProject().id.split("/").pop() || currentProject().id);
        return _el$8;
      })(), _tmpl$3()] : _tmpl$4();
    })());
    insert(_el$3, (() => {
      var _c$2 = memo(() => !!open());
      return () => _c$2() && (() => {
        var _el$1 = _tmpl$5();
        insert(_el$1, createComponent(For, {
          get each() {
            return projects();
          },
          children: (p) => (() => {
            var _el$10 = _tmpl$6();
            _el$10.$$click = () => {
              selectProject(p);
              setOpen(false);
            };
            insert(_el$10, () => p.id.split("/").pop() || p.id);
            createRenderEffect(() => _el$10.classList.toggle("font-medium", !!(currentProject()?.id === p.id)));
            return _el$10;
          })()
        }), null);
        insert(_el$1, (() => {
          var _c$4 = memo(() => projects().length === 0);
          return () => _c$4() && _tmpl$7();
        })(), null);
        return _el$1;
      })();
    })(), null);
    insert(_el$5, createComponent(For, {
      get each() {
        return sessions();
      },
      children: (s) => (() => {
        var _el$12 = _tmpl$8();
        insert(_el$12, () => s.title || s.id.slice(0, 8));
        return _el$12;
      })()
    }), null);
    insert(_el$5, (() => {
      var _c$3 = memo(() => sessions().length === 0);
      return () => _c$3() && _tmpl$9();
    })(), null);
    insert(_el$7, () => Object.keys(TAB_CONFIG).map((tab) => (() => {
      var _el$14 = _tmpl$0();
      insert(_el$14, () => TAB_CONFIG[tab].icon);
      createRenderEffect(() => setAttribute(_el$14, "title", TAB_CONFIG[tab].label));
      return _el$14;
    })()));
    return _el$;
  })();
}
function App() {
  const [activeTab] = createSignal("dashboard");
  const gw = useGateway();
  return (() => {
    var _el$15 = _tmpl$1(), _el$16 = _el$15.firstChild, _el$17 = _el$16.firstChild, _el$18 = _el$17.firstChild, _el$19 = _el$18.nextSibling, _el$20 = _el$19.nextSibling, _el$21 = _el$20.nextSibling, _el$22 = _el$21.nextSibling, _el$23 = _el$22.firstChild, _el$24 = _el$23.nextSibling, _el$25 = _el$17.nextSibling, _el$26 = _el$25.firstChild;
    insert(_el$15, createComponent(SidebarPanel, {}), _el$16);
    insert(_el$20, () => TAB_CONFIG[activeTab()].label);
    insert(_el$24, () => gw.connected() ? "Connected" : "Disconnected");
    insert(_el$26, (() => {
      var _c$5 = memo(() => !!gw.ready());
      return () => _c$5() ? createComponent(Switch, {
        get children() {
          return [createComponent(Match, {
            get when() {
              return activeTab() === "dashboard";
            },
            get children() {
              return createComponent(DashboardPage, {});
            }
          }), createComponent(Match, {
            get when() {
              return activeTab() === "memory";
            },
            get children() {
              return createComponent(MemoryPage, {});
            }
          }), createComponent(Match, {
            get when() {
              return activeTab() === "graph";
            },
            get children() {
              return createComponent(GraphPage, {});
            }
          }), createComponent(Match, {
            get when() {
              return activeTab() === "chat";
            },
            get children() {
              return createComponent(ChatPage, {});
            }
          }), createComponent(Match, {
            get when() {
              return activeTab() === "config";
            },
            get children() {
              return createComponent(ConfigPage, {});
            }
          }), createComponent(Match, {
            get when() {
              return activeTab() === "automations";
            },
            get children() {
              return createComponent(AutomationsPage, {});
            }
          })];
        }
      }) : _tmpl$10();
    })());
    createRenderEffect(() => className(_el$23, `status-dot ${gw.connected() ? "bg-success" : "bg-danger"}`));
    return _el$15;
  })();
}
function AppShell() {
  return createComponent(GatewayProvider, {
    get children() {
      return createComponent(App, {});
    }
  });
}
render(() => createComponent(AppShell, {}), document.getElementById("root"));
delegateEvents(["click"]);
