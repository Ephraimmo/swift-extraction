import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Bike, Clock, Compass, Heart, MapPin, Sparkles, Star, Tag } from "lucide-react";
import { toast } from "sonner";
import { CartBar } from "@/components/app/cart-bar";
import { DishSheet } from "@/components/app/dish-sheet";
import { LocationSelectorDialog } from "@/components/app/location-selector-dialog";
import { money, type Dish } from "@/lib/data";
import { useComboDeals, useRestaurant } from "@/lib/firebase-adapters";
import { useLocation } from "@/lib/location";
import { useCart } from "@/lib/cart";
import { quoteDelivery, restaurantOffersDelivery, restaurantOffersPickup } from "@/lib/pricing";
import { haversineDistanceKm } from "@/lib/geo";

export const Route = createFileRoute("/restaurant/$slug")({
  head: ({ params }) => {
    const title = "Restaurant menu — order delivery on Hearth";
    const description = `Browse the live menu for ${params.slug.replace(/-/g, " ")} and order delivery on Hearth.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
      ],
    };
  },
  component: RestaurantPage,
});

function RestaurantPage() {
  const { slug } = Route.useParams();
  const { restaurant, loading } = useRestaurant(slug);
  const { activeLocation, gpsCoordinates } = useLocation();
  const { mode, setMode } = useCart();
  const combos = useComboDeals(restaurant?.slug || slug);

  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [sheetDish, setSheetDish] = useState<Dish | null>(null);
  const [favorite, setFavorite] = useState(false);
  const [openLocationDialog, setOpenLocationDialog] = useState(false);

  const customerCoords = useMemo(() => {
    if (activeLocation && activeLocation.latitude != null && activeLocation.longitude != null) {
      return { latitude: activeLocation.latitude, longitude: activeLocation.longitude };
    }
    if (gpsCoordinates && gpsCoordinates.latitude != null && gpsCoordinates.longitude != null) {
      return { latitude: gpsCoordinates.latitude, longitude: gpsCoordinates.longitude };
    }
    return { latitude: -26.1952, longitude: 28.0345 };
  }, [activeLocation, gpsCoordinates]);

  const restaurantCoords = useMemo(() => {
    if (restaurant && restaurant.latitude != null && restaurant.longitude != null) {
      return { latitude: restaurant.latitude, longitude: restaurant.longitude };
    }
    return { latitude: -26.1755, longitude: 28.0273 };
  }, [restaurant]);

  // Real-time Delivery Quote based on restaurant flags, tiers & distance
  const quote = useMemo(() => {
    return quoteDelivery({
      mode,
      restaurant,
      customerCoords,
    });
  }, [restaurant, mode, customerCoords]);

  // Always compute exact straight-line distance in kilometres so it never shows "— km"
  const displayDistance = useMemo<string>(() => {
    if (quote.distanceKm != null && Number.isFinite(quote.distanceKm)) {
      return `${quote.distanceKm.toFixed(1)} km`;
    }
    const dist = haversineDistanceKm(restaurantCoords, customerCoords);
    if (dist != null) {
      return `${dist.toFixed(1)} km`;
    }
    return `${(restaurant?.distanceKm || 1.8).toFixed(1)} km`;
  }, [quote.distanceKm, restaurantCoords, customerCoords, restaurant?.distanceKm]);

  const hasDelivery = restaurantOffersDelivery(restaurant);
  const hasPickup = restaurantOffersPickup(restaurant);
  const isOutOfRange = mode === "delivery" && quote.reason === "out-of-range";
  const needsAddress = mode === "delivery" && quote.reason === "no-customer-coords";

  // Auto-switch to pickup if delivery is disabled by admin console
  useEffect(() => {
    if (restaurant && !hasDelivery && mode === "delivery") {
      setMode("pickup");
      toast.message("This restaurant doesn't offer delivery right now — switched to pickup.");
    }
  }, [restaurant?.slug, hasDelivery, mode, setMode]);

  const etaMinutes = useMemo<[number, number]>(() => {
    const prep = restaurant?.prep_time_minutes ?? restaurant?.etaMinutes[0] ?? 20;
    if (mode === "pickup" || quote.distanceKm == null) {
      return [prep, prep + 10];
    }
    const travel = Math.ceil(quote.distanceKm / 0.5);
    return [prep + travel, prep + travel + 12];
  }, [restaurant, mode, quote.distanceKm]);

  if (!restaurant) {
    return (
      <div className="mx-auto min-h-screen w-full max-w-md px-4 py-24 text-center md:max-w-3xl">
        <p className="text-2xl font-black tracking-tight">
          {loading ? "Loading menu…" : "Restaurant unavailable"}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {loading ? "Fetching the live menu." : "This kitchen isn't published right now."}
        </p>
        <Link to="/" className="mt-6 inline-block font-mono text-xs font-bold text-primary">
          Back to discover
        </Link>
      </div>
    );
  }

  const currentCategory =
    activeCategory && restaurant.categories.includes(activeCategory)
      ? activeCategory
      : (restaurant.categories[0] ?? "Menu");

  const visible =
    currentCategory === "Popular"
      ? restaurant.dishes.filter((d) => d.popular)
      : restaurant.dishes.filter((d) => d.category === currentCategory);

  return (
    <div className="mx-auto min-h-screen w-full max-w-md bg-background md:max-w-3xl lg:max-w-6xl">
      {/* Cover Image Header */}
      <div className="relative">
        <img
          src={restaurant.image}
          alt={`${restaurant.name} kitchen`}
          width={1024}
          height={640}
          className="aspect-[16/10] w-full object-cover md:aspect-[21/9] md:max-h-[380px] md:rounded-b-[32px]"
        />
        <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4">
          <Link
            to="/"
            aria-label="Back to discover"
            className="grid size-11 place-items-center rounded-full bg-background/90 ring-1 ring-border backdrop-blur cursor-pointer"
          >
            <ArrowLeft className="size-4" aria-hidden />
          </Link>
          <button
            type="button"
            onClick={() => setFavorite((v) => !v)}
            aria-label={favorite ? "Remove from favorites" : "Save to favorites"}
            aria-pressed={favorite}
            className="grid size-11 place-items-center rounded-full bg-background/90 ring-1 ring-border backdrop-blur cursor-pointer"
          >
            <Heart
              className={`size-4 ${favorite ? "fill-primary text-primary" : ""}`}
              aria-hidden
            />
          </button>
        </div>
      </div>

      <main className="pb-44 md:pb-24">
        <header className="px-4 pt-5 space-y-4">
          <div>
            <h1 className="text-2xl leading-tight font-black tracking-tight">{restaurant.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {restaurant.tagline} • {restaurant.priceBand}
            </p>
          </div>

          {/* Delivery / Pickup Segmented Control */}
          <div className="grid grid-cols-2 gap-2 rounded-2xl bg-secondary p-1 ring-1 ring-border">
            <button
              type="button"
              disabled={!hasDelivery}
              onClick={() => setMode("delivery")}
              title={!hasDelivery ? "This restaurant doesn't offer delivery" : undefined}
              className={`flex h-11 items-center justify-center gap-2 rounded-xl text-xs font-black tracking-wider uppercase transition-all cursor-pointer ${
                mode === "delivery" && hasDelivery
                  ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                  : "text-muted-foreground hover:text-foreground"
              } ${!hasDelivery ? "opacity-40 cursor-not-allowed" : ""}`}
            >
              <Bike className="size-4" />
              Delivery
            </button>
            <button
              type="button"
              disabled={!hasPickup}
              onClick={() => setMode("pickup")}
              className={`flex h-11 items-center justify-center gap-2 rounded-xl text-xs font-black tracking-wider uppercase transition-all cursor-pointer ${
                mode === "pickup" || !hasDelivery
                  ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <MapPin className="size-4" />
              Pickup
            </button>
          </div>

          {/* Sticky 4-Stat Info Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="rounded-2xl bg-secondary p-3 ring-1 ring-border">
              <span className="flex items-center gap-1 text-sm font-black text-foreground">
                <Star className="size-3.5 fill-primary text-primary" aria-hidden />
                {restaurant.rating}
              </span>
              <span className="label-mono text-[10px] text-muted-foreground">
                {restaurant.reviewCount} reviews
              </span>
            </div>

            <div className="rounded-2xl bg-secondary p-3 ring-1 ring-border">
              <span className="flex items-center gap-1 text-sm font-black text-foreground">
                <Clock className="size-3.5 text-primary" aria-hidden />
                {etaMinutes[0]}–{etaMinutes[1]}
              </span>
              <span className="label-mono text-[10px] text-muted-foreground">
                {mode === "pickup" ? "prep minutes" : "arrival minutes"}
              </span>
            </div>

            <div className="rounded-2xl bg-secondary p-3 ring-1 ring-border">
              <span className="flex items-center gap-1 text-sm font-black text-foreground">
                <Bike className="size-3.5 text-primary" aria-hidden />
                {mode === "pickup"
                  ? "Free"
                  : isOutOfRange
                    ? "Out of range"
                    : !hasDelivery
                      ? "Pickup only"
                      : quote.fee === 0
                        ? "Free"
                        : money(quote.fee)}
              </span>
              <span className="label-mono text-[10px] text-muted-foreground">
                {mode === "pickup" ? "pickup order" : "delivery fee"}
              </span>
            </div>

            <div className="rounded-2xl bg-secondary p-3 ring-1 ring-border">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-sm font-black text-foreground">
                  <Compass className="size-3.5 text-primary" aria-hidden />
                  {displayDistance}
                </span>
                <button
                  type="button"
                  onClick={() => setOpenLocationDialog(true)}
                  className="text-[10px] font-bold text-primary hover:underline cursor-pointer"
                >
                  Change
                </button>
              </div>
              <span className="label-mono text-[10px] text-muted-foreground truncate block">
                {activeLocation?.label || "from you"}
              </span>
            </div>
          </div>

          {/* Active Combos on this Restaurant */}
          {combos.length > 0 ? (
            <div className="rounded-2xl bg-primary/10 p-3.5 border border-primary/20 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-primary" />
                <span className="font-bold text-primary">
                  {combos.length} Special Deals & Bundles Active
                </span>
              </div>
              <span className="text-[11px] text-primary/80 font-medium">
                Applied automatically in cart
              </span>
            </div>
          ) : null}

          {/* Friendly Info Banners */}
          {needsAddress ? (
            <div className="rounded-2xl bg-secondary/80 p-3.5 ring-1 ring-border flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                📍 Add a delivery address to see live fees and ETA
              </span>
              <button
                type="button"
                onClick={() => setOpenLocationDialog(true)}
                className="font-bold text-primary hover:underline cursor-pointer"
              >
                Set address →
              </button>
            </div>
          ) : isOutOfRange ? (
            <div className="rounded-2xl bg-destructive/10 p-4 ring-1 ring-destructive/30 text-xs">
              <p className="font-bold text-destructive">
                📍 You are {displayDistance} away, but this kitchen only delivers up to{" "}
                {restaurant.delivery_radius_km} km.
              </p>
              <p className="mt-1 text-muted-foreground">
                Switch to{" "}
                <button
                  type="button"
                  onClick={() => setMode("pickup")}
                  className="font-bold text-primary underline cursor-pointer"
                >
                  Pickup
                </button>{" "}
                or select a closer delivery location.
              </p>
            </div>
          ) : !hasDelivery ? (
            <div className="rounded-2xl bg-amber-500/10 p-3.5 ring-1 ring-amber-500/30 text-xs text-amber-700">
              📍 This restaurant doesn't offer delivery right now. You can still order for pickup at
              the kitchen address.
            </div>
          ) : null}

          <p className="label-mono text-muted-foreground">
            {restaurant.openNow ? "Open now" : "Closed"} • {restaurant.hours} • {restaurant.address}
          </p>
        </header>

        {/* Categories Tab Navigation */}
        <nav
          aria-label="Menu categories"
          className="no-scrollbar sticky top-0 z-30 md:top-16 mt-6 flex gap-2 overflow-x-auto border-b border-border bg-background/95 px-4 py-3 backdrop-blur-md"
        >
          {restaurant.categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              aria-pressed={currentCategory === cat}
              className={`flex-shrink-0 rounded-full px-4 py-2 text-[11px] font-black tracking-widest uppercase ring-1 cursor-pointer transition-colors ${
                currentCategory === cat
                  ? "bg-foreground text-background ring-transparent"
                  : "bg-secondary ring-border hover:bg-secondary/80"
              }`}
            >
              {cat}
            </button>
          ))}
        </nav>

        {/* Dish List with Combo & Bundle Badges (§8 of Integration Guide) */}
        <section className="px-4 pt-6">
          <h2 className="mb-4 text-lg font-black tracking-tight">{currentCategory}</h2>
          <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {visible.map((dish) => {
              // Match active combo deals containing this dish
              const matchingCombo = combos.find(
                (c) =>
                  c.item_ids &&
                  (c.item_ids.includes(dish.id) || c.item_ids.some((id) => dish.id.includes(id))),
              );

              return (
                <li key={dish.id}>
                  <button
                    type="button"
                    onClick={() => setSheetDish(dish)}
                    className="relative flex w-full items-center gap-4 rounded-3xl bg-card p-3 text-left ring-1 ring-border transition-transform active:scale-[0.99] cursor-pointer hover:bg-card/90"
                  >
                    <div className="relative size-20 shrink-0">
                      <img
                        src={dish.image}
                        alt={dish.name}
                        width={1024}
                        height={640}
                        loading="lazy"
                        className="size-full rounded-2xl object-cover"
                      />
                      {matchingCombo ? (
                        <span className="absolute -top-1.5 -left-1.5 rounded-md bg-primary px-1.5 py-0.5 text-[8px] font-black tracking-wider uppercase text-primary-foreground shadow-md">
                          {matchingCombo.kind === "multibuy"
                            ? `${matchingCombo.buy_qty} for ${matchingCombo.pay_qty}`
                            : "Bundle Deal"}
                        </span>
                      ) : null}
                    </div>

                    <span className="min-w-0 flex-1">
                      <span className="block text-base leading-tight font-bold">{dish.name}</span>
                      <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">
                        {dish.description}
                      </span>
                      <span className="label-mono mt-2 block text-muted-foreground">
                        {dish.prepMinutes} min • {dish.calories} kcal
                        {dish.diet ? ` • ${dish.diet.toUpperCase()}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-sm font-bold">
                      {money(dish.price)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {visible.length === 0 ? (
            <p className="rounded-3xl bg-secondary p-6 text-center text-sm text-muted-foreground ring-1 ring-border">
              Nothing in this section yet.
            </p>
          ) : null}
        </section>
      </main>

      {sheetDish ? (
        <DishSheet
          dish={sheetDish}
          restaurantSlug={restaurant.slug}
          onClose={() => setSheetDish(null)}
        />
      ) : null}

      <LocationSelectorDialog
        open={openLocationDialog}
        onClose={() => setOpenLocationDialog(false)}
      />

      <CartBar />
    </div>
  );
}
