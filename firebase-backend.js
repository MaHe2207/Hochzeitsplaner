import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  writeBatch
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";

const cfg = window.APP_CONFIG?.FIREBASE_CONFIG;
if (!cfg?.projectId) {
  throw new Error("Firebase ist nicht konfiguriert.");
}

const firebaseApp = initializeApp(cfg);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

const TABLES = {
  wedding_members: "members",
  todo_sections: "todoSections",
  todos: "todos",
  budget_items: "budgetItems",
  guests: "guests",
  guest_tags: "guestTags",
  guest_tag_links: "guestTagLinks",
  note_sections: "noteSections",
  note_pages: "notePages"
};

const TIMESTAMP_TABLES = new Set([
  "todo_sections", "todos", "budget_items", "guests", "note_sections", "note_pages"
]);

function isoNow() {
  return new Date().toISOString();
}

function uuid() {
  return crypto.randomUUID();
}

function normalizeError(err) {
  if (!err) return null;
  return {
    message: err.message || String(err),
    code: err.code || "firebase-error",
    original: err
  };
}

function normalizeUser(user) {
  if (!user) return null;
  return {
    id: user.uid,
    uid: user.uid,
    email: user.email,
    display_name: user.displayName || "",
    raw: user
  };
}

function sessionFor(user) {
  return user ? { user: normalizeUser(user) } : null;
}

async function waitForInitialAuth() {
  return await new Promise((resolve, reject) => {
    let unsub = () => {};
    unsub = onAuthStateChanged(auth, user => {
      unsub();
      resolve(user);
    }, err => {
      unsub();
      reject(err);
    });
  });
}

class FirebaseChannel {
  constructor(client, name) {
    this.client = client;
    this.name = name;
    this.listeners = [];
    this.unsubscribers = [];
  }

  on(_kind, spec, callback) {
    this.listeners.push({ spec, callback });
    return this;
  }

  subscribe() {
    for (const entry of this.listeners) {
      const { spec, callback } = entry;
      const table = spec?.table;
      let unsubscribe = () => {};

      if (table === "weddings") {
        const weddingId = this.client.activeWeddingId || this.client.parseWeddingFilter(spec?.filter);
        if (!weddingId) continue;
        unsubscribe = onSnapshot(
          doc(db, "weddings", weddingId),
          () => callback({ eventType: "UPDATE" }),
          err => console.error("Firebase Realtime weddings:", err)
        );
      } else {
        const weddingId = this.client.activeWeddingId || this.client.parseWeddingFilter(spec?.filter);
        const colName = TABLES[table];
        if (!weddingId || !colName) continue;
        unsubscribe = onSnapshot(
          collection(db, "weddings", weddingId, colName),
          () => callback({ eventType: "UPDATE" }),
          err => console.error(`Firebase Realtime ${table}:`, err)
        );
      }

      this.unsubscribers.push(unsubscribe);
    }
    return this;
  }

  close() {
    this.unsubscribers.forEach(fn => {
      try { fn(); } catch (_) {}
    });
    this.unsubscribers = [];
  }
}

class QueryBuilder {
  constructor(client, table, operation = "select", payload = null) {
    this.client = client;
    this.table = table;
    this.operation = operation;
    this.payload = payload;
    this.filters = [];
    this.orders = [];
    this.maxRows = null;
    this.wantSingle = false;
    this.wantSelectAfterMutation = false;
  }

  select() {
    if (this.operation !== "select") this.wantSelectAfterMutation = true;
    return this;
  }

  eq(field, value) {
    this.filters.push([field, value]);
    return this;
  }

  order(field, opts = {}) {
    this.orders.push([field, opts?.ascending !== false]);
    return this;
  }

  limit(n) {
    this.maxRows = Number(n);
    return this;
  }

  single() {
    this.wantSingle = true;
    return this;
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }

  filterValue(field) {
    const found = this.filters.find(([f]) => f === field);
    return found ? found[1] : undefined;
  }

  matches(data, docId = null) {
    return this.filters.every(([field, value]) => {
      if (field === "id") return (data?.id ?? docId) === value;
      return data?.[field] === value;
    });
  }

  sortRows(rows) {
    if (!this.orders.length) return rows;
    return [...rows].sort((a, b) => {
      for (const [field, asc] of this.orders) {
        const av = a?.[field];
        const bv = b?.[field];
        if (av == null && bv == null) continue;
        if (av == null) return asc ? 1 : -1;
        if (bv == null) return asc ? -1 : 1;
        let cmp = 0;
        if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
        else cmp = String(av).localeCompare(String(bv), "de");
        if (cmp) return asc ? cmp : -cmp;
      }
      return 0;
    });
  }

  result(rows) {
    let out = this.sortRows(rows);
    if (Number.isFinite(this.maxRows)) out = out.slice(0, this.maxRows);
    if (this.wantSingle) {
      if (out.length !== 1) {
        return { data: null, error: { message: out.length ? "Mehr als ein Datensatz gefunden." : "Datensatz nicht gefunden." } };
      }
      return { data: out[0], error: null };
    }
    return { data: out, error: null };
  }

  weddingIdFromContext() {
    const filterWid = this.filterValue("wedding_id");
    if (filterWid) {
      this.client.activeWeddingId = filterWid;
      return filterWid;
    }
    const payload = Array.isArray(this.payload) ? this.payload[0] : this.payload;
    if (payload?.wedding_id) {
      this.client.activeWeddingId = payload.wedding_id;
      return payload.wedding_id;
    }
    return this.client.activeWeddingId;
  }

  async selectRows() {
    // Top-level wedding document.
    if (this.table === "weddings") {
      const id = this.filterValue("id");
      if (id) {
        this.client.activeWeddingId = id;
        const snap = await getDoc(doc(db, "weddings", id));
        if (!snap.exists()) return this.result([]);
        return this.result([{ id: snap.id, ...snap.data() }].filter(x => this.matches(x, snap.id)));
      }

      // Not used by the migrated app, but limited to documents allowed by rules.
      const snaps = await getDocs(collection(db, "weddings"));
      const rows = snaps.docs.map(d => ({ id: d.id, ...d.data() })).filter(r => this.matches(r, r.id));
      return this.result(rows);
    }

    // Membership lookup after login: collectionGroup + user_id constraint.
    if (this.table === "wedding_members" && !this.filterValue("wedding_id")) {
      const userId = this.filterValue("user_id");
      if (!userId) return { data: null, error: { message: "Mitgliedschaftsabfrage benötigt user_id." } };

      const snaps = await getDocs(query(collectionGroup(db, "members"), where("user_id", "==", userId)));
      const rows = snaps.docs.map(d => {
        const weddingId = d.ref.parent.parent?.id || d.data().wedding_id;
        return { id: d.id, wedding_id: weddingId, ...d.data() };
      }).filter(r => this.matches(r, r.id));

      if (rows[0]?.wedding_id) this.client.activeWeddingId = rows[0].wedding_id;
      return this.result(rows);
    }

    const weddingId = this.weddingIdFromContext();
    const colName = TABLES[this.table];
    if (!weddingId || !colName) return { data: null, error: { message: `Kein Hochzeitskontext für ${this.table}.` } };

    const snaps = await getDocs(collection(db, "weddings", weddingId, colName));
    const rows = snaps.docs
      .map(d => ({ id: d.data()?.id || d.id, ...d.data() }))
      .filter(r => this.matches(r, r.id));

    return this.result(rows);
  }

  prepareInsert(item) {
    const now = isoNow();
    const copy = { ...item };

    if (TIMESTAMP_TABLES.has(this.table)) {
      if (!copy.created_at) copy.created_at = now;
      if (["todos", "budget_items", "guests", "note_pages"].includes(this.table) && !copy.updated_at) {
        copy.updated_at = now;
      }
    }

    return copy;
  }

  docIdForInsert(item) {
    if (item.id) return item.id;
    if (this.table === "wedding_members" && item.user_id) return item.user_id;
    if (this.table === "guest_tag_links" && item.guest_id && item.tag_id) return `${item.guest_id}__${item.tag_id}`;
    return uuid();
  }

  async insertRows() {
    const weddingId = this.weddingIdFromContext();
    const colName = TABLES[this.table];
    if (!weddingId || !colName) return { data: null, error: { message: `Kein Hochzeitskontext für ${this.table}.` } };

    const source = Array.isArray(this.payload) ? this.payload : [this.payload];
    const inserted = [];

    for (const raw of source) {
      const id = this.docIdForInsert(raw || {});
      const item = this.prepareInsert({ ...(raw || {}) });

      if (this.table !== "guest_tag_links") item.id = item.id || id;
      item.wedding_id = item.wedding_id || weddingId;

      await setDoc(doc(db, "weddings", weddingId, colName, id), item);
      inserted.push({ id, ...item });
    }

    if (this.wantSingle) return { data: inserted[0] || null, error: inserted.length === 1 ? null : { message: "Einzelner Datensatz erwartet." } };
    return { data: this.wantSelectAfterMutation ? inserted : inserted, error: null };
  }

  async matchingRefs() {
    if (this.table === "weddings") {
      const id = this.filterValue("id");
      return id ? [doc(db, "weddings", id)] : [];
    }

    const weddingId = this.weddingIdFromContext();
    const colName = TABLES[this.table];
    if (!weddingId || !colName) return [];

    const id = this.filterValue("id");
    if (id) return [doc(db, "weddings", weddingId, colName, id)];

    if (this.table === "wedding_members") {
      const userId = this.filterValue("user_id");
      if (userId) return [doc(db, "weddings", weddingId, "members", userId)];
    }

    const snaps = await getDocs(collection(db, "weddings", weddingId, colName));
    return snaps.docs.filter(d => this.matches({ id: d.data()?.id || d.id, ...d.data() }, d.id)).map(d => d.ref);
  }

  async updateRows() {
    const refs = await this.matchingRefs();
    if (!refs.length) return { data: [], error: null };

    let patch = { ...(this.payload || {}) };
    if (TIMESTAMP_TABLES.has(this.table) && ["todos", "budget_items", "guests", "note_pages"].includes(this.table)) {
      patch.updated_at = isoNow();
    }

    await Promise.all(refs.map(ref => updateDoc(ref, patch)));

    if (!this.wantSelectAfterMutation) return { data: [], error: null };
    const rows = [];
    for (const ref of refs) {
      const snap = await getDoc(ref);
      if (snap.exists()) rows.push({ id: snap.data()?.id || snap.id, ...snap.data() });
    }
    if (this.wantSingle) return { data: rows[0] || null, error: rows.length === 1 ? null : { message: "Einzelner Datensatz erwartet." } };
    return { data: rows, error: null };
  }

  async deleteGuestLinksBy(field, value) {
    const weddingId = this.weddingIdFromContext();
    if (!weddingId) return;
    const snaps = await getDocs(collection(db, "weddings", weddingId, "guestTagLinks"));
    const batch = writeBatch(db);
    let count = 0;
    for (const d of snaps.docs) {
      if (d.data()?.[field] === value) {
        batch.delete(d.ref);
        count++;
      }
    }
    if (count) await batch.commit();
  }

  async deleteNotePagesForSection(sectionId) {
    const weddingId = this.weddingIdFromContext();
    if (!weddingId) return;
    const snaps = await getDocs(collection(db, "weddings", weddingId, "notePages"));
    const batch = writeBatch(db);
    let count = 0;
    for (const d of snaps.docs) {
      if (d.data()?.section_id === sectionId) {
        batch.delete(d.ref);
        count++;
      }
    }
    if (count) await batch.commit();
  }

  async detachTodosFromSection(sectionId) {
    const weddingId = this.weddingIdFromContext();
    if (!weddingId) return;
    const snaps = await getDocs(collection(db, "weddings", weddingId, "todos"));
    const promises = [];
    for (const d of snaps.docs) {
      if (d.data()?.section_id === sectionId) promises.push(updateDoc(d.ref, { section_id: null, updated_at: isoNow() }));
    }
    if (promises.length) await Promise.all(promises);
  }

  async deleteRows() {
    const refs = await this.matchingRefs();
    const deletedIds = refs.map(r => r.id);

    // Firestore has no automatic cascading deletes. Mirror the Supabase behavior explicitly.
    if (this.table === "guests") {
      for (const id of deletedIds) await this.deleteGuestLinksBy("guest_id", id);
    } else if (this.table === "guest_tags") {
      for (const id of deletedIds) await this.deleteGuestLinksBy("tag_id", id);
    } else if (this.table === "note_sections") {
      for (const id of deletedIds) await this.deleteNotePagesForSection(id);
    } else if (this.table === "todo_sections") {
      for (const id of deletedIds) await this.detachTodosFromSection(id);
    }

    await Promise.all(refs.map(ref => deleteDoc(ref)));
    return { data: [], error: null };
  }

  async execute() {
    try {
      if (this.operation === "select") return await this.selectRows();
      if (this.operation === "insert") return await this.insertRows();
      if (this.operation === "update") return await this.updateRows();
      if (this.operation === "delete") return await this.deleteRows();
      return { data: null, error: { message: "Unbekannte Datenbankoperation." } };
    } catch (err) {
      console.error("Firebase-Datenbankfehler:", err);
      return { data: null, error: normalizeError(err) };
    }
  }
}

class FirebaseBackend {
  constructor() {
    this.activeWeddingId = null;
    this.channels = new Set();

    this.auth = {
      getSession: async () => {
        const user = await waitForInitialAuth();
        return { data: { session: sessionFor(user) }, error: null };
      },

      onAuthStateChange: callback => {
        const unsubscribe = onAuthStateChanged(auth, user => callback(user ? "SIGNED_IN" : "SIGNED_OUT", sessionFor(user)));
        return { data: { subscription: { unsubscribe } } };
      },

      signInWithPassword: async ({ email, password }) => {
        try {
          const cred = await signInWithEmailAndPassword(auth, email, password);
          return { data: { session: sessionFor(cred.user), user: normalizeUser(cred.user) }, error: null };
        } catch (err) {
          return { data: { session: null, user: null }, error: normalizeError(err) };
        }
      },

      signUp: async ({ email, password, options }) => {
        try {
          const cred = await createUserWithEmailAndPassword(auth, email, password);
          const displayName = options?.data?.display_name || "";
          if (displayName) await updateProfile(cred.user, { displayName });
          return { data: { session: sessionFor(cred.user), user: normalizeUser(cred.user) }, error: null };
        } catch (err) {
          return { data: { session: null, user: null }, error: normalizeError(err) };
        }
      },

      signOut: async () => {
        try {
          await firebaseSignOut(auth);
          return { error: null };
        } catch (err) {
          return { error: normalizeError(err) };
        }
      }
    };
  }

  parseWeddingFilter(filterText) {
    const m = String(filterText || "").match(/(?:wedding_id|id)=eq\.([^,]+)/);
    if (m?.[1]) {
      this.activeWeddingId = m[1];
      return m[1];
    }
    return null;
  }

  from(table) {
    return {
      select: () => new QueryBuilder(this, table, "select"),
      insert: payload => new QueryBuilder(this, table, "insert", payload),
      update: payload => new QueryBuilder(this, table, "update", payload),
      delete: () => new QueryBuilder(this, table, "delete")
    };
  }

  channel(name) {
    const channel = new FirebaseChannel(this, name);
    this.channels.add(channel);
    return channel;
  }

  async removeChannel(channel) {
    try { channel?.close?.(); } catch (_) {}
    this.channels.delete(channel);
    return { data: null, error: null };
  }

  async rpc(name, params = {}) {
    // Kept only for backwards compatibility with the existing app code.
    // Current migrated users already have their wedding and memberships.
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Nicht angemeldet.");

      if (name === "create_wedding") {
        const weddingId = uuid();
        const inviteCode = uuid().replaceAll("-", "").slice(0, 8).toUpperCase();
        const now = isoNow();

        await setDoc(doc(db, "weddings", weddingId), {
          id: weddingId,
          name: params.p_name || "Unsere Hochzeit",
          wedding_date: params.p_wedding_date || null,
          invite_code: inviteCode,
          created_by: user.uid,
          created_at: now
        });

        await setDoc(doc(db, "weddings", weddingId, "members", user.uid), {
          wedding_id: weddingId,
          user_id: user.uid,
          display_name: params.p_display_name || user.displayName || user.email?.split("@")[0] || "Partner",
          role: "owner",
          joined_at: now
        });

        this.activeWeddingId = weddingId;
        return { data: weddingId, error: null };
      }

      if (name === "join_wedding_by_code") {
        return {
          data: null,
          error: {
            message: "Der Beitritt per Einladungscode ist in der migrierten Firebase-Version deaktiviert. Die beiden bestehenden Konten sind bereits verbunden."
          }
        };
      }

      return { data: null, error: { message: `Unbekannte Funktion: ${name}` } };
    } catch (err) {
      return { data: null, error: normalizeError(err) };
    }
  }
}

const backend = new FirebaseBackend();

window.supabase = {
  createClient() {
    return backend;
  }
};

// Load the existing app only after Firebase and the adapter are ready.
await import("./app-firebase-test.js");
