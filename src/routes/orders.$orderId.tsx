import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Bike,
  CheckCircle2,
  Clock,
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
  RotateCcw,
  ShieldAlert,
  Star,
} from "lucide-react";
import {
  money,
  type DriverLiveLocation,
  type FirebaseOrder,
  type OrderLine,
  type OrderStatus,
  type TimelineEvent,
} from "@/lib/data";
import { rtdbSubscribe } from "@/lib/firebase";

export const Route = createFileRoute("/orders/$orderId")({
  head: () => ({
    meta: [
      { title: "Track your order — Hearth" },
      {
        name: "description",
        content: "Follow your order live: kitchen progress, driver assignment and arrival time.",
      },
      { property: "og:title", content: "Track your order — Hearth" },
      {
        property: "og:description",
        content: "Live timeline, driver details and estimated arrival for your delivery.",
      },
    ],
  }),
  component: TrackOrder,
});

const STAGE_PROGRESSION: Array<{
  status: OrderStatus | "placed";
  label: string;
  detail: string;
}> = [
  { status: "placed", label: "Order placed", detail: "Sent to the kitchen" },
  { status: "pending", label: "Order received", detail: "Waiting for kitchen acceptance" },
  { status: "accepted", label: "Restaurant accepted", detail: "Kitchen confirmed your order" },
  { status: "preparing", label: "Preparing food", detail: "Chef is cooking to order" },
  { status: "ready", label: "Ready for pickup", detail: "Packed, sealed and ready" },
  { status: "assigned", label: "Driver assigned", detail: "Heading to the restaurant" },
  { status: "picked_up", label: "Driver picked up", detail: "Food collected from kitchen" },
  { status: "on_the_way", label: "On the way", detail: "Driver is en route to your address" },
  { status: "delivered", label: "Delivered", detail: "Enjoy your meal!" },
];

function TrackOrder() {
  const { orderId } = Route.useParams();
  const navigate = useNavigate();

  const [order, setOrder] = useState<FirebaseOrder | null>(null);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [driverLocation, setDriverLocation] = useState<DriverLiveLocation | null>(null);
  const [loading, setLoading] = useState(true);

  // Subscribe to live order updates from Firebase Realtime Database
  useEffect(() => {
    setLoading(true);

    const unsubOrder = rtdbSubscribe<FirebaseOrder>(`orders/${orderId}`, (o) => {
      setOrder(o);
      setLoading(false);
    });

    const unsubLines = rtdbSubscribe<Record<string, OrderLine>>(
      `orders/${orderId}/items`,
      (itemsMap) => {
        if (!itemsMap) {
          setLines([]);
          return;
        }
        setLines(Object.values(itemsMap));
      },
    );

    const unsubTimeline = rtdbSubscribe<Record<string, TimelineEvent>>(
      `orders/${orderId}/timeline`,
      (tlMap) => {
        if (!tlMap) {
          setTimeline([]);
          return;
        }
        const sorted = Object.values(tlMap).sort((a, b) => (a.at || "").localeCompare(b.at || ""));
        setTimeline(sorted);
      },
    );

    const unsubDriver = rtdbSubscribe<DriverLiveLocation>(`drivers/live/${orderId}`, (loc) => {
      setDriverLocation(loc);
    });

    return () => {
      unsubOrder();
      unsubLines();
      unsubTimeline();
      unsubDriver();
    };
  }, [orderId]);

  const currentStatus = (order?.status ?? "pending").toLowerCase() as OrderStatus;
  const isCancelled = currentStatus === "cancelled";
  const isRefunded = currentStatus === "refunded";
  const isDelivered = currentStatus === "delivered";

  // Determine stage progression index
  const stageIndex = useMemo(() => {
    if (isCancelled || isRefunded) return -1;
    const idx = STAGE_PROGRESSION.findIndex((s) => s.status === currentStatus);
    return idx >= 0 ? idx : 1; // default to pending/placed
  }, [currentStatus, isCancelled, isRefunded]);

  // Set of statuses recorded in the timeline
  const timelineStatusSet = useMemo(() => {
    const set = new Set<string>();
    timeline.forEach((t) => {
      if (t.status) set.add(t.status.toLowerCase());
    });
    if (currentStatus) set.add(currentStatus);
    return set;
  }, [timeline, currentStatus]);

  if (loading && !order) {
    return (
      <div className="mx-auto min-h-screen w-full max-w-md px-4 md:max-w-2xl py-16">
        <div className="h-44 animate-pulse rounded-3xl bg-secondary" />
        <div className="mt-6 space-y-4">
          <div className="h-20 animate-pulse rounded-2xl bg-secondary" />
          <div className="h-32 animate-pulse rounded-2xl bg-secondary" />
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="mx-auto min-h-screen w-full max-w-md px-4 md:max-w-2xl py-20 text-center">
        <h1 className="text-2xl font-black tracking-tight">Order not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          No live order found with reference <span className="font-mono font-bold">{orderId}</span>.
        </p>
        <Link
          to="/orders"
          className="mt-6 inline-flex h-14 items-center rounded-2xl bg-primary px-8 text-sm font-black tracking-[0.1em] text-primary-foreground uppercase"
        >
          View all orders
        </Link>
      </div>
    );
  }

  const progressPercent = Math.min(
    100,
    Math.max(10, ((Math.max(0, stageIndex) + 1) / STAGE_PROGRESSION.length) * 100),
  );

  return (
    <div className="mx-auto min-h-screen w-full max-w-md bg-background md:max-w-2xl">
      <header className="sticky top-0 z-40 md:static flex items-center justify-between border-b border-border bg-background/90 px-4 py-4 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Link
            to="/orders"
            aria-label="Back to orders"
            className="grid size-11 place-items-center rounded-full bg-secondary ring-1 ring-border"
          >
            <ArrowLeft className="size-4" aria-hidden />
          </Link>
          <div>
            <h1 className="text-lg leading-none font-black tracking-tight">
              {order.restaurant_name}
            </h1>
            <p className="label-mono mt-1 text-muted-foreground font-mono">
              {order.order_number || order.id}
            </p>
          </div>
        </div>

        <span
          className={`rounded-full px-3 py-1 text-xs font-black tracking-wider uppercase ${
            isCancelled
              ? "bg-destructive/15 text-destructive"
              : isRefunded
                ? "bg-amber-500/15 text-amber-600"
                : isDelivered
                  ? "bg-emerald-500/15 text-emerald-600"
                  : "bg-primary/15 text-primary"
          }`}
        >
          {order.status.replace(/_/g, " ")}
        </span>
      </header>

      <main className="space-y-6 px-4 pt-6 pb-32">
        {/* Status Alerts if Cancelled or Refunded */}
        {isCancelled ? (
          <div className="flex items-start gap-3 rounded-3xl bg-destructive/10 p-5 ring-1 ring-destructive/30">
            <ShieldAlert className="size-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-black text-destructive">Order has been cancelled</p>
              <p className="mt-1 text-xs text-muted-foreground">
                This order was cancelled by restaurant or customer support. If charged, funds will
                be refunded.
              </p>
            </div>
          </div>
        ) : isRefunded ? (
          <div className="flex items-start gap-3 rounded-3xl bg-amber-500/10 p-5 ring-1 ring-amber-500/30">
            <RotateCcw className="size-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-black text-amber-700">Order refunded</p>
              <p className="mt-1 text-xs text-muted-foreground">
                A refund of {money(order.total)} has been initiated to your original payment method.
              </p>
            </div>
          </div>
        ) : null}

        {/* Live Map or Tracking Area */}
        <div className="relative aspect-[16/10] overflow-hidden rounded-3xl bg-secondary ring-1 ring-border">
          <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(var(--color-border)_1px,transparent_1px),linear-gradient(90deg,var(--color-border)_1px,transparent_1px)] [background-size:28px_28px]" />

          {driverLocation ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-4">
              <div className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-black text-primary-foreground shadow-lg">
                <Navigation className="size-4 animate-pulse" />
                Live GPS: {driverLocation.latitude.toFixed(4)},{" "}
                {driverLocation.longitude.toFixed(4)}
              </div>
              {driverLocation.speed ? (
                <span className="label-mono mt-2 rounded-md bg-background/80 px-2 py-1 text-[10px] backdrop-blur">
                  Speed: {Math.round(driverLocation.speed)} km/h
                </span>
              ) : null}
            </div>
          ) : (
            <>
              <div className="absolute top-1/2 left-6 size-3 -translate-y-1/2 rounded-full bg-foreground" />
              <div className="absolute top-1/2 right-6 size-3 -translate-y-1/2 rounded-full bg-primary" />
              <div className="absolute top-1/2 right-6 left-6 h-0.5 -translate-y-1/2 bg-border" />
              <div
                className="absolute top-1/2 left-6 h-0.5 -translate-y-1/2 bg-primary transition-all duration-1000"
                style={{ width: `calc((100% - 48px) * ${progressPercent / 100})` }}
              />
              <div
                className="absolute top-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-xl bg-primary text-[10px] font-black text-primary-foreground shadow-xl transition-all duration-1000"
                style={{ left: `calc(24px + (100% - 48px) * ${progressPercent / 100})` }}
              >
                {order.driver_id ? "DRV" : "KTC"}
              </div>
            </>
          )}

          <span className="label-mono absolute bottom-4 left-4 rounded-full bg-background/90 px-3 py-1.5 ring-1 ring-border backdrop-blur max-w-[80%] truncate">
            {order.delivery_address
              ? `${order.delivery_address.street}, ${order.delivery_address.city}`
              : "Pickup at kitchen"}
          </span>
        </div>

        {/* ETA & Status Banner */}
        <div className="rounded-3xl bg-foreground p-6 text-background">
          <span className="label-mono opacity-60">
            {isDelivered ? "Delivery Status" : "Estimated Arrival"}
          </span>
          <p className="mt-1 text-3xl font-black tracking-tight">
            {isDelivered
              ? "Delivered"
              : isCancelled
                ? "Cancelled"
                : isRefunded
                  ? "Refunded"
                  : order.eta_minutes
                    ? `${order.eta_minutes} min`
                    : "Calculating…"}
          </p>
          <p className="mt-2 text-sm opacity-80">
            {STAGE_PROGRESSION.find((s) => s.status === currentStatus)?.detail ??
              "Your order is being handled."}
          </p>
        </div>

        {/* Status Progression Timeline */}
        <div className="rounded-3xl bg-secondary p-5 ring-1 ring-border">
          <h2 className="label-mono mb-4 text-muted-foreground">Order Progress</h2>
          <ol className="space-y-4">
            {STAGE_PROGRESSION.map((stage, idx) => {
              const hasOccurred =
                stageIndex >= idx ||
                timelineStatusSet.has(stage.status) ||
                (stage.status === "placed" && order.placed_at);
              const isCurrent = stage.status === currentStatus;

              return (
                <li key={stage.status} className="flex items-start gap-4">
                  <div className="flex flex-col items-center">
                    <span
                      className={`mt-1 size-3 rounded-full transition-colors ${
                        isCurrent
                          ? "bg-primary ring-4 ring-primary/20"
                          : hasOccurred
                            ? "bg-primary"
                            : "bg-border"
                      }`}
                    />
                    {idx < STAGE_PROGRESSION.length - 1 ? (
                      <span
                        className={`h-7 w-0.5 transition-colors ${
                          hasOccurred ? "bg-primary/40" : "bg-border"
                        }`}
                      />
                    ) : null}
                  </div>
                  <div className={hasOccurred ? "flex-1" : "flex-1 opacity-40"}>
                    <p className="text-sm font-bold flex items-center justify-between">
                      <span>{stage.label}</span>
                      {hasOccurred && !isCurrent ? (
                        <CheckCircle2 className="size-3.5 text-primary" />
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">{stage.detail}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        {/* Driver Card — Appears when driver_id / driver_name is populated */}
        {order.driver_id || order.driver_name ? (
          <section className="flex items-center gap-4 rounded-3xl bg-card p-5 ring-1 ring-border">
            {order.driver_photo ? (
              <img
                src={order.driver_photo}
                alt={order.driver_name ?? "Driver"}
                className="size-12 rounded-2xl object-cover ring-1 ring-border"
              />
            ) : (
              <span className="grid size-12 place-items-center rounded-2xl bg-secondary text-sm font-black text-primary ring-1 ring-border">
                <Bike className="size-6" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">{order.driver_name || "Assigned Driver"}</p>
              <p className="label-mono mt-0.5 text-xs text-muted-foreground">
                Courier assigned • Fast delivery
              </p>
              {order.driver_rating ? (
                <div className="mt-1 flex items-center gap-1 text-xs font-bold text-primary">
                  <Star className="size-3 fill-primary text-primary" />
                  {order.driver_rating.toFixed(1)}
                </div>
              ) : null}
            </div>

            {order.driver_phone ? (
              <a
                href={`tel:${order.driver_phone}`}
                className="grid size-11 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-md transition-transform active:scale-95"
                aria-label="Call driver"
              >
                <Phone className="size-4" />
              </a>
            ) : null}
          </section>
        ) : (
          <div className="rounded-2xl bg-secondary/50 p-4 text-center ring-1 ring-border text-xs text-muted-foreground">
            Driver will be assigned once kitchen finishes preparation.
          </div>
        )}

        {/* Live Timeline Audit Trail */}
        {timeline.length > 0 ? (
          <section className="space-y-2 rounded-3xl bg-secondary p-5 ring-1 ring-border">
            <h2 className="label-mono mb-2 text-muted-foreground">Activity Log</h2>
            <div className="space-y-2">
              {timeline.map((event) => (
                <div
                  key={event.id}
                  className="flex justify-between items-start text-xs border-b border-border/50 pb-2"
                >
                  <div>
                    <span className="font-bold capitalize">{event.note || event.status}</span>
                    {event.actor ? (
                      <span className="ml-1 text-muted-foreground">by {event.actor}</span>
                    ) : null}
                  </div>
                  <span className="font-mono text-muted-foreground shrink-0 ml-2">
                    {new Date(event.at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* Contact Restaurant / Support */}
        <section className="grid grid-cols-2 gap-2">
          <a
            href="tel:+27825550100"
            className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-secondary text-[11px] font-black tracking-widest uppercase ring-1 ring-border"
          >
            <Phone className="size-4" aria-hidden />
            Call kitchen
          </a>
          <button
            type="button"
            onClick={() => alert("Customer Support: support@hearth.app | +27 80 000 3344")}
            className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-secondary text-[11px] font-black tracking-widest uppercase ring-1 ring-border cursor-pointer"
          >
            <MessageCircle className="size-4" aria-hidden />
            Support
          </button>
        </section>

        {/* Order Receipt / Items Breakdown */}
        <section className="space-y-2 rounded-3xl bg-secondary p-5 ring-1 ring-border">
          <h2 className="label-mono mb-2 text-muted-foreground">Receipt</h2>
          {lines.length > 0 ? (
            lines.map((l) => (
              <div key={l.id} className="flex justify-between text-sm py-1">
                <div>
                  <span className="font-bold text-foreground">
                    {l.quantity}× {l.name}
                  </span>
                  {l.variant ? (
                    <span className="block text-xs text-muted-foreground">
                      Size: {l.variant.name}
                    </span>
                  ) : null}
                  {l.addons && l.addons.length > 0 ? (
                    <span className="block text-xs text-muted-foreground">
                      Extras: {l.addons.map((a) => a.name).join(", ")}
                    </span>
                  ) : null}
                  {l.notes ? (
                    <span className="block text-xs italic text-muted-foreground">"{l.notes}"</span>
                  ) : null}
                </div>
                <span className="font-mono font-bold">{money(l.line_total)}</span>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">Item details loaded from database.</p>
          )}

          <div className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span className="font-mono font-bold text-foreground">{money(order.subtotal)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Delivery fee</span>
              <span className="font-mono font-bold text-foreground">
                {order.delivery_fee === 0 ? "Free" : money(order.delivery_fee)}
              </span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Service fee</span>
              <span className="font-mono font-bold text-foreground">
                {money(order.service_fee)}
              </span>
            </div>
            {order.tip ? (
              <div className="flex justify-between text-muted-foreground">
                <span>Driver tip</span>
                <span className="font-mono font-bold text-foreground">{money(order.tip)}</span>
              </div>
            ) : null}
            {order.discount ? (
              <div className="flex justify-between text-muted-foreground">
                <span>Discount</span>
                <span className="font-mono font-bold text-foreground">
                  -{money(order.discount)}
                </span>
              </div>
            ) : null}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm font-black tracking-widest uppercase">
              Total ({order.payment_method})
            </span>
            <span className="font-mono text-lg font-black">{money(order.total)}</span>
          </div>
        </section>

        {order.restaurant_id ? (
          <button
            type="button"
            onClick={() =>
              void navigate({ to: "/restaurant/$slug", params: { slug: order.restaurant_id } })
            }
            className="h-14 w-full rounded-2xl bg-primary text-sm font-black tracking-[0.1em] text-primary-foreground uppercase cursor-pointer"
          >
            Order this again
          </button>
        ) : null}
      </main>
    </div>
  );
}
