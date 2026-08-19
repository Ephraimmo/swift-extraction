import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  coupons,
  getRestaurant,
  placeFirebaseOrder,
  type DeliveryAddress,
  type Dish,
  type FirebaseOrder,
  type OrderLine,
  type OrderLineAddon,
  type OrderLineVariant,
  type OrderStatus,
  type PaymentMethod,
  type TimelineEvent,
} from "./data";
import { useAuth } from "./auth";
import { get, getDb, ref, rtdbSubscribe, set } from "./firebase";

export type CartLine = {
  lineId: string;
  dishId: string;
  restaurantSlug: string;
  name: string;
  image: string;
  basePrice: number;
  unitPrice: number;
  sizeLabel: string;
  variant: OrderLineVariant | null;
  addons: OrderLineAddon[];
  extras: string[];
  removed: string[];
  notes: string;
  qty: number;
};

export type OrderStage =
  | "placed"
  | "pending"
  | "accepted"
  | "preparing"
  | "ready"
  | "assigned"
  | "picked_up"
  | "on_the_way"
  | "delivered"
  | "cancelled"
  | "refunded";

export type Order = FirebaseOrder & {
  lines: CartLine[];
};

type CartState = {
  lines: CartLine[];
  restaurantSlug: string | null;
  tip: number;
  couponCode: string | null;
  addLine: (input: {
    dish: Dish;
    restaurantSlug: string;
    sizeId: string;
    extraIds: string[];
    removed: string[];
    notes: string;
    qty: number;
  }) => { replaced: boolean };
  setQty: (lineId: string, qty: number) => void;
  removeLine: (lineId: string) => void;
  clear: () => void;
  setTip: (tip: number) => void;
  applyCoupon: (code: string) => boolean;
  removeCoupon: () => void;
  itemCount: number;
  subtotal: number;
  deliveryFee: number;
  serviceFee: number;
  discount: number;
  total: number;
  orders: FirebaseOrder[];
  placedOrderIds: string[];
  placeOrder: (input: {
    address: DeliveryAddress | string;
    mode: "delivery" | "pickup";
    paymentMethod?: PaymentMethod;
    specialInstructions?: string;
  }) => Promise<string>;
  getOrder: (id: string) => FirebaseOrder | undefined;
  /** True while the signed-in customer's saved cart is being loaded from the cloud. */
  syncing: boolean;
  /** "cloud" once the cart is saved to the customer's account, else "local". */
  storage: "cloud" | "local";
};

const CartContext = createContext<CartState | null>(null);

const CART_KEY = "hearth.cart.v2";
const PLACED_ORDERS_KEY = "hearth.placed_orders.v2";

type StoredCart = { lines: CartLine[]; tip: number; couponCode: string | null };

function cartPath(uid: string) {
  return `customerCarts/${uid}`;
}

/** Normalizes cart lines from raw storage. */
function normalizeLines(value: unknown): CartLine[] {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value)
      : [];
  return raw
    .filter((l): l is Record<string, unknown> => !!l && typeof l === "object")
    .map((l) => ({
      lineId: String(l["lineId"] ?? `line-${Math.random().toString(36).slice(2)}`),
      dishId: String(l["dishId"] ?? ""),
      restaurantSlug: String(l["restaurantSlug"] ?? ""),
      name: String(l["name"] ?? "Item"),
      image: String(l["image"] ?? ""),
      basePrice: Number(l["basePrice"] ?? l["unitPrice"] ?? 0),
      unitPrice: Number(l["unitPrice"] ?? 0),
      sizeLabel: String(l["sizeLabel"] ?? "Regular"),
      variant: (l["variant"] as OrderLineVariant) ?? null,
      addons: Array.isArray(l["addons"]) ? (l["addons"] as OrderLineAddon[]) : [],
      extras: Array.isArray(l["extras"]) ? (l["extras"] as string[]) : [],
      removed: Array.isArray(l["removed"]) ? (l["removed"] as string[]) : [],
      notes: String(l["notes"] ?? ""),
      qty: Number(l["qty"] ?? 1),
    }));
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { user, hydrated: authHydrated } = useAuth();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [tip, setTip] = useState(0);
  const [couponCode, setCouponCode] = useState<string | null>(null);
  const [placedOrderIds, setPlacedOrderIds] = useState<string[]>([]);
  const [firebaseOrders, setFirebaseOrders] = useState<Record<string, FirebaseOrder>>({});
  const [hydrated, setHydrated] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);

  // Initialize from local storage
  useEffect(() => {
    const cart = read<StoredCart>(CART_KEY, {
      lines: [],
      tip: 0,
      couponCode: null,
    });
    setLines(cart.lines ?? []);
    setTip(cart.tip ?? 0);
    setCouponCode(cart.couponCode ?? null);
    setPlacedOrderIds(read<string[]>(PLACED_ORDERS_KEY, []));
    setHydrated(true);
  }, []);

  // Listen to all orders from Firebase Realtime Database
  useEffect(() => {
    if (!hydrated) return;
    const unsubscribe = rtdbSubscribe<Record<string, FirebaseOrder>>("orders", (all) => {
      setFirebaseOrders(all ?? {});
    });
    return () => unsubscribe();
  }, [hydrated]);

  // Load the signed-in customer's cart from Firebase
  useEffect(() => {
    if (!hydrated || !authHydrated) return;
    if (!user) {
      setCloudReady(false);
      setSyncing(false);
      return;
    }
    const db = getDb();
    if (!db) return;
    let cancelled = false;
    setSyncing(true);
    void get(ref(db, cartPath(user.uid)))
      .then((snap) => {
        if (cancelled) return;
        const savedRaw = (snap.val() ?? null) as
          (Omit<StoredCart, "lines"> & { lines?: unknown }) | null;
        const saved = savedRaw ? { ...savedRaw, lines: normalizeLines(savedRaw.lines) } : null;
        setLines((current) => {
          if (current.length > 0) return current;
          return saved?.lines ?? [];
        });
        if (saved && (saved.lines?.length ?? 0) > 0) {
          setTip((current) => (current === 0 ? (saved.tip ?? 0) : current));
          setCouponCode((current) => current ?? saved.couponCode ?? null);
        }
      })
      .catch((error: unknown) => {
        console.warn("[cart] could not load saved cart", error);
      })
      .finally(() => {
        if (cancelled) return;
        setSyncing(false);
        setCloudReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user, hydrated, authHydrated]);

  // Persist cart to localStorage
  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(CART_KEY, JSON.stringify({ lines, tip, couponCode }));
  }, [lines, tip, couponCode, hydrated]);

  // Persist placed orders IDs to localStorage
  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(PLACED_ORDERS_KEY, JSON.stringify(placedOrderIds));
  }, [placedOrderIds, hydrated]);

  // Mirror cart to user's Firebase cart node when signed in
  useEffect(() => {
    if (!user || !cloudReady) return;
    const db = getDb();
    if (!db) return;
    const timer = window.setTimeout(() => {
      void set(ref(db, cartPath(user.uid)), {
        lines,
        tip,
        couponCode,
        updatedAt: new Date().toISOString(),
      }).catch((error: unknown) => console.warn("[cart] could not save cart", error));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [user, cloudReady, lines, tip, couponCode]);

  const restaurantSlug = lines[0]?.restaurantSlug ?? null;

  const addLine = useCallback<CartState["addLine"]>(
    ({ dish, restaurantSlug: slug, sizeId, extraIds, removed, notes, qty }) => {
      const size = dish.sizes.find((s) => s.id === sizeId) ?? dish.sizes[0];
      const selectedExtras = dish.extras.filter((e) => extraIds.includes(e.id));
      const extrasPrice = selectedExtras.reduce((sum, e) => sum + e.price, 0);
      const delta = size?.delta ?? 0;
      const unitPrice = Math.round((dish.price + delta + extrasPrice) * 100) / 100;

      const variant: OrderLineVariant | null = size
        ? { id: size.id, name: size.label, price_delta: size.delta }
        : null;

      const addons: OrderLineAddon[] = selectedExtras.map((e) => ({
        id: e.id,
        name: e.label,
        price: e.price,
        quantity: 1,
      }));

      const line: CartLine = {
        lineId: `${dish.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        dishId: dish.id,
        restaurantSlug: slug,
        name: dish.name,
        image: dish.image,
        basePrice: dish.price,
        unitPrice,
        sizeLabel: size?.label ?? "Regular",
        variant,
        addons,
        extras: selectedExtras.map((e) => e.label),
        removed,
        notes,
        qty,
      };

      let replaced = false;
      setLines((prev) => {
        if (prev.length && prev[0]!.restaurantSlug !== slug) {
          replaced = true;
          return [line];
        }
        return [...prev, line];
      });
      return { replaced };
    },
    [],
  );

  const setQtyFn = useCallback((lineId: string, qty: number) => {
    setLines((prev) =>
      qty <= 0
        ? prev.filter((l) => l.lineId !== lineId)
        : prev.map((l) => (l.lineId === lineId ? { ...l, qty } : l)),
    );
  }, []);

  const removeLine = useCallback((lineId: string) => {
    setLines((prev) => prev.filter((l) => l.lineId !== lineId));
  }, []);

  const clear = useCallback(() => {
    setLines([]);
    setTip(0);
    setCouponCode(null);
  }, []);

  const applyCoupon = useCallback((code: string) => {
    const key = code.trim().toUpperCase();
    if (!coupons[key]) return false;
    setCouponCode(key);
    return true;
  }, []);

  const subtotal = Math.round(lines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0) * 100) / 100;
  const itemCount = lines.reduce((sum, l) => sum + l.qty, 0);
  const restaurant = restaurantSlug ? getRestaurant(restaurantSlug) : undefined;
  const baseDelivery = restaurant?.deliveryFee ?? 25;
  const coupon = couponCode ? coupons[couponCode] : undefined;
  const deliveryFee = coupon?.type === "delivery" ? 0 : baseDelivery;
  const serviceFee = subtotal > 0 ? Math.round(subtotal * 0.05 * 100) / 100 : 0;
  const discount =
    coupon?.type === "percent"
      ? Math.min(100, Math.round(subtotal * (coupon.value / 100) * 100) / 100)
      : coupon?.type === "fixed"
        ? Math.min(coupon.value, subtotal)
        : 0;
  const total = Math.max(
    0,
    Math.round((subtotal + deliveryFee + serviceFee + tip - discount) * 100) / 100,
  );

  // Active customer orders merged from live Firebase
  const orders = useMemo<FirebaseOrder[]>(() => {
    const all = Object.values(firebaseOrders);
    const placedSet = new Set(placedOrderIds);
    return all
      .filter((o) => {
        if (!o || !o.id) return false;
        if (user && o.customer_id === user.uid) return true;
        if (user && o.customer_email && o.customer_email.toLowerCase() === user.email.toLowerCase())
          return true;
        if (placedSet.has(o.id)) return true;
        return false;
      })
      .sort((a, b) =>
        (b.placed_at || b.created_at || "").localeCompare(a.placed_at || a.created_at || ""),
      );
  }, [firebaseOrders, user, placedOrderIds]);

  const placeOrder = useCallback<CartState["placeOrder"]>(
    async ({ address, mode, paymentMethod = "card", specialInstructions }) => {
      const rest = restaurantSlug ? getRestaurant(restaurantSlug) : undefined;
      const deliveryAddress: DeliveryAddress =
        typeof address === "string"
          ? {
              label: mode === "pickup" ? "Pickup" : "Delivery",
              street: address,
              city: "Johannesburg",
              postal_code: "2000",
              latitude: -26.2041,
              longitude: 28.0473,
              notes: specialInstructions || null,
            }
          : address;

      const items = lines.map((l) => ({
        item_id: l.dishId || l.lineId,
        name: l.name,
        quantity: l.qty,
        unit_price: l.basePrice || l.unitPrice,
        notes: l.notes || null,
        variant: l.variant,
        addons: l.addons,
      }));

      const finalDeliveryFee = mode === "pickup" ? 0 : deliveryFee;

      const orderId = await placeFirebaseOrder({
        restaurant: {
          id: rest?.slug || restaurantSlug || "restaurant-main",
          name: rest?.name || "Restaurant Kitchen",
          image: rest?.image || null,
        },
        customer: {
          uid: user?.uid ?? null,
          name: user?.name || "Customer",
          phone: user?.phone || "+27 82 555 0100",
          email: user?.email || "customer@hearth.app",
        },
        items,
        delivery_address: mode === "pickup" ? null : deliveryAddress,
        special_instructions: specialInstructions || null,
        payment_method: paymentMethod,
        payment_status: paymentMethod === "cash" ? "pending" : "paid",
        coupon_code: couponCode,
        discount,
        tip,
        delivery_fee: finalDeliveryFee,
      });

      setPlacedOrderIds((prev) => [orderId, ...prev]);
      clear();
      return orderId;
    },
    [lines, restaurantSlug, user, deliveryFee, discount, tip, couponCode, clear],
  );

  const getOrder = useCallback(
    (id: string) => {
      return firebaseOrders[id] ?? orders.find((o) => o.id === id);
    },
    [firebaseOrders, orders],
  );

  const value = useMemo<CartState>(
    () => ({
      lines,
      restaurantSlug,
      tip,
      couponCode,
      addLine,
      setQty: setQtyFn,
      removeLine,
      clear,
      setTip,
      applyCoupon,
      removeCoupon: () => setCouponCode(null),
      itemCount,
      subtotal,
      deliveryFee,
      serviceFee,
      discount,
      total,
      orders,
      placedOrderIds,
      placeOrder,
      getOrder,
      syncing,
      storage: user ? "cloud" : "local",
    }),
    [
      lines,
      restaurantSlug,
      tip,
      couponCode,
      addLine,
      setQtyFn,
      removeLine,
      clear,
      applyCoupon,
      itemCount,
      subtotal,
      deliveryFee,
      serviceFee,
      discount,
      total,
      orders,
      placedOrderIds,
      placeOrder,
      getOrder,
      syncing,
      user,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}

export const stageOrder: OrderStage[] = [
  "placed",
  "pending",
  "accepted",
  "preparing",
  "ready",
  "assigned",
  "picked_up",
  "on_the_way",
  "delivered",
];

export const stageCopy: Record<OrderStage, { title: string; detail: string }> = {
  placed: { title: "Order placed", detail: "Sent to the kitchen" },
  pending: { title: "Order pending", detail: "Awaiting restaurant acceptance" },
  accepted: { title: "Restaurant accepted", detail: "Kitchen confirmed your order" },
  preparing: { title: "Preparing food", detail: "Cooking to order" },
  ready: { title: "Ready for pickup", detail: "Packed, sealed and ready" },
  assigned: { title: "Driver assigned", detail: "Driver heading to the restaurant" },
  picked_up: { title: "Driver picked up", detail: "Food collected from kitchen" },
  on_the_way: { title: "On the way", detail: "Driver is en route to you" },
  delivered: { title: "Delivered", detail: "Enjoy your meal!" },
  cancelled: { title: "Order cancelled", detail: "This order was cancelled" },
  refunded: { title: "Order refunded", detail: "Refund has been processed" },
};

/** Derives stage from order status */
export function currentStage(order: FirebaseOrder | undefined | null): OrderStage {
  if (!order) return "placed";
  const st = (order.status || "pending").toLowerCase() as OrderStage;
  if (st === "cancelled" || st === "refunded") return st;
  if (stageOrder.includes(st)) return st;
  return "pending";
}
