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
  const nutrient = (food.foodNutrients ?? []).find((item) => {
    const itemId = item.nutrientId ?? item.nutrient?.id;
    const itemName = item.nutrientName ?? item.nutrient?.name ?? "";
    return itemId === id || namePattern.test(itemName);
  });

  const value = nutrient?.value ?? nutrient?.amount;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
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
      const servingSize = typeof food.servingSize === "number" && food.servingSize > 0
        ? `${food.servingSize} ${food.servingSizeUnit || "g"}`
        : (food.householdServingFullText?.trim() || "100 g");

      return {
        fdcId: food.fdcId,
        description: food.description?.trim() ?? "Food",
        dataType: food.dataType ?? "",
        brandOwner: food.brandOwner ?? food.brandName ?? null,
        servingSize,
        calories: nutrientValue(food, 1008, /\benergy\b/i),
        protein: nutrientValue(food, 1003, /\bprotein\b/i),
        carbs: nutrientValue(food, 1005, /carbohydrate, by difference|total carbohydrate/i),
        fat: nutrientValue(food, 1004, /total lipid \(fat\)|\btotal fat\b/i),
        fiber: nutrientValue(food, 1079, /fiber, total dietary/i),
      };
    });

  return jsonResponse({ foods });
});
