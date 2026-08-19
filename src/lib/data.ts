import { rtdbSet } from "./firebase";

/**
 * Shared domain types plus a live registry that Firebase fills at runtime.
 * All monetary values are ZAR as numbers (e.g. 129.50).
 */

export type OrderStatus =
  | "pending" // placed by customer, awaiting restaurant acceptance
  | "accepted" // restaurant accepted the order
  | "preparing" // kitchen is making it
  | "ready" // ready for pickup
  | "assigned" // driver assigned
  | "picked_up" // driver has the food
  | "on_the_way" // out for delivery
  | "delivered"
  | "cancelled"
  | "refunded";

export type PaymentMethod = "card" | "cash" | "wallet" | "eft" | "apple_pay" | "google_pay";

export interface DeliveryAddress {
  label: string | null; // "Home" | "Work" | "Custom" | null
  street: string;
  city: string;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
}

export interface OrderLineVariant {
  id: string; // variant id from menu
  name: string; // e.g. "Large"
  price_delta: number; // added per unit (Rands)
}

export interface OrderLineAddon {
  id: string; // addon id from menu
  name: string; // e.g. "Extra cheese"
  price: number; // per-unit price (Rands)
  quantity: number;
}

export interface OrderLine {
  id: string; // generate client-side (uid("ln"))
  item_id: string; // MenuItem.id from /menus/{rid}/items/{itemId}
  name: string; // snapshot of item.name at order time
  quantity: number;
  unit_price: number; // base item price (no variant/addons) at order time
  line_total: number; // (unit_price + variant.price_delta) * quantity + Σ(addon.price * addon.qty)
  notes: string | null; // special instructions for this line ("No onions")
  variant: OrderLineVariant | null;
  addons: OrderLineAddon[];
}

export interface TimelineEvent {
  id: string;
  status: OrderStatus | "placed" | "note";
  at: string; // ISO timestamp
  note: string | null;
  actor: string | null; // email/uid of who moved the status, or null
}

export interface DriverLiveLocation {
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number;
  updated_at: string;
}

export interface FirebaseOrder {
  id: string; // uid("ord")
  order_number: string; // `FF-${Date.now().toString().slice(-6)}`
  status: OrderStatus; // initial status = "pending"
  placed_at: string; // ISO timestamp
  accepted_at: string | null;
  ready_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  eta_minutes: number | null;
  eta_at: string | null; // ISO for absolute ETA
  subtotal: number; // Σ line.line_total
  delivery_fee: number;
  service_fee: number; // 5% of subtotal, rounded to 2 decimals
  tax: number;
  discount: number; // coupon discount (money off), 0 if none
  tip: number;
  total: number; // subtotal + delivery_fee + service_fee + tax + tip - discount
  coupon_code: string | null;
  payment_method: PaymentMethod;
  payment_status: "pending" | "paid" | "failed" | "refunded";
  delivery_address: DeliveryAddress | null;
  special_instructions: string | null;
  scheduled_for: string | null;

  // Restaurant snapshot (denormalised so console doesn't have to re-fetch)
  restaurant_id: string;
  restaurant_name: string;
  restaurant_image: string | null;

  // Customer snapshot
  customer_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;

  // Driver snapshot
  driver_id: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  driver_photo: string | null;
  driver_rating: number | null;

  created_at: string;
  updated_at: string;
}

export type OptionChoice = { id: string; label: string; delta: number };
export type ExtraChoice = { id: string; label: string; price: number };

export type Dish = {
  id: string;
  name: string;
  description: string;
  price: number;
  image: string;
  popular?: boolean;
  category: string;
  diet?: "veg" | "vegan" | "gf";
  prepMinutes: number;
  calories: number;
  allergens: string[];
  ingredients: string[];
  sizes: OptionChoice[];
  extras: ExtraChoice[];
};

export type Restaurant = {
  slug: string;
  name: string;
  tagline: string;
  cuisines: string[];
  priceBand: "£" | "££" | "£££" | "R" | "RR" | "RRR" | string;
  rating: number;
  reviewCount: number;
  etaMinutes: [number, number];
  deliveryFee: number;
  minOrder: number;
  distanceKm: number;
  image: string;
  badge?: string;
  openNow: boolean;
  hours: string;
  address: string;
  phone: string;
  categories: string[];
  dishes: Dish[];
};

/* ----------------------------- live registry ------------------------------ */

let registry: Restaurant[] = [];

/** Called by the Firebase sync layer whenever restaurant data changes. */
export function registerRestaurants(next: Restaurant[]) {
  registry = next;
}

export function restaurants() {
  return registry;
}

export function getRestaurant(slug: string) {
  return registry.find((r) => r.slug === slug);
}

export function allDishes() {
  return registry.flatMap((r) => r.dishes.map((d) => ({ dish: d, restaurant: r })));
}

export function findDish(dishId: string) {
  return allDishes().find((entry) => entry.dish.id === dishId);
}

export type Coupon = { type: "percent" | "fixed" | "delivery"; value: number };

/** Coupon codes synchronized from Firebase promotions/coupons nodes. */
export const coupons: Record<string, Coupon> = {};

export function registerCoupons(next: Record<string, Coupon>) {
  Object.keys(coupons).forEach((key) => delete coupons[key]);
  Object.assign(coupons, next);
}

/** Formats numbers as South African Rands (ZAR). */
export function money(value: number | undefined | null) {
  const num = typeof value === "number" && !Number.isNaN(value) ? value : 0;
  return `R ${num.toFixed(2)}`;
}

export function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

export async function placeFirebaseOrder(input: {
  restaurant: { id: string; name: string; image: string | null };
  customer: { uid: string | null; name: string; phone: string | null; email: string | null };
  items: Array<{
    item_id: string;
    name: string;
    quantity: number;
    unit_price: number;
    notes: string | null;
    variant: OrderLineVariant | null;
    addons: OrderLineAddon[];
  }>;
  delivery_address: DeliveryAddress | null;
  special_instructions: string | null;
  payment_method: PaymentMethod;
  payment_status: "pending" | "paid";
  coupon_code?: string | null;
  discount?: number;
  tip?: number;
  delivery_fee?: number;
}): Promise<string> {
  const orderId = uid("ord");
  const ts = new Date().toISOString();
  const orderNumber = `FF-${Date.now().toString().slice(-6)}`;

  const lines: Record<string, OrderLine> = {};
  let subtotal = 0;
  for (const it of input.items) {
    const addonTotal = (it.addons || []).reduce(
      (s, a) => s + (a.price || 0) * (a.quantity || 1),
      0,
    );
    const variantDelta = (it.variant?.price_delta ?? 0) * it.quantity;
    const line_total =
      Math.round(((it.unit_price || 0) * it.quantity + addonTotal + variantDelta) * 100) / 100;
    subtotal += line_total;
    const lineId = uid("ln");
    lines[lineId] = { id: lineId, line_total, ...it };
  }
  subtotal = Math.round(subtotal * 100) / 100;
  const delivery_fee = input.delivery_fee ?? 25;
  const service_fee = Math.round(subtotal * 0.05 * 100) / 100;
  const tax = 0;
  const tip = input.tip ?? 0;
  const discount = input.discount ?? 0;
  const total =
    Math.round((subtotal + delivery_fee + service_fee + tax + tip - discount) * 100) / 100;

  const order: FirebaseOrder = {
    id: orderId,
    order_number: orderNumber,
    status: "pending",
    placed_at: ts,
    accepted_at: null,
    ready_at: null,
    picked_up_at: null,
    delivered_at: null,
    cancelled_at: null,
    eta_minutes: null,
    eta_at: null,
    subtotal,
    delivery_fee,
    service_fee,
    tax,
    discount,
    tip,
    total,
    coupon_code: input.coupon_code ?? null,
    payment_method: input.payment_method,
    payment_status: input.payment_status,
    delivery_address: input.delivery_address,
    special_instructions: input.special_instructions ?? null,
    scheduled_for: null,
    restaurant_id: input.restaurant.id,
    restaurant_name: input.restaurant.name,
    restaurant_image: input.restaurant.image,
    customer_id: input.customer.uid,
    customer_name: input.customer.name,
    customer_phone: input.customer.phone,
    customer_email: input.customer.email,
    driver_id: null,
    driver_name: null,
    driver_phone: null,
    driver_photo: null,
    driver_rating: null,
    created_at: ts,
    updated_at: ts,
  };

  await rtdbSet(`orders/${orderId}`, order);
  await rtdbSet(`orders/${orderId}/items`, lines);
  await rtdbSet(`orders/${orderId}/timeline/${uid("tl")}`, {
    id: uid("tl"),
    status: "placed",
    at: ts,
    note: "Order placed by customer",
    actor: input.customer.uid,
  });

  return orderId;
}
