"use client";

import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  CreditCard,
  Download,
  Eye,
  FileUp,
  Fingerprint,
  FlaskConical,
  Flower2,
  Heart,
  Landmark,
  Leaf,
  LockKeyhole,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Wallet,
  X,
  LoaderCircle,
  CircleDot,
  LayoutGrid,
  Target,
  ReceiptText,
  GitBranch,
} from "lucide-react";
import {
  assessPurchase,
  createDemoWorkspace,
  createEmptyWorkspace,
  summarizeWorkspace,
  resolveAmbiguity,
  type Workspace,
  type Account,
  type Commitment,
  type Transaction,
} from "@/lib/finance";
import { importTransactionsCsv } from "@/lib/csv";
import {
  STORAGE_KEY,
  downloadFile,
  validateWorkspace,
} from "@/lib/workspace-store";
import {
  normalizePlaidSnapshot,
  mergePlaidSnapshot,
} from "@/lib/plaid-normalize";
import CashChart from "./chart";

const currency = (n: number, decimals = false) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  }).format(n / 100);
const dateLabel = (d: string, long = false) =>
  new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", {
    month: long ? "long" : "short",
    day: "numeric",
  });
const today = () => new Date().toLocaleDateString("en-CA");
const id = () => crypto.randomUUID();
const parseMoney = (s: string) => {
  if (!/^\d+(\.\d{1,2})?$/.test(s.trim()))
    throw new Error("Enter an amount with up to two decimal places.");
  const [whole, fraction = ""] = s.trim().split(".");
  const n = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(n) || n > 100000000000)
    throw new Error("That amount is too large.");
  return n;
};
type LocalWorkspace = Workspace & { sourceWarnings?: string[] };
type PageName =
  | "Overview"
  | "Transactions"
  | "Your plan"
  | "Accounts"
  | "Settings";
type ModalName =
  | "connect"
  | "decision"
  | "review"
  | "import"
  | "commitment"
  | "account"
  | "calculation"
  | "welcome"
  | null;
type BankStatus = {
  configured: boolean;
  available: boolean;
  environment: string | null;
  connected: boolean;
  reason?: string;
  items?: { id: string; institutionName: string; lastSyncedAt: string }[];
};

async function readBankStatus(): Promise<BankStatus> {
  try {
    const res = await fetch("/api/plaid/status");
    if (!res.ok) throw new Error();
    return await res.json();
  } catch {
    return {
      configured: false,
      available: false,
      environment: null,
      connected: false,
      reason:
        "The bank connector is not running yet. You can still add accounts or import a statement.",
    };
  }
}

declare global {
  interface Window {
    Plaid?: {
      create: (o: {
        token: string;
        receivedRedirectUri?: string;
        onSuccess: (
          token: string,
          metadata: { institution?: { name: string; institution_id: string } },
        ) => void;
        onExit: (
          error: { display_message?: string; error_message?: string } | null,
        ) => void;
      }) => { open: () => void; destroy: () => void };
    };
  }
}

function Modal({
  title,
  eyebrow,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-shell">
        <div className="modal-head">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h2>{title}</h2>
          </div>
          <button
            className="icon-btn"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
function Empty({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Flower2 size={30} />
      </div>
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
}
function AccountIcon({ account }: { account: Account }) {
  return (
    <span className={`account-icon ${account.type}`}>
      {account.type === "credit" ? (
        <CreditCard size={21} />
      ) : account.type === "savings" ? (
        <Leaf size={21} />
      ) : (
        <Landmark size={21} />
      )}
    </span>
  );
}
function MerchantIcon({ name, category }: { name: string; category: string }) {
  const cls = /food|dining|grocer/i.test(category)
    ? "peach"
    : /travel|transport/i.test(category)
      ? "lavender"
      : /income/i.test(category)
        ? "sage"
        : "neutral";
  return (
    <span className={`merchant-icon ${cls}`}>
      {/spotify/i.test(name)
        ? "s"
        : /apple/i.test(name)
          ? "a"
          : name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export default function SelmioApp() {
  const [workspace, setWorkspace] = useState<LocalWorkspace>(() =>
    createDemoWorkspace(),
  );
  const workspaceRef = useRef(workspace);
  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);
  const [ready, setReady] = useState(false),
    [storageError, setStorageError] = useState(false),
    [storageAvailable, setStorageAvailable] = useState(true);
  const [page, setPage] = useState<PageName>("Overview"),
    [modal, setModal] = useState<ModalName>(null),
    [mobileNav, setMobileNav] = useState(false);
  const [toast, setToast] = useState(""),
    [query, setQuery] = useState(""),
    [txFilter, setTxFilter] = useState("All activity"),
    [chartDays, setChartDays] = useState(24);
  const [selectedAccount, setSelectedAccount] = useState(""),
    [purchaseAmount, setPurchaseAmount] = useState("600"),
    [purchaseDate, setPurchaseDate] = useState("2026-11-10");
  const [bankStatus, setBankStatus] = useState<BankStatus | null>(null),
    [bankBusy, setBankBusy] = useState(false),
    [bankError, setBankError] = useState("");
  const [reviewId, setReviewId] = useState<string | null>(null),
    [editingCommitment, setEditingCommitment] = useState<Commitment | null>(
      null,
    );
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const restoreRef = useRef<HTMLInputElement>(null);
  const lastStorageRef = useRef<string | null>(null);
  const notify = (message: string) => setToast(message);
  /* eslint-disable react-hooks/set-state-in-effect -- Hydrate browser-owned storage only after the server/client initial render matches. */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      lastStorageRef.current = saved;
      if (saved) setWorkspace(validateWorkspace(JSON.parse(saved)));
    } catch {
      setStorageError(true);
      setToast(
        "Your saved workspace could not be opened. It has not been overwritten.",
      );
    }
    setReady(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (
        event.key === STORAGE_KEY &&
        event.newValue !== lastStorageRef.current
      ) {
        setStorageError(true);
        setToast(
          "Another tab changed this workspace. Saving is paused so neither copy is overwritten.",
        );
      }
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  useEffect(() => {
    if (!ready || storageError) return;
    let cancelled = false;
    const save = () => {
      if (cancelled) return;
      try {
        const existing = localStorage.getItem(STORAGE_KEY);
        if (existing !== lastStorageRef.current) {
          setStorageError(true);
          setToast(
            "Another tab changed this workspace. Export your changes or open its saved version.",
          );
          return;
        }
        const serialized = JSON.stringify(workspace);
        localStorage.setItem(STORAGE_KEY, serialized);
        lastStorageRef.current = serialized;
        setStorageAvailable(true);
      } catch {
        setStorageAvailable(false);
        setToast(
          "Storage is full or unavailable. Export a backup to keep your changes.",
        );
      }
    };
    if (navigator.locks)
      void navigator.locks.request("selmio-workspace-write", save).catch(() => {
        setStorageAvailable(false);
      });
    else save();
    return () => {
      cancelled = true;
    };
  }, [workspace, ready, storageError]);
  const openSavedVersion = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw)
        throw new Error(
          "No saved version exists. Export this workspace before starting again.",
        );
      const next = validateWorkspace(JSON.parse(raw));
      lastStorageRef.current = raw;
      setWorkspace(next);
      setStorageError(false);
      setStorageAvailable(true);
      notify("Opened the latest saved workspace.");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "The saved version could not be opened.",
      );
    }
  };
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPage("Transactions");
        setTimeout(
          () => document.getElementById("transaction-search")?.focus(),
          50,
        );
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const summary = useMemo(() => summarizeWorkspace(workspace), [workspace]);
  const accountId =
    workspace.accounts.find((a) => a.id === selectedAccount)?.id ||
    summary.defaultAccountId ||
    "";
  const currentAccount = workspace.accounts.find((a) => a.id === accountId);
  const asOfDate = currentAccount?.lastUpdated.slice(0, 10) ?? summary.asOfDate;
  const effectivePurchaseDate = purchaseDate < asOfDate ? asOfDate : purchaseDate;
  const base = accountId
    ? assessPurchase(workspace, {
        amountCents: 0,
        date: asOfDate,
        accountId,
      })
    : null;
  const purchaseCents = useMemo(() => {
    try {
      return parseMoney(purchaseAmount);
    } catch {
      return null;
    }
  }, [purchaseAmount]);
  const decision = (() => {
    try {
      return accountId && purchaseCents !== null
        ? assessPurchase(workspace, {
            amountCents: purchaseCents,
            date: effectivePurchaseDate,
            accountId,
          })
        : null;
    } catch {
      return null;
    }
  })();
  const unresolved = workspace.ambiguities.filter((a) => !a.resolvedOptionId);
  const review =
    workspace.ambiguities.find(
      (a) => a.id === reviewId && !a.resolvedOptionId,
    ) || unresolved[0];
  const upcoming = workspace.commitments
    .filter((c) => c.dueDate >= asOfDate)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const navigate = (next: PageName) => {
    setPage(next);
    setMobileNav(false);
  };
  const refreshBankStatus = async () => {
    setBankStatus(await readBankStatus());
  };
  useEffect(() => {
    if (modal !== "connect" && page !== "Accounts") return;
    let cancelled = false;
    void readBankStatus().then((status) => {
      if (!cancelled) setBankStatus(status);
    });
    return () => {
      cancelled = true;
    };
  }, [modal, page]);
  const applyBankSnapshot = (input: unknown) => {
    const snapshot = normalizePlaidSnapshot(input);
    if (snapshot.accounts.length) {
      const merged = mergePlaidSnapshot(workspaceRef.current, snapshot);
      setWorkspace({ ...merged.workspace, sourceWarnings: merged.warnings });
      setPurchaseDate(today());
      notify(
        `${snapshot.accounts.length} accounts imported${snapshot.environment === "sandbox" ? " from Plaid Sandbox" : ""}. ${merged.warnings[0] || "Confirm your bills and buffer to complete your plan."}`,
      );
    } else
      notify(
        snapshot.syncError ||
          "Your connection is saved. Account data is not ready yet; try Refresh in Accounts shortly.",
      );
    void refreshBankStatus();
  };
  const bankRequest = async (
    path: string,
    body: unknown = {},
  ): Promise<Record<string, unknown>> => {
    const res = await fetch(`/api/plaid/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data: unknown = await res.json();
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error("The connector returned an unexpected response.");
    const result = data as Record<string, unknown>;
    if (!res.ok)
      throw new Error(
        typeof result.error === "string"
          ? result.error
          : "The bank connection could not be completed.",
      );
    return result;
  };
  const clearLinkSession = () => {
    sessionStorage.removeItem("selmio.plaid.link");
    const url = new URL(window.location.href);
    if (url.searchParams.has("oauth_state_id")) {
      url.searchParams.delete("oauth_state_id");
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  };
  const connectBank = async (itemId?: string, resume = false) => {
    setBankBusy(true);
    setBankError("");
    try {
      let linkToken: string,
        mode: "new" | "update" = itemId ? "update" : "new",
        linkedItem = itemId;
      if (resume) {
        const stored: unknown = JSON.parse(
          sessionStorage.getItem("selmio.plaid.link") || "null",
        );
        if (
          !stored ||
          typeof stored !== "object" ||
          !("token" in stored) ||
          typeof stored.token !== "string" ||
          !("createdAt" in stored) ||
          typeof stored.createdAt !== "number" ||
          Date.now() - stored.createdAt > 30 * 60 * 1000
        )
          throw new Error(
            "This bank connection session has expired. Please connect again.",
          );
        linkToken = stored.token;
        mode = "mode" in stored && stored.mode === "update" ? "update" : "new";
        linkedItem =
          "itemId" in stored && typeof stored.itemId === "string"
            ? stored.itemId
            : undefined;
      } else {
        const data = await bankRequest(
          itemId ? "update-token" : "link-token",
          itemId ? { item_id: itemId } : {},
        );
        if (typeof data.link_token !== "string")
          throw new Error("A connection session could not be created.");
        linkToken = data.link_token;
        sessionStorage.setItem(
          "selmio.plaid.link",
          JSON.stringify({
            token: linkToken,
            mode,
            itemId,
            createdAt: Date.now(),
          }),
        );
      }
      if (!window.Plaid)
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src =
            "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
          script.onload = () => resolve();
          script.onerror = () =>
            reject(
              new Error(
                "Plaid could not load. Check your connection and try again.",
              ),
            );
          document.head.appendChild(script);
        });
      if (!window.Plaid) throw new Error("Plaid did not load.");
      const handler = window.Plaid.create({
        token: linkToken,
        ...(resume ? { receivedRedirectUri: window.location.href } : {}),
        onSuccess: async (publicToken, metadata) => {
          try {
            const snapshot =
              mode === "update"
                ? await bankRequest("sync", { item_id: linkedItem })
                : await bankRequest("exchange", {
                    public_token: publicToken,
                    institution: metadata.institution
                      ? {
                          name: metadata.institution.name,
                          id: metadata.institution.institution_id,
                        }
                      : undefined,
                  });
            applyBankSnapshot(snapshot);
            clearLinkSession();
            setModal(null);
          } catch (e) {
            setBankError(
              e instanceof Error ? e.message : "Could not import accounts.",
            );
          } finally {
            setBankBusy(false);
            handler.destroy();
          }
        },
        onExit: (error) => {
          setBankBusy(false);
          if (error)
            setBankError(
              error.display_message ||
                error.error_message ||
                "Please try connecting again.",
            );
          clearLinkSession();
          handler.destroy();
        },
      });
      handler.open();
    } catch (e) {
      setBankError(e instanceof Error ? e.message : "Could not connect.");
      setBankBusy(false);
    }
  };
  const resumedOAuth = useRef(false);
  const resumeBankOAuth = useEffectEvent(() => {
    setModal("connect");
    void connectBank(undefined, true);
  });
  useEffect(() => {
    if (
      ready &&
      !resumedOAuth.current &&
      new URLSearchParams(window.location.search).has("oauth_state_id")
    ) {
      resumedOAuth.current = true;
      resumeBankOAuth();
    }
  }, [ready]);
  const syncBank = async () => {
    setBankBusy(true);
    setBankError("");
    try {
      applyBankSnapshot(await bankRequest("sync"));
    } catch (e) {
      setBankError(e instanceof Error ? e.message : "Could not sync.");
    } finally {
      setBankBusy(false);
    }
  };
  const captureStorageBaseline = () => {
    try {
      lastStorageRef.current = localStorage.getItem(STORAGE_KEY);
      return true;
    } catch {
      setStorageAvailable(false);
      return false;
    }
  };
  const unavailableStorageMessage =
    "Browser storage is unavailable. This workspace is in memory only; export a backup to keep it.";
  const startPersonal = () => {
    if (workspace.mode === "demo") {
      setWorkspace(createEmptyWorkspace());
      setSelectedAccount("");
      setPurchaseDate(today());
      if (!captureStorageBaseline()) notify(unavailableStorageMessage);
      setStorageError(false);
    }
    setModal("connect");
  };
  const backup = () => {
    downloadFile(
      `selmio-${workspace.mode}-${today()}.json`,
      JSON.stringify(workspace, null, 2),
    );
    notify("Workspace backup exported. Keep it somewhere private.");
  };
  const restore = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 10000000)
        throw new Error("Choose a backup smaller than 10 MB.");
      const restored = validateWorkspace(JSON.parse(await file.text()));
      setWorkspace(restored);
      const canSave = captureStorageBaseline();
      setStorageError(false);
      notify(
        canSave
          ? "Your workspace has been restored."
          : `Your workspace has been restored in memory. ${unavailableStorageMessage}`,
      );
    } catch (e) {
      notify(
        e instanceof Error ? e.message : "That backup could not be restored.",
      );
    }
    if (restoreRef.current) restoreRef.current.value = "";
  };
  const transactions = workspace.transactions
    .filter(
      (t) =>
        `${t.merchant} ${t.category}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (txFilter === "All activity" ||
          (txFilter === "Spending" && t.kind === "expense") ||
          (txFilter === "Income" && t.kind === "income") ||
          (txFilter === "Transfers" && t.kind === "transfer")),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const openCommitment = (value: Commitment | null = null) => {
    setEditingCommitment(value);
    setModal("commitment");
  };
  const totalBills = upcoming
    .filter(
      (c) => c.kind !== "income" && c.accountId === accountId && c.confirmed,
    )
    .reduce((sum, c) => sum + c.amountCents, 0);
  const room = base?.conservativeRoomCents ?? 0;
  const nav = [
    { name: "Overview" as PageName, icon: LayoutGrid },
    { name: "Transactions" as PageName, icon: ArrowLeftRight },
    { name: "Your plan" as PageName, icon: Target },
    { name: "Accounts" as PageName, icon: Wallet },
  ];
  const renderTransactions = (compact = false) => (
    <div className="transaction-list">
      {(compact ? transactions.slice(0, 4) : transactions).map((t) => (
        <div className="transaction-row" key={t.id}>
          <MerchantIcon name={t.merchant} category={t.category} />
          <div className="transaction-description">
            <strong>{t.merchant}</strong>
            <span>
              {t.category}
              {t.status === "pending" && " · Pending"}
            </span>
          </div>
          {!compact && (
            <span className="transaction-account">
              {workspace.accounts.find((a) => a.id === t.accountId)?.name}
            </span>
          )}
          <span className="transaction-date">{dateLabel(t.date)}</span>
          <strong
            className={`transaction-amount ${t.kind === "income" ? "positive" : ""}`}
          >
            {t.amountCents > 0 ? "+" : "−"}
            {currency(Math.abs(t.amountCents), true)}
          </strong>
          {!compact && (
            <select
              aria-label={`Type for ${t.merchant}`}
              value={t.kind}
              className="type-select"
              onChange={(e) => {
                setWorkspace((w) => ({
                  ...w,
                  transactions: w.transactions.map((x) =>
                    x.id === t.id
                      ? { ...x, kind: e.target.value as Transaction["kind"] }
                      : x,
                  ),
                }));
                notify(
                  "Transaction type updated. Account balance anchors stay unchanged.",
                );
              }}
            >
              <option value="expense">Expense</option>
              <option value="income">Income</option>
              <option value="transfer">Transfer</option>
            </select>
          )}
        </div>
      ))}
      {!transactions.length && (
        <Empty
          title="A fresh start."
          detail="Your transactions will appear here after you connect a bank or import a statement."
          action={
            <button
              className="btn secondary"
              onClick={() => setModal("import")}
            >
              <FileUp size={16} />
              Import a statement
            </button>
          }
        />
      )}
    </div>
  );
  return (
    <div className="app-shell">
      {mobileNav && (
        <button
          className="nav-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside className={`sidebar ${mobileNav ? "is-open" : ""}`}>
        <button
          className="brand"
          onClick={() => navigate("Overview")}
          aria-label="Selmio home"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- Local offline SVG; preserve native asset rendering without an optimizer. */}
          <img src="/brand/selmio-mark.svg" alt="" />
          <span>
            selmio<span className="brand-period">.</span>
          </span>
        </button>
        <div className="workspace-picker">
          <span className="workspace-avatar">
            {workspace.mode === "demo" ? (
              <FlaskConical size={16} />
            ) : (
              <Heart size={16} />
            )}
          </span>
          <div>
            <strong>
              {workspace.mode === "demo"
                ? "The demo space"
                : "My personal space"}
            </strong>
            <small>Personal workspace</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <div className="nav-label">YOUR SPACE</div>
        <nav>
          {nav.map((n) => (
            <button
              key={n.name}
              className={`nav-item ${page === n.name ? "active" : ""}`}
              onClick={() => navigate(n.name)}
            >
              <n.icon size={18} />
              {n.name}
              {n.name === "Your plan" && unresolved.length > 0 && (
                <span className="nav-count">{unresolved.length}</span>
              )}
            </button>
          ))}
        </nav>
        <button className="scenario-nav" onClick={() => setModal("decision")}>
          <span>
            <Sparkles size={18} />
            What if…
          </span>
          <ArrowUpRight size={15} />
        </button>
        <div className="sidebar-bottom">
          <div className="local-note">
            <span className="local-symbol">
              <Fingerprint size={22} />
            </span>
            <strong>Your money. Your space.</strong>
            <p>Your budget lives on this device. You&apos;re in control.</p>
            <span>
              <span className="status-dot" /> Local workspace
            </span>
          </div>
          <button
            className={`nav-item ${page === "Settings" ? "active" : ""}`}
            onClick={() => navigate("Settings")}
          >
            <Settings2 size={18} />
            Settings
          </button>
          <button className="profile" onClick={() => navigate("Settings")}>
            <span className="profile-avatar">Y</span>
            <div>
              <strong>Your workspace</strong>
              <small>Made for a little more life</small>
            </div>
            <MoreHorizontal size={18} />
          </button>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-btn mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={20} />
            </button>
            <span>My workspace</span>
            <ChevronRight size={12} />
            <strong>{page}</strong>
          </div>
          <div className="topbar-right">
            <span className="saved-state">
              <span className="status-dot" />
              {!ready
                ? "Opening workspace"
                : storageError
                  ? "Saved data needs attention"
                  : storageAvailable
                    ? "Saved on this device"
                    : "Not saved · export a backup"}
            </span>
            <button
              className="icon-btn"
              aria-label="Search transactions"
              onClick={() => {
                navigate("Transactions");
                setTimeout(
                  () => document.getElementById("transaction-search")?.focus(),
                  100,
                );
              }}
            >
              <Search size={18} />
            </button>
            <button
              className="icon-btn notification"
              aria-label={`Review ${unresolved.length} unresolved items`}
              onClick={() => setModal("review")}
            >
              <Bell size={18} />
              {unresolved.length > 0 && <i />}
            </button>
            <span className="top-avatar">Y</span>
          </div>
        </header>
        <main className="page-content">
          <div className="page-heading">
            <div>
              <div className="heading-eyebrow">
                <span className="little-sun">✳</span>
                {page === "Overview"
                  ? "A CLEARER PICTURE, A CALMER YOU"
                  : page === "Your plan"
                    ? "MAKE SPACE FOR WHAT MATTERS"
                    : page === "Accounts"
                      ? "EVERYTHING, TOGETHER"
                      : page === "Settings"
                        ? "YOUR SPACE, YOUR RULES"
                        : "THE LITTLE THINGS ADD UP"}
              </div>
              <h1>
                {page === "Overview" ? (
                  <>
                    A little more breathing room<span>.</span>
                  </>
                ) : page === "Your plan" ? (
                  "A plan for real life."
                ) : page === "Accounts" ? (
                  "Your money, together."
                ) : page === "Settings" ? (
                  "Make yourself at home."
                ) : (
                  "Follow your money."
                )}
              </h1>
              <p>
                {page === "Overview"
                  ? "See where you stand. Know what fits. Get on with living."
                  : page === "Your plan"
                    ? "Protect the essentials and make room for the things you love."
                    : page === "Accounts"
                      ? "A simple connection. A much clearer picture."
                      : page === "Settings"
                        ? "Keep your priorities, data, and connections in your hands."
                        : "Every little detail, in one clear place."}
              </p>
            </div>
            <span className="btn secondary heading-date">
              <CalendarDays size={15} />
              {dateLabel(asOfDate)} —{" "}
              {dateLabel(base?.endDate ?? summary.horizonEndDate)}
            </span>
          </div>
          {storageError && (
            <div className="storage-warning" role="alert">
              <CircleHelp size={18} />
              <div>
                <strong>Saving is paused to protect your work.</strong>
                <p>
                  A different saved version or unreadable data needs attention.
                  Export this tab&apos;s changes before opening the latest saved
                  version.
                </p>
                <button className="text-action" onClick={backup}>
                  Export this copy
                  <Download size={14} />
                </button>
                <button className="text-action" onClick={openSavedVersion}>
                  Open saved version
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}
          {workspace.mode === "demo" && (
            <div className="demo-banner">
              <span>
                <Sparkles size={15} />
                <strong>A little look around.</strong> You&apos;re exploring sample
                data with real calculations.
              </span>
              <button onClick={startPersonal}>
                Make it yours
                <ArrowRight size={14} />
              </button>
            </div>
          )}
          {workspace.sourceWarnings?.length && workspace.mode === "personal" ? (
            <details className="source-warnings">
              <summary>
                <CircleHelp size={16} />
                {workspace.sourceWarnings.length} account detail
                {workspace.sourceWarnings.length === 1 ? "" : "s"} to review
                <ChevronDown size={14} />
              </summary>
              {workspace.sourceWarnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </details>
          ) : null}
          {page === "Overview" && (
            <>
              <div className="hero-grid">
                <section className="spending-card">
                  <div className="card-top">
                    <span className="eyebrow">ROOM TO SPEND</span>
                    <button
                      className="icon-btn small"
                      aria-label="How spending room is calculated"
                      onClick={() => setModal("calculation")}
                    >
                      <CircleHelp size={17} />
                    </button>
                  </div>
                  <div className="spending-amount">
                    {currency(room, true).split(".")[0]}
                    <span>
                      .{String(Math.abs(room) % 100).padStart(2, "0")}
                    </span>
                  </div>
                  <p className="spending-description">
                    {workspace.mode === "personal" &&
                    !workspace.commitments.length
                      ? "Add bills and paydays to make this estimate useful."
                      : "For a little more life, with your commitments covered."}
                  </p>
                  <div className="room-badge">
                    <ShieldCheck size={14} />
                    {base
                      ? `Estimated through ${dateLabel(base.endDate)}`
                      : "Add your first account to get started"}
                  </div>
                  <div className="spending-divider" />
                  <div className="room-breakdown">
                    <div>
                      <span>In this account</span>
                      <strong>
                        {currency(currentAccount?.balanceCents ?? 0)}
                      </strong>
                    </div>
                    <div>
                      <span>Planned outgoings</span>
                      <strong>{currency(totalBills)}</strong>
                    </div>
                    <div>
                      <span>Your cash buffer</span>
                      <strong>{currency(workspace.bufferCents)}</strong>
                    </div>
                  </div>
                  <div className="spending-bottom">
                    <span>Based on your plan and current assumptions.</span>
                    <button onClick={() => setModal("calculation")}>
                      See the calculation
                      <ArrowUpRight size={14} />
                    </button>
                  </div>
                </section>
                <section className="life-card">
                  {/* eslint-disable-next-line @next/next/no-img-element -- Local brand artwork; preserve the existing layout and offline rendering. */}
                  <img
                    className="sculpture"
                    src="/brand/selmio-sculpture.png"
                    alt="A pale green sculptural ribbon unfolding into two open loops"
                  />
                  <div className="life-card-copy">
                    <span className="eyebrow">MONEY IS FOR LIVING</span>
                    <h2>
                      Good plans.
                      <br />
                      More possibilities.
                    </h2>
                    <button onClick={() => setModal("decision")}>
                      Try a what-if
                      <Sparkles size={15} />
                    </button>
                  </div>
                  <span className="life-flower">✳</span>
                </section>
              </div>
              <div className="detail-grid">
                <section className="panel forecast-panel">
                  <div className="section-heading">
                    <div>
                      <h2>
                        Your money, up ahead
                        <span className="title-dot" />
                      </h2>
                      <p>A clearer view of what&apos;s coming and what&apos;s covered.</p>
                    </div>
                    <select
                      className="compact-select"
                      aria-label="Forecast period"
                      value={chartDays}
                      onChange={(e) => setChartDays(Number(e.target.value))}
                    >
                      <option value={24}>Next 24 days</option>
                      <option value={14}>Next 14 days</option>
                      <option value={7}>Next 7 days</option>
                    </select>
                  </div>
                  <div className="forecast-value">
                    <strong>
                      {currency(
                        base?.timeline.slice(0, chartDays).at(-1)
                          ?.conservativeCents ?? 0,
                      )}
                    </strong>
                    <span>
                      projected balance ·{" "}
                      {dateLabel(
                        base?.timeline.slice(0, chartDays).at(-1)?.date ??
                          summary.asOfDate,
                      )}
                    </span>
                    <select
                      aria-label="Forecast account"
                      value={accountId}
                      onChange={(e) => setSelectedAccount(e.target.value)}
                    >
                      {workspace.accounts
                        .filter((a) => a.type !== "credit")
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <CashChart
                    points={base?.timeline.slice(0, chartDays) ?? []}
                    bufferCents={workspace.bufferCents}
                  />
                </section>
                <section className="panel clarity-panel">
                  <div className="clarity-icon">
                    <Sparkles size={21} />
                  </div>
                  <span className="eyebrow">A LITTLE CLARITY</span>
                  <h2>
                    {unresolved.length
                      ? "One small answer.\nA clearer plan."
                      : "Looking a little clearer."}
                  </h2>
                  <p>
                    {unresolved.length
                      ? `${currency(unresolved[0].amountCents)} of your plan depends on a detail we haven't confirmed. Let's sort that out.`
                      : "Your current questions are resolved. Keep your bills and account balances up to date as life changes."}
                  </p>
                  {unresolved.length > 0 && (
                    <div className="clarity-source">
                      <CircleDot size={15} />
                      <span>{unresolved[0].title}</span>
                    </div>
                  )}
                  <button
                    className="text-action"
                    onClick={() =>
                      setModal(unresolved.length ? "review" : "calculation")
                    }
                  >
                    {unresolved.length
                      ? "Let's clear it up"
                      : "See your assumptions"}
                    <ArrowRight size={16} />
                  </button>
                </section>
              </div>
              <div className="detail-grid bottom-grid">
                <section className="panel activity-panel">
                  <div className="section-heading">
                    <h2>The latest little things</h2>
                    <button
                      className="text-action"
                      onClick={() => navigate("Transactions")}
                    >
                      All activity
                      <ArrowUpRight size={14} />
                    </button>
                  </div>
                  {renderTransactions(true)}
                </section>
                <section className="panel upcoming-panel">
                  <div className="section-heading">
                    <h2>Coming up</h2>
                    <button
                      className="icon-btn small"
                      aria-label="Add a planned payment"
                      onClick={() => openCommitment()}
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                  {upcoming.slice(0, 3).map((c) => (
                    <div className="upcoming-row" key={c.id}>
                      <span
                        className={`due-icon ${c.kind === "income" ? "sage" : ""}`}
                      >
                        {c.kind === "income" ? (
                          <ArrowDownLeft size={17} />
                        ) : (
                          <CalendarDays size={17} />
                        )}
                      </span>
                      <div>
                        <strong>{c.name}</strong>
                        <span>
                          {dateLabel(c.dueDate)} ·{" "}
                          {c.confirmed ? "Confirmed" : "Estimate"}
                        </span>
                      </div>
                      <b className={c.kind === "income" ? "positive" : ""}>
                        {c.kind === "income" ? "+" : ""}
                        {currency(c.amountCents)}
                      </b>
                    </div>
                  ))}
                  {!upcoming.length && (
                    <p className="subtle">
                      Add your bills and paydays to see what comes next.
                    </p>
                  )}
                  <button
                    className="text-action upcoming-link"
                    onClick={() => navigate("Your plan")}
                  >
                    See your plan
                    <ArrowRight size={15} />
                  </button>
                </section>
              </div>
            </>
          )}
          {page === "Transactions" && (
            <section className="panel">
              <div className="transaction-toolbar">
                <div className="search-field">
                  <Search size={17} />
                  <input
                    id="transaction-search"
                    placeholder="Find a merchant or category…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <kbd>⌘ K</kbd>
                </div>
                <select
                  className="compact-select"
                  value={txFilter}
                  onChange={(e) => setTxFilter(e.target.value)}
                  aria-label="Filter activity"
                >
                  {["All activity", "Spending", "Income", "Transfers"].map(
                    (x) => (
                      <option key={x}>{x}</option>
                    ),
                  )}
                </select>
                <button
                  className="btn secondary"
                  onClick={() => setModal("import")}
                >
                  <FileUp size={16} />
                  Import CSV
                </button>
              </div>
              <div className="table-heading">
                <span>
                  {transactions.length} transaction
                  {transactions.length === 1 ? "" : "s"}
                </span>
                <span>Recorded activity · balances are separate anchors</span>
              </div>
              {renderTransactions()}
            </section>
          )}
          {page === "Your plan" && (
            <>
              <div className="plan-summary">
                <div>
                  <span className="eyebrow">PROTECT YOUR PEACE OF MIND</span>
                  <h2>
                    Start with the essentials.
                    <br />
                    Leave room for yourself.
                  </h2>
                  <p>Your bills, goals, and paydays make the forecast yours.</p>
                </div>
                <button
                  className="btn primary"
                  onClick={() => openCommitment()}
                >
                  <Plus size={17} />
                  Add to your plan
                </button>
              </div>
              <div className="plan-grid">
                <section className="panel">
                  <div className="section-heading">
                    <h2>Your commitments</h2>
                    <span className="count-pill">
                      {workspace.commitments.length}
                    </span>
                  </div>
                  {upcoming.map((c) => (
                    <div className="plan-row" key={c.id}>
                      <span
                        className={`due-icon ${c.kind === "income" ? "sage" : c.kind === "goal" ? "lavender" : ""}`}
                      >
                        {c.kind === "income" ? (
                          <ArrowDownLeft size={20} />
                        ) : c.kind === "goal" ? (
                          <Target size={20} />
                        ) : (
                          <ReceiptText size={20} />
                        )}
                      </span>
                      <div>
                        <strong>{c.name}</strong>
                        <span>
                          {dateLabel(c.dueDate)} ·{" "}
                          {
                            workspace.accounts.find((a) => a.id === c.accountId)
                              ?.name
                          }
                        </span>
                      </div>
                      <span
                        className={`pill ${c.confirmed ? "green" : "amber"}`}
                      >
                        {c.confirmed ? "Confirmed" : "Estimate"}
                      </span>
                      <b>
                        {c.kind === "income" ? "+" : "−"}
                        {currency(c.amountCents)}
                      </b>
                      <button
                        className="icon-btn"
                        aria-label={`Edit ${c.name}`}
                        onClick={() => openCommitment(c)}
                      >
                        <SlidersHorizontal size={16} />
                      </button>
                      <button
                        className="icon-btn"
                        aria-label={`Delete ${c.name}`}
                        onClick={() => {
                          setWorkspace((w) => ({
                            ...w,
                            commitments: w.commitments.filter(
                              (x) => x.id !== c.id,
                            ),
                          }));
                          notify("Removed from your plan.");
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                  {!upcoming.length && (
                    <Empty
                      title="Make room for real life."
                      detail="Add your next payday, bills, and goals. Your forecast will update with every commitment."
                      action={
                        <button
                          className="btn primary"
                          onClick={() => openCommitment()}
                        >
                          <Plus size={16} />
                          Add a commitment
                        </button>
                      }
                    />
                  )}
                </section>
                <div>
                  <section className="panel buffer-panel">
                    <span className="clarity-icon sage">
                      <ShieldCheck size={21} />
                    </span>
                    <h2>A little cushion.</h2>
                    <p>
                      This is the cash you want to keep untouched in your
                      forecast account.
                    </p>
                    <label className="field-label" htmlFor="buffer">
                      Your protected buffer
                    </label>
                    <div className="currency-field">
                      <span>$</span>
                      <input
                        id="buffer"
                        type="number"
                        min="0"
                        step="1"
                        value={workspace.bufferCents / 100}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (
                            Number.isFinite(n) &&
                            n >= 0 &&
                            Number.isSafeInteger(Math.round(n * 100))
                          )
                            setWorkspace((w) => ({
                              ...w,
                              bufferCents: Math.round(n * 100),
                            }));
                        }}
                      />
                    </div>
                    <p className="fine-print">
                      You choose the amount. Selmio includes it when testing a
                      purchase.
                    </p>
                  </section>
                  {unresolved.length > 0 && (
                    <button
                      className="review-banner"
                      onClick={() => setModal("review")}
                    >
                      <Sparkles size={20} />
                      <span>
                        <strong>
                          {unresolved.length} thing
                          {unresolved.length === 1 ? "" : "s"} to clear up
                        </strong>
                        <small>A few details could change your plan.</small>
                      </span>
                      <ArrowRight size={17} />
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
          {page === "Accounts" && (
            <>
              <div className="accounts-actions">
                <span className="subtle">
                  {workspace.accounts.length} account
                  {workspace.accounts.length === 1 ? "" : "s"} ·{" "}
                  {workspace.mode === "demo"
                    ? "Sample balances"
                    : "USD accounts"}
                </span>
                <div>
                  <button
                    className="btn secondary"
                    onClick={() => setModal("account")}
                  >
                    <Plus size={16} />
                    Add manually
                  </button>
                  <button
                    className="btn primary"
                    onClick={() => setModal("connect")}
                  >
                    <Landmark size={17} />
                    Connect your bank
                  </button>
                </div>
              </div>
              <div className="account-cards">
                {workspace.accounts.map((a) => (
                  <section className={`account-card ${a.type}`} key={a.id}>
                    <div className="section-heading">
                      <AccountIcon account={a} />
                      {!a.id.startsWith("plaid:") && (
                        <button
                          className="icon-btn"
                          aria-label={`Edit ${a.name}`}
                          onClick={() => {
                            setEditingAccount(a);
                            setModal("account");
                          }}
                        >
                          <SlidersHorizontal size={16} />
                        </button>
                      )}
                      <span className="pill">
                        {a.id.startsWith("plaid:")
                          ? "Bank import"
                          : workspace.mode === "demo"
                            ? "Sample"
                            : "Manual"}
                      </span>
                    </div>
                    <span className="eyebrow">{a.institution}</span>
                    <h2>{a.name}</h2>
                    <div className="account-balance">
                      {currency(a.balanceCents, true)}
                    </div>
                    <div className="account-card-bottom">
                      <span>
                        {a.type === "credit"
                          ? "Card balance"
                          : a.type === "savings"
                            ? "Savings balance"
                            : "Checking balance"}
                      </span>
                      <span>{a.lastUpdated?.slice(0, 10)}</span>
                    </div>
                  </section>
                ))}
              </div>
              {!workspace.accounts.length && (
                <section className="panel">
                  <Empty
                    title="Bring your money together."
                    detail="Connect a supported bank, or add an account and import a statement. Your plan stays on this device."
                    action={
                      <button
                        className="btn primary"
                        onClick={() => setModal("connect")}
                      >
                        <Landmark size={17} />
                        Connect your bank
                      </button>
                    }
                  />
                </section>
              )}
              <div className="connection-note">
                <LockKeyhole size={20} />
                <div>
                  <strong>Connection is optional. Clarity isn&apos;t.</strong>
                  <p>
                    Connected imports pass through Plaid and your connector.
                    Your budget and decisions are stored in this browser. Manual
                    accounts work without a bank connection.
                  </p>
                </div>
              </div>
              {bankStatus?.connected && (
                <button
                  className="btn secondary"
                  disabled={bankBusy}
                  onClick={syncBank}
                >
                  {bankBusy ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : (
                    <ArrowDownToLine size={16} />
                  )}
                  Refresh connected accounts
                </button>
              )}
              {bankError && <p className="form-error">{bankError}</p>}
            </>
          )}
          {page === "Settings" && (
            <div className="settings-grid">
              <section className="panel settings-panel">
                <div className="section-heading">
                  <h2>Your data belongs with you.</h2>
                  <Fingerprint size={23} />
                </div>
                <p>
                  Your workspace is saved in this browser on this device. Export
                  regular backups; clearing browser storage removes this copy.
                  Local browser storage is not encrypted.
                </p>
                <div className="setting-row">
                  <div>
                    <strong>Export your workspace</strong>
                    <span>
                      Accounts, history, commitments, and preferences.
                    </span>
                  </div>
                  <button className="btn secondary" onClick={backup}>
                    <Download size={15} />
                    Export
                  </button>
                </div>
                <div className="setting-row">
                  <div>
                    <strong>Restore a backup</strong>
                    <span>
                      Replace this workspace with a Selmio JSON backup.
                    </span>
                  </div>
                  <button
                    className="btn secondary"
                    onClick={() => restoreRef.current?.click()}
                  >
                    <FileUp size={15} />
                    Restore
                  </button>
                </div>
                <div className="setting-row">
                  <div>
                    <strong>Explore the demo</strong>
                    <span>
                      Switch to sample money. Export your current work first.
                    </span>
                  </div>
                  <button
                    className="btn secondary"
                    onClick={() => {
                      if (
                        workspace.mode === "personal" &&
                        !window.confirm(
                          "Switch to the demo? Export a backup first to keep your current workspace.",
                        )
                      )
                        return;
                      setWorkspace(createDemoWorkspace());
                      const canSave = captureStorageBaseline();
                      setStorageError(false);
                      notify(
                        canSave
                          ? "You're exploring sample data."
                          : `You're exploring sample data. ${unavailableStorageMessage}`,
                      );
                    }}
                  >
                    Open demo
                  </button>
                </div>
              </section>
              <section className="panel settings-panel">
                <span className="clarity-icon">
                  <GitBranch size={23} />
                </span>
                <h2>Open by nature.</h2>
                <p>
                  Selmio is an open-source project under the MIT license. Built
                  around transparent calculations, personal choice, and a little
                  more breathing room.
                </p>
                <div className="brand-mini">
                  {/* eslint-disable-next-line @next/next/no-img-element -- Local offline SVG; no optimizer is needed. */}
                  <img src="/brand/selmio-mark.svg" alt="" />
                  <strong>selmio.</strong>
                  <span>Know what fits.</span>
                </div>
                <span className="pill">Early development · v0.1</span>
                <p className="fine-print">
                  This release models confirmed commitments and explicit
                  alternatives. It does not automatically discover every
                  obligation or implement the proposed research algorithm.
                </p>
              </section>
              <section className="panel settings-panel">
                <h2>Bank connections</h2>
                <p>
                  Use the managed-style Plaid flow when a connector is
                  configured. Self-hosters can configure their own connector and
                  credentials.
                </p>
                <button
                  className="btn primary"
                  onClick={() => setModal("connect")}
                >
                  <Landmark size={17} />
                  Manage connections
                </button>
              </section>
            </div>
          )}
          <footer className="page-footer">
            <span>
              {/* eslint-disable-next-line @next/next/no-img-element -- Local offline SVG; no optimizer is needed. */}
              <img src="/brand/selmio-mark.svg" alt="" />A little more room for
              living.
            </span>
            <span>
              <LockKeyhole size={12} />
              Your local workspace <span className="footer-dot">·</span> USD
            </span>
          </footer>
        </main>
      </div>
      <button className="floating-whatif" onClick={() => setModal("decision")}>
        <Sparkles size={17} />
        Can I afford it?
        <ArrowUpRight size={14} />
      </button>
      {toast && (
        <div className="toast" role="status">
          <CheckCheck size={17} />
          {toast}
          <button aria-label="Dismiss message" onClick={() => setToast("")}>
            <X size={15} />
          </button>
        </div>
      )}
      <input
        ref={restoreRef}
        hidden
        type="file"
        accept="application/json,.json"
        onChange={(e) => void restore(e.target.files?.[0])}
      />
      {modal === "decision" && (
        <Modal
          title="What if you went for it?"
          eyebrow="MAKE ROOM FOR A POSSIBILITY"
          onClose={() => setModal(null)}
          wide
        >
          <p className="modal-intro">
            Try a purchase. See what it changes before you commit.
          </p>
          {workspace.accounts.filter((a) => a.type !== "credit").length ? (
            <>
              <div className="decision-inputs">
                <label className="field-label">
                  I&apos;d like to spend
                  <div className="currency-field large">
                    <span>$</span>
                    <input
                      aria-label="Purchase amount"
                      value={purchaseAmount}
                      onChange={(e) => setPurchaseAmount(e.target.value)}
                      inputMode="decimal"
                    />
                  </div>
                </label>
                <label className="field-label">
                  On this date
                  <input
                    className="form-input"
                    type="date"
                    value={effectivePurchaseDate}
                    min={asOfDate}
                    max={base?.endDate ?? summary.horizonEndDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                  />
                </label>
              </div>
              <label className="field-label">
                From this account
                <select
                  className="form-input"
                  value={accountId}
                  onChange={(e) => setSelectedAccount(e.target.value)}
                >
                  {workspace.accounts
                    .filter((a) => a.type !== "credit")
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </label>
              {decision ? (
                <>
                  <div className={`decision-result ${decision.status}`}>
                    <span className="result-icon">
                      {decision.status === "fits" ? (
                        <Check size={22} />
                      ) : decision.status === "uncertain" ? (
                        <CircleHelp size={22} />
                      ) : (
                        <Eye size={22} />
                      )}
                    </span>
                    <div>
                      <h3>
                        {decision.status === "fits"
                          ? "There’s room in this plan."
                          : decision.status === "uncertain"
                            ? "One detail could change the answer."
                            : "This would dip into your buffer."}
                      </h3>
                      <p>
                        {decision.status === "fits"
                          ? `Your lowest projected balance stays at ${currency(decision.lowestConservativeCents, true)}, above your ${currency(workspace.bufferCents)} buffer.`
                          : decision.status === "uncertain"
                            ? `Spending room ranges from ${currency(decision.conservativeRoomCents, true)} to ${currency(decision.favorableRoomCents, true)} depending on unresolved details.`
                            : `The projected low is ${currency(decision.lowestConservativeCents, true)} on ${dateLabel(decision.lowestDate)}. Try a smaller amount, a later date, or adjust your commitments.`}
                      </p>
                    </div>
                  </div>
                  <CashChart
                    points={decision.timeline}
                    bufferCents={workspace.bufferCents}
                    scenario
                  />
                  <div className="decision-facts">
                    <span>
                      Protected buffer
                      <strong>{currency(workspace.bufferCents)}</strong>
                    </span>
                    <span>
                      Lowest projected balance
                      <strong>
                        {currency(decision.lowestConservativeCents, true)}
                      </strong>
                    </span>
                    <span>
                      Forecast ends
                      <strong>{dateLabel(decision.endDate)}</strong>
                    </span>
                  </div>
                  <details className="assumptions">
                    <summary>
                      What this answer depends on
                      <ChevronDown size={15} />
                    </summary>
                    {decision.explanations.map((e, i) => (
                      <p key={i}>{e}</p>
                    ))}
                    {decision.warnings.map((w, i) => (
                      <p key={i} className="warning-text">
                        {w}
                      </p>
                    ))}
                  </details>
                  <div className="modal-actions">
                    <button
                      className="btn secondary"
                      onClick={() => {
                        downloadFile(
                          `selmio-decision-${effectivePurchaseDate}.json`,
                          JSON.stringify(
                            {
                              createdAt: new Date().toISOString(),
                              purchase: {
                                amountCents: purchaseCents,
                                date: effectivePurchaseDate,
                                accountId,
                              },
                              decision,
                            },
                            null,
                            2,
                          ),
                        );
                        notify(
                          "Decision details exported with the current assumptions.",
                        );
                      }}
                    >
                      <Download size={16} />
                      Save the calculation
                    </button>
                    {decision.status === "uncertain" && (
                      <button
                        className="btn primary"
                        onClick={() => setModal("review")}
                      >
                        Clear up the details
                        <ArrowRight size={15} />
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <p className="form-error">
                  Enter a valid amount and a date within your forecast.
                </p>
              )}
            </>
          ) : (
            <Empty
              title="First, a place to start."
              detail="Add your checking account and a starting balance to explore a purchase."
              action={
                <button
                  className="btn primary"
                  onClick={() => setModal("account")}
                >
                  Add an account
                  <ArrowRight size={16} />
                </button>
              }
            />
          )}
        </Modal>
      )}
      {modal === "calculation" && (
        <Modal
          title="Here’s where the number comes from."
          eyebrow="CLEAR NUMBERS. VISIBLE ASSUMPTIONS."
          onClose={() => setModal(null)}
        >
          <div className="calculation-total">
            <span>Estimated room to spend</span>
            <strong>{currency(room)}</strong>
            <small>
              Through {dateLabel(base?.endDate ?? summary.horizonEndDate)} ·{" "}
              {currentAccount?.name ?? "No account selected"}
            </small>
          </div>
          <div className="calculation-row">
            <span>Starting account balance</span>
            <strong>{currency(currentAccount?.balanceCents ?? 0)}</strong>
          </div>
          <div className="calculation-row">
            <span>Confirmed planned outgoings</span>
            <strong>{currency(totalBills)}</strong>
          </div>
          <div className="calculation-row">
            <span>Protected cash buffer</span>
            <strong>{currency(workspace.bufferCents)}</strong>
          </div>
          <p className="fine-print">
            Spending room is the lowest projected headroom across the forecast,
            accounting for the dates of payments and expected income. It is not
            simply the sum of the rows above.
          </p>
          <div className="assumption-list">
            {base?.explanations.map((text, i) => (
              <p key={i}>
                <Check size={14} />
                {text}
              </p>
            ))}
            {base?.warnings.map((text, i) => (
              <p key={i}>
                <CircleHelp size={14} />
                {text}
              </p>
            ))}
          </div>
          <button
            className="btn primary full"
            onClick={() => {
              setModal(null);
              navigate("Your plan");
            }}
          >
            Adjust your plan
            <ArrowRight size={16} />
          </button>
        </Modal>
      )}
      {modal === "review" && (
        <Modal
          title={
            review
              ? "A small detail. A clearer picture."
              : "You're all caught up."
          }
          eyebrow="A MOMENT OF CLARITY"
          onClose={() => setModal(null)}
        >
          {review ? (
            <>
              <div className="review-question">
                <span className="clarity-icon">
                  <ArrowLeftRight size={22} />
                </span>
                <h3>{review.title}</h3>
                <p>{review.detail}</p>
                <span className="pill amber">
                  Up to {currency(review.amountCents)} of uncertainty
                </span>
              </div>
              <div className="review-options">
                {review.options.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => {
                      setWorkspace((w) =>
                        resolveAmbiguity(w, review.id, option.id),
                      );
                      notify(
                        "That detail is resolved. Your plan has been recalculated.",
                      );
                    }}
                  >
                    <div>
                      <strong>{option.label}</strong>
                      <span>{option.detail}</span>
                    </div>
                    <ChevronRight size={19} />
                  </button>
                ))}
              </div>
              <p className="fine-print">
                Only confirm what you know. You can leave this unresolved and
                keep both possibilities in your forecast.
              </p>
              <button className="text-action" onClick={() => setModal(null)}>
                I&apos;ll come back to this
                <ArrowRight size={15} />
              </button>
            </>
          ) : (
            <Empty
              title="A little less guesswork."
              detail="There are no unresolved alternatives in your current plan. This does not verify that every real-world obligation has been included."
              action={
                <button className="btn primary" onClick={() => setModal(null)}>
                  Back to your space
                  <ArrowRight size={16} />
                </button>
              }
            />
          )}
          {workspace.ambiguities.some((a) => a.resolvedOptionId) && (
            <div className="reviewed-items">
              <h3>Previously reviewed</h3>
              {workspace.ambiguities
                .filter((a) => a.resolvedOptionId)
                .map((item) => (
                  <div key={item.id}>
                    <span>
                      <strong>{item.title}</strong>
                      <small>
                        {
                          item.options.find(
                            (o) => o.id === item.resolvedOptionId,
                          )?.label
                        }
                      </small>
                    </span>
                    <button
                      className="text-action"
                      onClick={() => {
                        setReviewId(item.id);
                        setWorkspace((w) => ({
                          ...w,
                          ambiguities: w.ambiguities.map((a) =>
                            a.id === item.id
                              ? { ...a, resolvedOptionId: undefined }
                              : a,
                          ),
                        }));
                      }}
                    >
                      Review again
                      <ArrowRight size={14} />
                    </button>
                  </div>
                ))}
            </div>
          )}
        </Modal>
      )}
      {modal === "connect" && (
        <Modal
          title="Bring your money together."
          eyebrow="ONE CONNECTION. A CLEARER PICTURE."
          onClose={() => setModal(null)}
        >
          <p className="modal-intro">
            Connect your bank securely through Plaid, or start with a statement.
            Your budget stays in your local workspace.
          </p>
          <div className="bank-art">
            <Landmark size={35} />
            <span>•••</span>
            {/* eslint-disable-next-line @next/next/no-img-element -- Local offline SVG; no optimizer is needed. */}
            <img src="/brand/selmio-mark.svg" alt="Selmio" />
          </div>
          <div className="connection-benefits">
            <span>
              <Check size={15} />
              Choose the accounts you share
            </span>
            <span>
              <Check size={15} />
              Import balances and transactions
            </span>
            <span>
              <Check size={15} />
              Disconnect whenever you choose
            </span>
          </div>
          {bankStatus === null ? (
            <div className="connector-status">
              <LoaderCircle size={16} className="spin" />
              Checking the connector…
            </div>
          ) : !bankStatus.configured || !bankStatus.available ? (
            <div className="connector-status">
              <CircleHelp size={18} />
              <div>
                <strong>Bank connection needs setup</strong>
                <p>
                  {
                    "Bank connections are not enabled in this installation yet. You can add an account or import a statement now."
                  }
                </p>
              </div>
            </div>
          ) : (
            <div
              className={`connector-status ${bankStatus.environment === "sandbox" ? "" : "is-ready"}`}
            >
              <ShieldCheck size={18} />
              <div>
                <strong>
                  {bankStatus.environment === "sandbox"
                    ? "Plaid Sandbox · test accounts only"
                    : "Ready to connect"}
                </strong>
                <p>
                  {bankStatus.environment === "sandbox"
                    ? "This environment uses simulated accounts. Real banks require production configuration."
                    : "Bank data passes through Plaid and the connector before reaching this device."}
                </p>
              </div>
            </div>
          )}
          {bankError && <p className="form-error">{bankError}</p>}
          <button
            className="btn primary full"
            disabled={
              bankBusy || !bankStatus?.configured || !bankStatus?.available
            }
            onClick={() => void connectBank()}
          >
            {bankBusy ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <Landmark size={17} />
            )}
            Connect with Plaid
            <ArrowRight size={16} />
          </button>
          <div className="alternative-divider">
            <span>or start your way</span>
          </div>
          <div className="connection-alternatives">
            <button
              className="btn secondary"
              onClick={() => setModal("import")}
            >
              <FileUp size={17} />
              Import a CSV
            </button>
            <button
              className="btn secondary"
              onClick={() => setModal("account")}
            >
              <Plus size={17} />
              Add manually
            </button>
          </div>
          {bankStatus?.connected && (
            <div className="managed-connections">
              {bankStatus.items?.map((item) => (
                <div key={item.id}>
                  <span>
                    <Landmark size={16} />
                    {item.institutionName}
                  </span>
                  <button
                    className="text-action"
                    disabled={bankBusy}
                    onClick={() => void connectBank(item.id)}
                  >
                    Reconnect
                  </button>
                  <button
                    className="text-action"
                    disabled={bankBusy}
                    onClick={async () => {
                      setBankBusy(true);
                      try {
                        await bankRequest("disconnect", { item_id: item.id });
                        await refreshBankStatus();
                        notify(
                          "Bank access disconnected. Previously imported local records remain.",
                        );
                      } catch (e) {
                        setBankError(
                          e instanceof Error
                            ? e.message
                            : "Could not disconnect.",
                        );
                      } finally {
                        setBankBusy(false);
                      }
                    }}
                  >
                    Disconnect
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="fine-print centered">
            <LockKeyhole size={12} />
            Your bank login is handled by Plaid and your institution.
          </p>
        </Modal>
      )}
      {modal === "account" && (
        <Modal
          title={
            editingAccount
              ? "Keep your picture current."
              : "A place for your money."
          }
          eyebrow={editingAccount ? "UPDATE YOUR ACCOUNT" : "ADD AN ACCOUNT"}
          onClose={() => {
            setModal(null);
            setEditingAccount(null);
          }}
        >
          <AccountForm
            initial={editingAccount}
            onSave={(account) => {
              setWorkspace((w) => {
                if (editingAccount)
                  return {
                    ...w,
                    accounts: w.accounts.map((a) =>
                      a.id === account.id ? account : a,
                    ),
                  };
                const next = w.mode === "demo" ? createEmptyWorkspace() : w;
                return {
                  ...next,
                  accounts: [...next.accounts, account],
                  mode: "personal",
                };
              });
              setSelectedAccount(account.id);
              if (!editingAccount) setPurchaseDate(today());
              setEditingAccount(null);
              setModal(null);
              notify(
                editingAccount
                  ? "Account updated with a new balance snapshot."
                  : "Account added. Next, add upcoming bills and paydays to your plan.",
              );
            }}
          />
        </Modal>
      )}
      {modal === "commitment" && (
        <Modal
          title={
            editingCommitment
              ? "A little adjustment."
              : "Make room for what matters."
          }
          eyebrow={editingCommitment ? "EDIT YOUR PLAN" : "ADD TO YOUR PLAN"}
          onClose={() => setModal(null)}
        >
          {workspace.accounts.filter((a) => a.type !== "credit").length ? (
            <CommitmentForm
              accounts={workspace.accounts.filter((a) => a.type !== "credit")}
              asOfDate={asOfDate}
              initial={editingCommitment}
              onSave={(c) => {
                setWorkspace((w) => ({
                  ...w,
                  commitments: editingCommitment
                    ? w.commitments.map((x) => (x.id === c.id ? c : x))
                    : [...w.commitments, c],
                }));
                setModal(null);
                notify("Your plan has been updated.");
              }}
            />
          ) : (
            <Empty
              title="Start with an account."
              detail="Choose where your payments and income will happen."
              action={
                <button
                  className="btn primary"
                  onClick={() => setModal("account")}
                >
                  Add an account
                </button>
              }
            />
          )}
        </Modal>
      )}
      {modal === "import" && (
        <Modal
          title="A fresh perspective on your statement."
          eyebrow="IMPORT A CSV"
          onClose={() => setModal(null)}
        >
          {workspace.accounts.length ? (
            <ImportForm
              accounts={workspace.accounts}
              onImport={(text, account) => {
                const result = importTransactionsCsv(workspace, text, account);
                if (result.errors.length)
                  throw new Error(
                    result.errors
                      .map((e) => `Row ${e.row}: ${e.message}`)
                      .slice(0, 3)
                      .join(" "),
                  );
                setWorkspace(result.workspace);
                notify(
                  `${result.added} transactions imported. ${result.skipped} duplicates skipped.${result.warnings.length ? " " + result.warnings[0] : ""}`,
                );
                setModal(null);
              }}
            />
          ) : (
            <Empty
              title="Give your statement a home."
              detail="Add an account with its current balance first. Historical imports do not change that balance."
              action={
                <button
                  className="btn primary"
                  onClick={() => setModal("account")}
                >
                  Add an account
                  <ArrowRight size={16} />
                </button>
              }
            />
          )}
        </Modal>
      )}
    </div>
  );
}

function AccountForm({
  onSave,
  initial,
}: {
  onSave: (a: Account) => void;
  initial?: Account | null;
}) {
  const [error, setError] = useState("");
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    try {
      const f = new FormData(e.currentTarget);
      const type = f.get("type") as Account["type"];
      const raw = String(f.get("balance")).trim();
      const cents =
        (raw.startsWith("-") ? -1 : 1) * parseMoney(raw.replace(/^-/, ""));
      const name = String(f.get("name")).trim();
      if (!name) throw new Error("Give this account a name.");
      if (type === "credit" && cents < 0)
        throw new Error("For a card, enter the positive amount you owe.");
      onSave({
        id: initial?.id ?? `manual:${id()}`,
        name,
        institution: String(f.get("institution")).trim() || "Manual account",
        type,
        balanceCents: type === "credit" ? -cents : cents,
        lastUpdated:
          initial && initial.id.indexOf("manual:") !== 0
            ? initial.lastUpdated
            : new Date().toISOString(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please check your details.");
    }
  };
  return (
    <form className="form-stack" onSubmit={submit}>
      <label className="field-label">
        Account name
        <input
          className="form-input"
          name="name"
          required
          maxLength={100}
          defaultValue={initial?.name}
          placeholder="Everyday checking"
        />
      </label>
      <div className="form-two">
        <label className="field-label">
          Institution
          <input
            className="form-input"
            name="institution"
            maxLength={100}
            defaultValue={initial?.institution}
            placeholder="Your bank"
          />
        </label>
        <label className="field-label">
          Account type
          <select
            className="form-input"
            name="type"
            defaultValue={initial?.type ?? "checking"}
          >
            <option value="checking">Checking</option>
            <option value="savings">Savings</option>
            <option value="credit">Credit card</option>
          </select>
        </label>
      </div>
      <label className="field-label">
        Current balance
        <div className="currency-field">
          <span>$</span>
          <input
            name="balance"
            required
            defaultValue={
              initial
                ? (initial.type === "credit"
                    ? -initial.balanceCents
                    : initial.balanceCents) / 100
                : undefined
            }
            placeholder="0.00"
            inputMode="decimal"
            pattern="-?[0-9]+(\.[0-9]{1,2})?"
          />
        </div>
      </label>
      <p className="fine-print">
        Use the balance shown by your bank today. For a credit card, enter the
        positive amount you owe. Historical transactions won&apos;t be deducted from
        this balance again.
      </p>
      {error && <p className="form-error">{error}</p>}
      <button className="btn primary full" type="submit">
        {initial ? "Update account" : "Add account"}
        <ArrowRight size={16} />
      </button>
    </form>
  );
}
function CommitmentForm({
  accounts,
  asOfDate,
  initial,
  onSave,
}: {
  accounts: Account[];
  asOfDate: string;
  initial: Commitment | null;
  onSave: (c: Commitment) => void;
}) {
  const [error, setError] = useState("");
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    try {
      const f = new FormData(e.currentTarget);
      const name = String(f.get("name")).trim();
      if (!name) throw new Error("Give this commitment a name.");
      onSave({
        id: initial?.id ?? id(),
        name,
        amountCents: parseMoney(String(f.get("amount"))),
        dueDate: String(f.get("date")),
        accountId: String(f.get("account")),
        kind: f.get("kind") as Commitment["kind"],
        confirmed: f.get("confirmed") === "on",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check your details.");
    }
  };
  return (
    <form className="form-stack" onSubmit={submit}>
      <label className="field-label">
        What&apos;s it for?
        <input
          className="form-input"
          required
          name="name"
          maxLength={100}
          defaultValue={initial?.name}
          placeholder="Rent, payday, or a little getaway"
        />
      </label>
      <div className="form-two">
        <label className="field-label">
          Amount
          <div className="currency-field">
            <span>$</span>
            <input
              name="amount"
              required
              defaultValue={initial ? initial.amountCents / 100 : undefined}
              inputMode="decimal"
              placeholder="0.00"
            />
          </div>
        </label>
        <label className="field-label">
          Date
          <input
            type="date"
            name="date"
            className="form-input"
            required
            defaultValue={initial?.dueDate ?? asOfDate}
            min={asOfDate}
          />
        </label>
      </div>
      <div className="form-two">
        <label className="field-label">
          Type
          <select
            className="form-input"
            name="kind"
            defaultValue={initial?.kind ?? "bill"}
          >
            <option value="bill">Bill or planned spending</option>
            <option value="income">Expected income</option>
            <option value="goal">Goal contribution</option>
          </select>
        </label>
        <label className="field-label">
          Account
          <select
            className="form-input"
            name="account"
            defaultValue={initial?.accountId ?? accounts[0]?.id}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="check-label">
        <input
          type="checkbox"
          name="confirmed"
          defaultChecked={initial?.confirmed ?? true}
        />
        <span>I&apos;ve confirmed this amount and date.</span>
      </label>
      <p className="fine-print">
        Expected income is a planning assumption, even when confirmed.
        Unconfirmed income is excluded; estimated outgoings remain protected.
        Add separate occurrences for recurring payments.
      </p>
      {error && <p className="form-error">{error}</p>}
      <button className="btn primary full" type="submit">
        {initial ? "Save changes" : "Add to your plan"}
        <ArrowRight size={16} />
      </button>
    </form>
  );
}
function ImportForm({
  accounts,
  onImport,
}: {
  accounts: Account[];
  onImport: (text: string, accountId: string) => void;
}) {
  const [account, setAccount] = useState(accounts[0]?.id ?? ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const read = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      if (file.size > 5000000)
        throw new Error("Choose a CSV smaller than 5 MB.");
      onImport(await file.text(), account);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not read that statement.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="form-stack">
      <p className="modal-intro">
        Import transactions into an account. Repeated imports skip matching
        source IDs.
      </p>
      <label className="field-label">
        Import into
        <select
          className="form-input"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label className="file-drop">
        <FileUp size={30} />
        <strong>
          {busy ? "Reading your statement…" : "Choose your CSV statement"}
        </strong>
        <span>CSV up to 5 MB · processed on this device</span>
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={(e) => void read(e.target.files?.[0])}
        />
      </label>
      <div className="csv-example">
        <strong>Simple, familiar columns</strong>
        <code>
          date,description,amount,category
          <br />
          2026-11-07,Coffee,-4.50,Dining
          <br />
          2026-11-06,Payday,2800,Income
        </code>
        <p>
          Dates: YYYY-MM-DD or MM/DD/YYYY. Negative amounts are spending;
          positive amounts are incoming. Quoted fields are supported.
        </p>
      </div>
      {error && <p className="form-error">{error}</p>}
      <button
        className="text-action"
        onClick={() =>
          downloadFile(
            "selmio-example.csv",
            "date,description,amount,category\n2026-11-07,Coffee,-4.50,Dining\n2026-11-06,Payday,2800.00,Income\n",
            "text/csv",
          )
        }
      >
        <Download size={15} />
        Download an example
      </button>
    </div>
  );
}
