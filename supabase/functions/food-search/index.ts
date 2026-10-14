// FoodTracker food-search Edge Function
// USDA credentials stay on the server; never embed USDA_API_KEY in the Android app or website.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
}

type FdcNutrient = {
  nutrientId?: number;
  nutrientName?: string;
  unitName?: string;
  value?: number | null;
  amount?: number | null;
  nutrient?: { id?: number; name?: string; number?: string };
};

type FdcFood = {
  fdcId?: number;
  description?: string;
  dataType?: string;
  brandOwner?: string | null;
  brandName?: string | null;
  servingSize?: number | null;
  servingSizeUnit?: string | null;
  householdServingFullText?: string | null;
  foodNutrients?: FdcNutrient[];
};

function nutrientValue(food: FdcFood, id: number, namePattern: RegExp): number {
  const nutrients = food.foodNutrients ?? [];
  // Prefer the exact FDC nutrient ID. A name-only match can otherwise choose a
  // similarly named alternative before the official nutrient (notably energy).
  let nutrient = nutrients.find((item) => (item.nutrientId ?? item.nutrient?.id) === id);
  if (!nutrient) {
    nutrient = nutrients.find((item) => {
      const itemName = item.nutrientName ?? item.nutrient?.name ?? "";
      if (!namePattern.test(itemName)) return false;
      // Only use kcal energy as a calorie fallback; never treat kJ as kcal.
      if (id === 1008 && /\bkj\b|kilojoule/i.test(item.unitName ?? "")) return false;
      return true;
    });
  }
  const value = nutrient?.value ?? nutrient?.amount;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function servingBasis(food: FdcFood): { servingSize: string; factor: number } {
  // FoodData Central's search nutrients are standardized per 100 g or 100 ml.
  // Convert them to the displayed package serving where a gram/ml weight exists,
  // so the saved values really are per one FoodTracker serving.
  const size = food.servingSize;
  const unitRaw = String(food.servingSizeUnit ?? "").trim().toLowerCase();
  const unit = unitRaw === "gram" || unitRaw === "grams" ? "g"
    : unitRaw === "milliliter" || unitRaw === "milliliters" || unitRaw === "millilitre" || unitRaw === "millilitres" ? "ml"
    : unitRaw;
  if (typeof size === "number" && Number.isFinite(size) && size > 0 && (unit === "g" || unit === "ml")) {
    const prettySize = Number.isInteger(size) ? String(size) : String(Number(size.toFixed(3)));
    return { servingSize: `${prettySize} ${unit}`, factor: size / 100 };
  }
  // No unweighted household measure: the returned values are per 100 units.
  return { servingSize: "100 g", factor: 1 };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Use POST to search foods." }, 405);
  }

  const apiKey = Deno.env.get("USDA_API_KEY");
  if (!apiKey) {
    console.error("Missing USDA_API_KEY Edge Function secret.");
    return jsonResponse({ error: "Food search is not configured yet. Add the USDA_API_KEY secret in Supabase." }, 503);
  }

  let query: string;
  try {
    const body = await request.json();
    query = typeof body?.query === "string" ? body.query.trim() : "";
  } catch {
    return jsonResponse({ error: "Invalid JSON request body." }, 400);
  }

  if (query.length < 2) {
    return jsonResponse({ error: "Enter at least two characters to search." }, 400);
  }
  if (query.length > 120) {
    return jsonResponse({ error: "Search query is too long." }, 400);
  }

  const endpoint = new URL("https://api.nal.usda.gov/fdc/v1/foods/search");
  endpoint.searchParams.set("api_key", apiKey);

  let upstream: Response;
  try {
    upstream = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, pageSize: 15 }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch (error) {
    console.error("USDA request failed:", error);
    return jsonResponse({ error: "The food database did not respond. Please try again." }, 502);
  }

  if (!upstream.ok) {
    console.error("USDA API returned status:", upstream.status);
    const status = upstream.status === 429 ? 429 : 502;
    return jsonResponse({
      error: upstream.status === 429
        ? "Food database request limit reached. Please try again later."
        : "The food database search failed. Please try again later.",
    }, status);
  }

  let payload: { foods?: FdcFood[] };
  try {
    payload = await upstream.json();
  } catch {
    return jsonResponse({ error: "The food database returned an unreadable response." }, 502);
  }

  const foods = (payload.foods ?? [])
    .filter((food) => typeof food.fdcId === "number" && Boolean(food.description?.trim()))
    .slice(0, 15)
    .map((food) => {
      const serving = servingBasis(food);
      const per100 = {
        calories: nutrientValue(food, 1008, /\benergy\b/i),
        protein: nutrientValue(food, 1003, /\bprotein\b/i),
        carbs: nutrientValue(food, 1005, /carbohydrate, by difference|total carbohydrate/i),
        fat: nutrientValue(food, 1004, /total lipid \(fat\)|\btotal fat\b/i),
        fiber: nutrientValue(food, 1079, /fiber, total dietary/i),
      };

      return {
        fdcId: food.fdcId,
        description: food.description?.trim() ?? "Food",
        dataType: food.dataType ?? "",
        brandOwner: food.brandOwner ?? food.brandName ?? null,
        servingSize: serving.servingSize,
        calories: per100.calories * serving.factor,
        protein: per100.protein * serving.factor,
        carbs: per100.carbs * serving.factor,
        fat: per100.fat * serving.factor,
        fiber: per100.fiber * serving.factor,
      };
    });

  return jsonResponse({ foods });
});
