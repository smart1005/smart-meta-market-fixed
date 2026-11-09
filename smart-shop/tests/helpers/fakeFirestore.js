/**
 * Tiny in-memory Firestore + firebase-admin fake used by the test suite.
 * Supports: collection/doc get/set/create/update/delete, where (== > >= < <=),
 * orderBy, limit, startAfter, getAll, batch, runTransaction, and Timestamps.
 * It also records every query so tests can assert which filters were used.
 */
const store = {};
const queries = [];

class Timestamp {
  constructor(date) {
    this._d = date;
  }
  toDate() {
    return this._d;
  }
  toMillis() {
    return this._d.getTime();
  }
  static fromDate(date) {
    return new Timestamp(date);
  }
}

const DELETE = { __delete: true };
const ms = (v) =>
  v instanceof Timestamp ? v.toMillis() : v instanceof Date ? v.getTime() : v;

const col = (name) => (store[name] ||= new Map());

const reset = (seed = {}) => {
  Object.keys(store).forEach((k) => delete store[k]);
  queries.length = 0;
  Object.entries(seed).forEach(([name, docs]) => {
    store[name] = new Map(Object.entries(docs).map(([id, d]) => [id, { ...d }]));
  });
};

const applyUpdate = (existing, data) => {
  const out = { ...existing };
  for (const [k, v] of Object.entries(data)) {
    if (v && v.__delete) delete out[k];
    else out[k] = v;
  }
  return out;
};

const snap = (name, id, d) => ({
  id,
  exists: d !== undefined,
  data: () => (d === undefined ? undefined : { ...d }),
  ref: docRef(name, id),
});

const docRef = (name, id) => ({
  id,
  collection: name,
  async get() {
    return snap(name, id, col(name).get(id));
  },
  async set(data) {
    col(name).set(id, { ...data });
  },
  async create(data) {
    if (col(name).has(id)) {
      const e = new Error("already exists");
      e.code = 6;
      throw e;
    }
    col(name).set(id, { ...data });
  },
  async update(data) {
    if (!col(name).has(id)) {
      const e = new Error("not found");
      e.code = 5;
      throw e;
    }
    col(name).set(id, applyUpdate(col(name).get(id), data));
  },
  async delete() {
    col(name).delete(id);
  },
});

const match = (val, op, target) => {
  if (op === "==") return ms(val) === ms(target);
  if (val === undefined || val === null) return false;
  const a = ms(val);
  const b = ms(target);
  if (op === ">") return a > b;
  if (op === ">=") return a >= b;
  if (op === "<") return a < b;
  if (op === "<=") return a <= b;
  throw new Error(`fake Firestore: unsupported operator ${op}`);
};

const query = (name, state = { wheres: [], order: null, lim: null, after: null }) => ({
  where: (f, op, v) => query(name, { ...state, wheres: [...state.wheres, [f, op, v]] }),
  orderBy: (f, dir = "asc") => query(name, { ...state, order: [f, dir] }),
  limit: (n) => query(name, { ...state, lim: n }),
  startAfter: (s) => query(name, { ...state, after: s.id }),
  async get() {
    queries.push({ collection: name, wheres: state.wheres, order: state.order, limit: state.lim });
    let rows = [...col(name).entries()].filter(([, d]) =>
      state.wheres.every(([f, op, v]) => match(d[f], op, v)),
    );
    if (state.order) {
      const [f, dir] = state.order;
      rows.sort((a, b) => (ms(a[1][f]) > ms(b[1][f]) ? 1 : -1) * (dir === "desc" ? -1 : 1));
    }
    if (state.after) {
      const i = rows.findIndex(([id]) => id === state.after);
      rows = rows.slice(i + 1);
    }
    if (state.lim != null) rows = rows.slice(0, state.lim);
    return {
      docs: rows.map(([id, d]) => snap(name, id, d)),
      size: rows.length,
      empty: rows.length === 0,
    };
  },
});

let autoId = 0;
const db = {
  collection: (name) => ({
    ...query(name),
    doc: (id) => docRef(name, id),
    async add(data) {
      const id = `auto${++autoId}`;
      col(name).set(id, { ...data });
      return docRef(name, id);
    },
  }),
  getAll: (...refs) => Promise.all(refs.map((r) => r.get())),
  batch() {
    const ops = [];
    return {
      update: (ref, data) => ops.push(() => ref.update(data)),
      set: (ref, data) => ops.push(() => ref.set(data)),
      delete: (ref) => ops.push(() => ref.delete()),
      commit: async () => {
        for (const op of ops) await op();
      },
    };
  },
  runTransaction: async (cb) =>
    cb({
      get: (ref) => ref.get(),
      set: (ref, d) => ref.set(d),
      update: (ref, d) => ref.update(d),
      delete: (ref) => ref.delete(),
    }),
};

const authMock = {
  verifyIdToken: jest.fn(),
  createUser: jest.fn(),
  deleteUser: jest.fn().mockResolvedValue(undefined),
};

const admin = {
  firestore: { Timestamp, FieldValue: { delete: () => DELETE } },
  auth: () => authMock,
};

// helpers for building test data
const daysFromNow = (n) => new Timestamp(new Date(Date.now() + n * 86400000));

module.exports = {
  store,
  queries,
  reset,
  db,
  admin,
  authMock,
  Timestamp,
  daysFromNow,
  firebaseMock: { db, admin },
};
