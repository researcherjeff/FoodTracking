/*
 * FoodTracker Cloud Edition
 * Static client: HTML/CSS/JS + Supabase Auth + Postgres.
 * Only put the project's publishable (or legacy anon) key in config.js.
 * Never put a service_role/secret key in browser code.
 */

const { createClient } = window.supabase || {};
const config = window.FOODTRACKER_CONFIG || {};

let supabaseClient = null;
let currentUser = null;
let activeTab = 'today';
let selectedDate = localDateString(new Date());

const state = {
  foods: [],
  entries: [],
  recipes: [],
  recipeIngredients: [],
  templates: [],
  templateEntries: [],
  goals: defaultGoals()
};

const $ = id => document.getElementById(id);

function localDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dateFromString(value) {
  const [y, m, d] = String(value).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function shiftDate(iso, days) {
  const d = dateFromString(iso);
  d.setDate(d.getDate() + days);
  return localDateString(d);
}

function fmtDate(iso) {
  return dateFromString(iso).toLocaleDateString(undefined, {
    month: 'long', day: 'numeric', year: 'numeric'
  });
}

function fmtShortDate(iso) {
  return dateFromString(iso).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric'
  });
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function amount(value) {
  const n = num(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function esc(value) {
  return String(value ?? '').replace(/[&<>\'\"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

function defaultGoals() {
  return {
    calorie_goal: 2000,
    protein_goal: 100,
    carbs_goal: 200,
    fat_goal: 65,
    fiber_goal: 30
  };
}

function sortByName(a, b) {
  return String(a.name).localeCompare(String(b.name));
}

function getDateEntries(date = selectedDate) {
  return state.entries.filter(entry => entry.date === date);
}

function getMealEntries(mealType, date = selectedDate) {
  return getDateEntries(date).filter(entry =>
    String(entry.meal_type).toLowerCase() === String(mealType).toLowerCase()
  );
}

function total(entries, key) {
  return entries.reduce((sum, entry) => sum + num(entry[key]) * num(entry.servings), 0);
}

function showToast(message, error = false) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  if (error) toast.style.borderLeftColor = '#ff7777';
  toast.textContent = message;
  $('toast-root').appendChild(toast);
  window.setTimeout(() => toast.remove(), 3500);
}

let authViewMode = 'login';

function showAuthPanel(mode, { preserveEmail = true } = {}) {
  const previousEmail =
    $('login-email')?.value.trim() ||
    $('signup-email')?.value.trim() ||
    $('reset-email')?.value.trim() || '';

  authViewMode = mode;
  clearAuthMessage();

  for (const panel of ['login', 'signup', 'reset']) {
    $(`${panel}-panel`).classList.toggle('hidden', panel !== mode);
  }

  if (preserveEmail && previousEmail) {
    const target = $(`${mode}-email`);
    if (target && !target.value) target.value = previousEmail;
  }

  if (mode === 'login') $('login-password')?.focus({ preventScroll: true });
  if (mode === 'signup') $('signup-email')?.focus({ preventScroll: true });
  if (mode === 'reset') $('reset-email')?.focus({ preventScroll: true });
}

function showAuthMessage(message, error = false, mode = authViewMode) {
  const el = $(`${mode}-message`);
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
  el.style.borderColor = error ? 'rgba(229,74,74,.5)' : 'rgba(120,200,140,.4)';
}

function clearAuthMessage() {
  for (const mode of ['login', 'signup', 'reset']) {
    const el = $(`${mode}-message`);
    if (!el) continue;
    el.classList.add('hidden');
    el.textContent = '';
    el.style.borderColor = '';
  }
}

// Return to this site's root path. This is important for GitHub Pages
// project sites, whose app URL includes a repository path (for example /foodtracker/).
function getAppRedirectUrl() {
  const url = new URL(window.location.href);
  url.hash = '';
  url.search = '';
  if (url.pathname.toLowerCase().endsWith('/index.html')) {
    url.pathname = url.pathname.slice(0, -'index.html'.length);
  } else if (!url.pathname.endsWith('/')) {
    // GitHub Pages may briefly show the project path without its final slash.
    // Preserve that project/repository path rather than redirecting to the domain root.
    url.pathname += '/';
  }
  return url.toString();
}

function displayAuthRedirectError() {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const searchParams = new URLSearchParams(window.location.search);
  const errorDescription = hashParams.get('error_description') || searchParams.get('error_description');
  const errorCode = hashParams.get('error_code') || searchParams.get('error_code');
  const error = hashParams.get('error') || searchParams.get('error');
  if (!error && !errorDescription && !errorCode) return;

  const message = (errorDescription || errorCode || error || 'The authentication link could not be completed.')
    .replace(/\+/g, ' ');
  showAuthPanel('login', { preserveEmail: false });
  showAuthMessage(`Email confirmation or sign-in link failed: ${message}. Please request a new link or contact support if it continues.`, true, 'login');
  // Remove the error fragment/query from the visible URL after displaying it.
  window.history.replaceState({}, document.title, window.location.pathname);
}

function openModal(html) {
  $('modal-root').innerHTML = `<div class="modal-backdrop" id="modal-backdrop"><div class="modal">${html}</div></div>`;
  $('modal-backdrop').addEventListener('click', event => {
    if (event.target.id === 'modal-backdrop') closeModal();
  });
  bindModalClose();
}

function bindModalClose() {
  document.querySelectorAll('[data-close]').forEach(button => {
    button.onclick = () => closeModal();
  });
}

function closeModal() {
  $('modal-root').innerHTML = '';
}

async function dbQuery(table, options = {}) {
  if (!supabaseClient || !currentUser) throw new Error('Please sign in first.');

  let query = supabaseClient.from(table).select(options.select || '*');
  if (options.eq) {
    for (const [key, value] of Object.entries(options.eq)) query = query.eq(key, value);
  }
  if (options.order) {
    query = query.order(options.order.column, { ascending: options.order.ascending ?? true });
  }
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function dbInsert(table, payload, select = '*') {
  if (!supabaseClient || !currentUser) throw new Error('Please sign in first.');
  const { data, error } = await supabaseClient.from(table).insert(payload).select(select).single();
  if (error) throw error;
  return data;
}

async function dbUpsert(table, payload, select = '*') {
  if (!supabaseClient || !currentUser) throw new Error('Please sign in first.');
  const { data, error } = await supabaseClient.from(table).upsert(payload).select(select).maybeSingle();
  if (error) throw error;
  return data;
}

async function dbDelete(table, id) {
  if (!supabaseClient || !currentUser) throw new Error('Please sign in first.');
  const { error } = await supabaseClient.from(table).delete().eq('id', id);
  if (error) throw error;
}

async function loadAll() {
  const [foods, entries, recipes, recipeIngredients, goals, templates] = await Promise.all([
    dbQuery('foods', { order: { column: 'name' } }),
    dbQuery('meal_entries', { order: { column: 'created_at', ascending: false } }),
    dbQuery('recipes', { order: { column: 'name' } }),
    dbQuery('recipe_ingredients', { order: { column: 'id' } }),
    dbQuery('daily_goals'),
    dbQuery('meal_templates', { order: { column: 'name' } })
  ]);

  let templateEntries = [];
  if (templates.length) {
    const ids = templates.map(t => t.id);
    const { data, error } = await supabaseClient
      .from('meal_template_entries')
      .select('*')
      .in('template_id', ids)
      .order('id');
    if (error) throw error;
    templateEntries = data || [];
  }

  state.foods = foods;
  state.entries = entries;
  state.recipes = recipes;
  state.recipeIngredients = recipeIngredients;
  state.templates = templates;
  state.templateEntries = templateEntries;
  state.goals = goals[0] || defaultGoals();
}

function navigate(tab) {
  activeTab = tab;
  document.querySelectorAll('.nav-btn').forEach(button => {
    button.classList.toggle('active', button.dataset.tab === tab);
  });
  document.querySelectorAll('.page').forEach(page => page.classList.add('hidden'));
  $(`${tab}-page`).classList.remove('hidden');
  $('page-title').textContent = {
    today: 'Today', foods: 'Foods', recipes: 'Recipes', history: 'History', settings: 'Settings'
  }[tab];
  renderCurrentPage();
}

function renderCurrentPage() {
  if (activeTab === 'today') renderToday();
  if (activeTab === 'foods') renderFoods();
  if (activeTab === 'recipes') renderRecipes();
  if (activeTab === 'history') renderHistory();
  if (activeTab === 'settings') renderSettings();
}

function progressPercent(value, goal) {
  return goal > 0 ? Math.min((value / goal) * 100, 100) : 0;
}

function dateBar() {
  const today = localDateString(new Date());
  return `<div class="date-bar">
    <button class="ghost" id="prev-day" aria-label="Previous day">‹</button>
    <div class="date-label">${esc(fmtDate(selectedDate))}</div>
    <input id="date-picker" type="date" value="${esc(selectedDate)}" max="${today}" aria-label="Choose date">
    <button class="ghost" id="next-day" aria-label="Next day" ${selectedDate >= today ? 'disabled' : ''}>›</button>
  </div>`;
}

function nutritionCard(entries) {
  const cal = total(entries, 'calories');
  const protein = total(entries, 'protein');
  const carbs = total(entries, 'carbs');
  const fat = total(entries, 'fat');
  const fiber = total(entries, 'fiber');

  return `<div class="card">
    <div class="kpi">
      <div><div class="big">${Math.round(cal).toLocaleString()}</div><div class="muted">/ ${Math.round(num(state.goals.calorie_goal)).toLocaleString()} calories</div></div>
      <div class="muted">Daily totals</div>
    </div>
    <div class="progress" style="margin-top:10px"><span style="width:${progressPercent(cal, num(state.goals.calorie_goal))}%"></span></div>
    <div class="kpi" style="margin-top:16px"><strong>Protein</strong><span>${Math.round(protein)} / ${Math.round(num(state.goals.protein_goal))} g</span></div>
    <div class="progress" style="margin-top:6px"><span style="width:${progressPercent(protein, num(state.goals.protein_goal))}%"></span></div>
    <div class="grid grid-3" style="margin-top:16px">
      ${miniMacro('Carbs', carbs, num(state.goals.carbs_goal))}
      ${miniMacro('Fat', fat, num(state.goals.fat_goal))}
      ${miniMacro('Fiber', fiber, num(state.goals.fiber_goal))}
    </div>
  </div>`;
}

function miniMacro(label, value, goal) {
  return `<div><strong>${Math.round(value)} / ${Math.round(goal)}g</strong><div class="muted">${esc(label)}</div></div>`;
}

function quickLogHtml() {
  const favorites = state.foods.filter(f => f.is_favorite).sort(sortByName);
  const recentIds = [];
  for (const entry of state.entries) {
    if (entry.entry_type !== 'FOOD' || !entry.food_id || recentIds.includes(entry.food_id)) continue;
    recentIds.push(entry.food_id);
    if (recentIds.length === 5) break;
  }
  const recents = recentIds.map(id => state.foods.find(f => f.id === id)).filter(Boolean);
  const combined = [...favorites, ...recents.filter(r => !favorites.some(f => f.id === r.id))].slice(0, 10);

  if (!combined.length) return '<div class="empty">Favorite or log a food once and it will appear here.</div>';

  return combined.map(food => `<div class="entry">
    <div class="entry-main"><div class="entry-name">${esc(food.name)}</div><div class="entry-meta">${esc(food.serving_size)} • ${Math.round(num(food.calories))} cal • ${Math.round(num(food.protein))}g protein</div></div>
    <div class="entry-actions"><button class="primary" data-quick-food="${food.id}">Log</button></div>
  </div>`).join('');
}

function renderToday() {
  const entries = getDateEntries();
  const meals = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
  const today = localDateString(new Date());
  const isToday = selectedDate === today;

  $('today-page').innerHTML = `${dateBar()}
    <div class="actions" style="margin-bottom:14px">
      <button class="primary" id="add-food-today">+ Add Food</button>
      <button id="saved-meals-btn">Saved Meals</button>
      ${entries.length ? '<button id="copy-day-btn">Copy Entire Day</button>' : ''}
    </div>
    ${nutritionCard(entries)}
    <div class="section-title"><h2>Quick Log</h2></div>
    <div class="card">${quickLogHtml()}</div>
    <div class="section-title"><h2>Meals</h2></div>
    ${meals.map(meal => renderMeal(meal, entries)).join('')}
    ${entries.length ? '' : `<div class="card empty">Nothing logged ${isToday ? 'today' : 'on this date'} yet.<br>Use <strong>+ Add Food</strong> or Quick Log to get started.</div>`}`;

  $('prev-day').onclick = () => { selectedDate = shiftDate(selectedDate, -1); renderToday(); };
  $('next-day').onclick = () => { selectedDate = shiftDate(selectedDate, 1); renderToday(); };
  $('date-picker').onchange = event => { if (event.target.value) { selectedDate = event.target.value; renderToday(); } };
  $('add-food-today').onclick = () => openAddFoodModal(selectedDate);
  $('saved-meals-btn').onclick = openSavedMealsModal;
  if ($('copy-day-btn')) $('copy-day-btn').onclick = () => openCopyModal(null);

  document.querySelectorAll('[data-quick-food]').forEach(button => {
    button.onclick = () => openLogFoodModal(Number(button.dataset.quickFood), selectedDate);
  });
  document.querySelectorAll('[data-edit-entry]').forEach(button => {
    button.onclick = () => openEditEntryModal(Number(button.dataset.editEntry));
  });
  document.querySelectorAll('[data-delete-entry]').forEach(button => {
    button.onclick = () => confirmDeleteEntry(Number(button.dataset.deleteEntry));
  });
  document.querySelectorAll('[data-copy-meal]').forEach(button => {
    button.onclick = () => openCopyModal(button.dataset.copyMeal);
  });
  document.querySelectorAll('[data-save-meal]').forEach(button => {
    button.onclick = () => openSaveMealModal(button.dataset.saveMeal);
  });
}

function renderMeal(mealType, entries) {
  const entriesForMeal = entries.filter(e => String(e.meal_type).toLowerCase() === mealType.toLowerCase());
  if (!entriesForMeal.length) return '';

  return `<div class="card" style="margin-bottom:12px">
    <div class="meal-header">
      <h3>${esc(mealType)}</h3>
      <div class="actions"><button data-save-meal="${esc(mealType)}">Save</button><button data-copy-meal="${esc(mealType)}">Copy</button></div>
    </div>
    ${entriesForMeal.map(renderEntry).join('')}
  </div>`;
}

function renderEntry(entry) {
  return `<div class="entry">
    <div class="entry-main">
      <div class="entry-name">${esc(entry.food_name)}</div>
      <div class="entry-meta">${amount(entry.servings)} × ${esc(entry.serving_size)}</div>
      <div class="entry-macros">${Math.round(num(entry.protein)*num(entry.servings))}g protein • ${Math.round(num(entry.carbs)*num(entry.servings))}g carbs • ${Math.round(num(entry.fat)*num(entry.servings))}g fat • ${Math.round(num(entry.fiber)*num(entry.servings))}g fiber</div>
    </div>
    <div>
      <strong>${Math.round(num(entry.calories)*num(entry.servings))} cal</strong>
      <div class="entry-actions"><button data-edit-entry="${entry.id}">Edit</button><button class="ghost" data-delete-entry="${entry.id}">Delete</button></div>
    </div>
  </div>`;
}

function renderFoods() {
  const foods = [...state.foods].sort(sortByName);
  $('foods-page').innerHTML = `<div class="actions" style="margin-bottom:14px"><button class="primary" id="new-food-btn">+ Add Food</button></div><div class="card"><label>Search foods<input id="food-search" placeholder="Search foods..."></label></div><div id="food-list" class="grid" style="margin-top:14px"></div>`;
  const list = $('food-list');

  const draw = () => {
    const query = $('food-search').value.trim().toLowerCase();
    const filtered = foods.filter(food => food.name.toLowerCase().includes(query));
    list.innerHTML = filtered.length ? filtered.map(food => `<div class="card"><div class="entry">
      <div class="entry-main"><div class="entry-name">${esc(food.name)}</div><div class="entry-meta">${esc(food.serving_size)}</div><div class="entry-macros">${Math.round(num(food.calories))} cal • ${Math.round(num(food.protein))}g protein • ${Math.round(num(food.carbs))}g carbs • ${Math.round(num(food.fat))}g fat • ${Math.round(num(food.fiber))}g fiber</div></div>
      <div class="entry-actions"><button data-fav-food="${food.id}">${food.is_favorite ? '★' : '☆'}</button><button class="primary" data-food-log="${food.id}">Log</button><button data-food-edit="${food.id}">Edit</button><button data-food-delete="${food.id}">Delete</button></div>
    </div></div>`).join('') : '<div class="card empty">No matching foods.</div>';

    document.querySelectorAll('[data-fav-food]').forEach(button => button.onclick = () => toggleFavorite(Number(button.dataset.favFood)));
    document.querySelectorAll('[data-food-log]').forEach(button => button.onclick = () => openLogFoodModal(Number(button.dataset.foodLog), todayString()));
    document.querySelectorAll('[data-food-edit]').forEach(button => button.onclick = () => openFoodEditModal(Number(button.dataset.foodEdit)));
    document.querySelectorAll('[data-food-delete]').forEach(button => button.onclick = () => confirmDeleteFood(Number(button.dataset.foodDelete)));
  };

  $('food-search').oninput = draw;
  $('new-food-btn').onclick = () => openFoodEditModal(null);
  draw();
}

function recipeNutrition(recipeId) {
  const recipe = state.recipes.find(r => r.id === recipeId);
  if (!recipe) return { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
  const ingredients = state.recipeIngredients.filter(i => i.recipe_id === recipeId);
  const divide = Math.max(num(recipe.servings), 1);
  const nutrient = key => ingredients.reduce((sum, item) => sum + num(item[key]) * num(item.quantity), 0) / divide;
  return { calories:nutrient('calories'), protein:nutrient('protein'), carbs:nutrient('carbs'), fat:nutrient('fat'), fiber:nutrient('fiber') };
}

function renderRecipes() {
  $('recipes-page').innerHTML = `<div class="actions" style="margin-bottom:14px"><button class="primary" id="new-recipe-btn">+ Recipe</button></div><div class="grid">${state.recipes.length ? state.recipes.map(renderRecipe).join('') : '<div class="card empty">No recipes yet. Create one from your saved foods.</div>'}</div>`;
  $('new-recipe-btn').onclick = () => openRecipeModal(null);
  document.querySelectorAll('[data-recipe-log]').forEach(button => button.onclick = () => openRecipeLogModal(Number(button.dataset.recipeLog)));
  document.querySelectorAll('[data-recipe-edit]').forEach(button => button.onclick = () => openRecipeModal(Number(button.dataset.recipeEdit)));
  document.querySelectorAll('[data-recipe-delete]').forEach(button => button.onclick = () => confirmDeleteRecipe(Number(button.dataset.recipeDelete)));
}

function renderRecipe(recipe) {
  const nutrition = recipeNutrition(recipe.id);
  const ingredients = state.recipeIngredients.filter(i => i.recipe_id === recipe.id);
  return `<div class="card"><div class="meal-header"><div><h2>${esc(recipe.name)}</h2><div class="muted">${recipe.servings} servings</div></div><div class="actions"><button class="primary" data-recipe-log="${recipe.id}">Log</button><button data-recipe-edit="${recipe.id}">Edit</button><button data-recipe-delete="${recipe.id}">Delete</button></div></div>
    <div style="margin-top:10px"><strong>${Math.round(nutrition.calories)} calories per serving</strong><div class="muted">${Math.round(nutrition.protein)}g protein • ${Math.round(nutrition.carbs)}g carbs • ${Math.round(nutrition.fat)}g fat • ${Math.round(nutrition.fiber)}g fiber</div></div>
    <div style="margin-top:12px">${ingredients.map(i => `<div class="recipe-ingredient"><span>• ${amount(i.quantity)} × ${esc(i.serving_size)} ${esc(i.food_name)}</span></div>`).join('')}</div></div>`;
}

function renderHistory() {
  const today = todayString();
  const start = shiftDate(today, -6);
  const seven = state.entries.filter(e => e.date >= start && e.date <= today);
  const daysLogged = new Set(seven.map(e => e.date)).size;
  const avg = key => seven.reduce((sum, e) => sum + num(e[key]) * num(e.servings), 0) / 7;
  const days = [...new Set(state.entries.map(e => e.date))].sort().reverse();

  $('history-page').innerHTML = `<div class="card"><div class="section-title" style="margin-top:0"><h2>7-Day Overview</h2></div><div class="muted">${fmtShortDate(start)} – ${fmtDate(today)}</div><div class="kpi" style="margin-top:14px"><div><div class="big">${daysLogged} / 7</div><div class="muted">Days logged</div></div><div class="muted">Daily averages</div></div>${historyStat('Calories',avg('calories'),num(state.goals.calorie_goal),'cal')}${historyStat('Protein',avg('protein'),num(state.goals.protein_goal),'g')}${historyStat('Carbs',avg('carbs'),num(state.goals.carbs_goal),'g')}${historyStat('Fat',avg('fat'),num(state.goals.fat_goal),'g')}${historyStat('Fiber',avg('fiber'),num(state.goals.fiber_goal),'g')}</div><div class="section-title"><h2>History</h2><span class="muted">Tap a day</span></div><div class="day-list">${days.length ? days.map(historyDay).join('') : '<div class="card empty">No food history yet.</div>'}</div>`;

  document.querySelectorAll('[data-history-date]').forEach(card => card.onclick = () => { selectedDate = card.dataset.historyDate; navigate('today'); });
  document.querySelectorAll('[data-history-delete]').forEach(button => { button.onclick = event => { event.stopPropagation(); confirmDeleteEntry(Number(button.dataset.historyDelete)); }; });
}

function historyStat(label, average, goal, unit) {
  const pct = progressPercent(average, goal);
  const actualPct = goal > 0 ? Math.round((average / goal) * 100) : 0;
  return `<div class="stat-row"><div class="stat-top"><strong>${esc(label)}</strong><span>${Math.round(average)} ${unit} / ${Math.round(goal)} ${unit}</span></div><div class="progress"><span style="width:${pct}%"></span></div><div class="inline-note">${actualPct}% of daily goal</div></div>`;
}

function historyDay(date) {
  const entries = getDateEntries(date);
  const calories = total(entries,'calories');
  const protein = total(entries,'protein');
  const carbs = total(entries,'carbs');
  const fat = total(entries,'fat');
  const fiber = total(entries,'fiber');
  return `<div class="card day-card" data-history-date="${date}"><div class="meal-header"><h3>${esc(fmtDate(date))}</h3><span class="muted">View →</span></div><div style="margin-top:8px"><strong>${Math.round(calories)} calories</strong><div class="muted">${Math.round(protein)}g protein • ${Math.round(carbs)}g carbs • ${Math.round(fat)}g fat • ${Math.round(fiber)}g fiber</div></div>${entries.map(entry => `<div class="entry"><div class="entry-main"><div class="entry-name">${esc(entry.food_name)}</div><div class="entry-meta">${esc(entry.meal_type)} • ${amount(entry.servings)} × ${esc(entry.serving_size)}</div></div><button class="ghost" data-history-delete="${entry.id}">Delete</button></div>`).join('')}</div>`;
}

function renderSettings() {
  const goals = state.goals;
  $('settings-page').innerHTML = `<div class="card"><h2>Nutrition Goals</h2><p class="muted">These goals are stored in the cloud with your account.</p><form id="goals-form" class="two-col-form"><label>Calories<input name="calorie_goal" type="number" min="0" step="1" value="${num(goals.calorie_goal)}"></label><label>Protein (g)<input name="protein_goal" type="number" min="0" step="0.1" value="${num(goals.protein_goal)}"></label><label>Carbs (g)<input name="carbs_goal" type="number" min="0" step="0.1" value="${num(goals.carbs_goal)}"></label><label>Fat (g)<input name="fat_goal" type="number" min="0" step="0.1" value="${num(goals.fat_goal)}"></label><label>Fiber (g)<input name="fiber_goal" type="number" min="0" step="0.1" value="${num(goals.fiber_goal)}"></label></form><div class="actions" style="margin-top:14px"><button class="primary" id="save-goals">Save Goals</button><button id="export-data">Export Backup</button><button id="import-data">Import Backup</button><input id="import-file" class="hidden" type="file" accept="application/json"></div></div><div class="card" style="margin-top:14px"><h2>Account</h2><div class="muted">${esc(currentUser?.email || '')}</div><div class="actions" style="margin-top:12px"><button id="signout-secondary" class="ghost">Log Out</button></div></div>`;

  $('save-goals').onclick = async () => {
    const form = $('goals-form');
    try {
      const payload = { user_id: currentUser.id, calorie_goal:num(form.calorie_goal.value), protein_goal:num(form.protein_goal.value), carbs_goal:num(form.carbs_goal.value), fat_goal:num(form.fat_goal.value), fiber_goal:num(form.fiber_goal.value) };
      await dbUpsert('daily_goals', payload);
      state.goals = payload;
      showToast('Goals saved.');
      renderSettings();
    } catch (error) { showToast(error.message, true); }
  };
  $('signout-secondary').onclick = signOut;
  $('export-data').onclick = exportBackup;
  $('import-data').onclick = () => $('import-file').click();
  $('import-file').onchange = importBackup;
}

async function openAddFoodModal(date) {
  openModal(`<div class="modal-header"><h2>Add Food</h2><button class="ghost" data-close>Close</button></div><form id="add-food-form" class="modal-body"><label>Food name<input name="name" required></label><label>Serving size<input name="serving_size" placeholder="Examples: 4 oz, 150 g, 1 slice" required></label><div class="two-col-form"><label>Calories<input name="calories" type="number" min="0" step="1" required></label><label>Protein (g)<input name="protein" type="number" min="0" step="0.1" required></label><label>Carbs (g)<input name="carbs" type="number" min="0" step="0.1" required></label><label>Fat (g)<input name="fat" type="number" min="0" step="0.1" required></label><label>Fiber (g)<input name="fiber" type="number" min="0" step="0.1" required></label><label>Servings to log<input name="servings" type="number" min="0.01" step="0.25" value="1" required></label></div><label>Meal<select name="meal_type"><option>Breakfast</option><option>Lunch</option><option selected>Dinner</option><option>Snack</option></select></label></form><div class="modal-footer"><button class="ghost" data-close>Cancel</button><button class="primary" id="add-food-submit">Save & Log</button></div>`);
  $('add-food-submit').onclick = async () => {
    const form = $('add-food-form');
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    try {
      const food = await dbInsert('foods', { user_id:currentUser.id, name:data.name.trim(), serving_size:data.serving_size.trim(), calories:num(data.calories), protein:num(data.protein), carbs:num(data.carbs), fat:num(data.fat), fiber:num(data.fiber) });
      await dbInsert('meal_entries', { user_id:currentUser.id, food_id:food.id, date, meal_type:data.meal_type, servings:Math.max(num(data.servings),.01), entry_type:'FOOD', recipe_id:null, food_name:food.name, serving_size:food.serving_size, calories:food.calories, protein:food.protein, carbs:food.carbs, fat:food.fat, fiber:food.fiber });
      closeModal(); await loadAll(); renderCurrentPage(); showToast(`Food added to ${fmtDate(date)}.`);
    } catch (error) { showToast(error.message, true); }
  };
}

async function openFoodEditModal(id) {
  const food = id ? state.foods.find(f => f.id === id) : null;
  openModal(`<div class="modal-header"><h2>${food?'Edit Food':'Add Food'}</h2><button class="ghost" data-close>Close</button></div><form id="food-edit-form" class="modal-body"><label>Food name<input name="name" value="${esc(food?.name||'')}" required></label><label>Serving size<input name="serving_size" value="${esc(food?.serving_size||'')}" required></label><div class="two-col-form"><label>Calories<input name="calories" type="number" min="0" step="1" value="${num(food?.calories)}" required></label><label>Protein (g)<input name="protein" type="number" min="0" step="0.1" value="${num(food?.protein)}" required></label><label>Carbs (g)<input name="carbs" type="number" min="0" step="0.1" value="${num(food?.carbs)}" required></label><label>Fat (g)<input name="fat" type="number" min="0" step="0.1" value="${num(food?.fat)}" required></label><label>Fiber (g)<input name="fiber" type="number" min="0" step="0.1" value="${num(food?.fiber)}" required></label></div></form><div class="modal-footer"><button class="ghost" data-close>Cancel</button><button class="primary" id="food-edit-submit">Save</button></div>`);
  $('food-edit-submit').onclick = async () => {
    const form = $('food-edit-form'); if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    try {
      if (food) {
        await dbUpsert('foods', { id:food.id, user_id:currentUser.id, name:data.name.trim(), serving_size:data.serving_size.trim(), calories:num(data.calories), protein:num(data.protein), carbs:num(data.carbs), fat:num(data.fat), fiber:num(data.fiber), is_favorite:food.is_favorite });
      } else {
        await dbInsert('foods', { user_id:currentUser.id, name:data.name.trim(), serving_size:data.serving_size.trim(), calories:num(data.calories), protein:num(data.protein), carbs:num(data.carbs), fat:num(data.fat), fiber:num(data.fiber) });
      }
      closeModal(); await loadAll(); renderCurrentPage(); showToast(food ? 'Food updated.' : 'Food saved.');
    } catch (error) { showToast(error.message, true); }
  };
}

async function toggleFavorite(id) {
  const food = state.foods.find(f => f.id === id); if (!food) return;
  try { await dbUpsert('foods', { ...food, user_id:currentUser.id, is_favorite:!food.is_favorite }); await loadAll(); renderFoods(); } catch (error) { showToast(error.message, true); }
}

async function confirmDeleteFood(id) {
  const food = state.foods.find(f => f.id === id); if (!food) return;
  if (!confirm(`Delete ${food.name} from your food library? Existing history stays.`)) return;
  try { await dbDelete('foods', id); await loadAll(); renderFoods(); showToast('Food deleted.'); } catch (error) { showToast(error.message, true); }
}

async function confirmDeleteEntry(id) {
  if (!confirm('Delete this meal entry?')) return;
  try { await dbDelete('meal_entries', id); await loadAll(); renderCurrentPage(); showToast('Entry deleted.'); } catch (error) { showToast(error.message, true); }
}

function parseServing(servingSize) {
  const match = String(servingSize || '').match(/^\s*([0-9]+(?:\.[0-9]+)?)\s*(.*?)\s*$/);
  if (!match) return { amount:1, unit:servingSize || 'serving' };
  return { amount:Math.max(num(match[1]), 0.01), unit:match[2].trim() || 'serving' };
}

async function openLogFoodModal(foodId, date) {
  const food = state.foods.find(f => f.id === foodId); if (!food) return;
  const parsed = parseServing(food.serving_size);
  openModal(`<div class="modal-header"><h2>Log Food</h2><button class="ghost" data-close>Close</button></div><form id="log-food-form" class="modal-body"><div><h3>${esc(food.name)}</h3><div class="muted">1 serving = ${esc(food.serving_size)}</div></div><label>Meal<select name="meal_type"><option>Breakfast</option><option>Lunch</option><option selected>Dinner</option><option>Snack</option></select></label><label>Amount eaten (${esc(parsed.unit)})<input id="food-amount" name="amount" type="number" min="0.01" step="0.01" value="${parsed.amount}" required></label><div class="actions">${[0.5,1,1.5,2].map(m=>`<button type="button" data-amount-mult="${m}">${m}×</button>`).join('')}</div><div id="food-preview" class="card"></div></form><div class="modal-footer"><button class="ghost" data-close>Cancel</button><button class="primary" id="log-food-submit">Log Food</button></div>`);
  const updatePreview = () => { const servings = parsed.amount > 0 ? num($('food-amount').value) / parsed.amount : 0; $('food-preview').innerHTML = `<strong>${Math.round(food.calories*servings)} calories</strong><div class="muted">${Math.round(food.protein*servings)}g protein • ${Math.round(food.carbs*servings)}g carbs • ${Math.round(food.fat*servings)}g fat • ${Math.round(food.fiber*servings)}g fiber</div>`; };
  $('food-amount').oninput = updatePreview;
  document.querySelectorAll('[data-amount-mult]').forEach(button => button.onclick = () => { $('food-amount').value = amount(parsed.amount * num(button.dataset.amountMult)); updatePreview(); });
  updatePreview();
  $('log-food-submit').onclick = async () => { const form=$('log-food-form'); if(!form.reportValidity())return; const data=Object.fromEntries(new FormData(form)); const servings=parsed.amount>0?num(data.amount)/parsed.amount:1; try{await dbInsert('meal_entries',{user_id:currentUser.id,food_id:food.id,date,meal_type:data.meal_type,servings:Math.max(servings,.01),entry_type:'FOOD',recipe_id:null,food_name:food.name,serving_size:food.serving_size,calories:food.calories,protein:food.protein,carbs:food.carbs,fat:food.fat,fiber:food.fiber});closeModal();await loadAll();renderCurrentPage();showToast(`Logged to ${fmtDate(date)}.`);}catch(error){showToast(error.message,true);} };
}

async function openEditEntryModal(id) {
  const entry = state.entries.find(e => e.id === id); if (!entry) return;
  const parsed = parseServing(entry.serving_size);
  openModal(`<div class="modal-header"><h2>Edit Food Entry</h2><button class="ghost" data-close>Close</button></div><form id="edit-entry-form" class="modal-body"><div><h3>${esc(entry.food_name)}</h3><div class="muted">${fmtDate(entry.date)} • ${esc(entry.serving_size)}</div></div><label>Meal<select name="meal_type">${['Breakfast','Lunch','Dinner','Snack'].map(m=>`<option ${m===entry.meal_type?'selected':''}>${m}</option>`).join('')}</select></label><label>Amount eaten (${esc(parsed.unit)})<input name="amount" type="number" min="0.01" step="0.01" value="${amount(parsed.amount*num(entry.servings))}" required></label><div id="edit-entry-preview" class="card"></div></form><div class="modal-footer"><button class="ghost" data-close>Cancel</button><button class="primary" id="edit-entry-submit">Save Changes</button></div>`);
  const preview = () => { const s=parsed.amount>0?num(document.querySelector('#edit-entry-form [name="amount"]').value)/parsed.amount:0; $('edit-entry-preview').innerHTML=`<strong>${Math.round(entry.calories*s)} calories</strong><div class="muted">${Math.round(entry.protein*s)}g protein • ${Math.round(entry.carbs*s)}g carbs • ${Math.round(entry.fat*s)}g fat • ${Math.round(entry.fiber*s)}g fiber</div>`; };
  document.querySelector('#edit-entry-form [name="amount"]').oninput=preview; preview();
  $('edit-entry-submit').onclick=async()=>{const form=$('edit-entry-form');if(!form.reportValidity())return;const data=Object.fromEntries(new FormData(form));const s=parsed.amount>0?num(data.amount)/parsed.amount:1;try{await dbUpsert('meal_entries',{...entry,user_id:currentUser.id,meal_type:data.meal_type,servings:Math.max(s,.01)});closeModal();await loadAll();renderCurrentPage();showToast('Entry updated.');}catch(error){showToast(error.message,true);}};
}

function openSaveMealModal(mealType) {
  const entries = getMealEntries(mealType); if (!entries.length) return;
  openModal(`<div class="modal-header"><h2>Save ${esc(mealType)}</h2><button class="ghost" data-close>Close</button></div><form id="save-meal-form" class="modal-body"><p class="muted">Save the current ${esc(mealType)} entries as a reusable meal.</p><label>Meal name<input name="name" value="${esc(mealType)} Meal" required></label><div class="card"><strong>${entries.length} items</strong><div>${Math.round(total(entries,'calories'))} calories • ${Math.round(total(entries,'protein'))}g protein</div></div></form><div class="modal-footer"><button class="ghost" data-close>Cancel</button><button class="primary" id="save-meal-submit">Save Meal</button></div>`);
  $('save-meal-submit').onclick=async()=>{const form=$('save-meal-form');if(!form.reportValidity())return;const data=Object.fromEntries(new FormData(form));try{const template=await dbInsert('meal_templates',{user_id:currentUser.id,name:data.name.trim(),meal_type:mealType});const rows=entries.map(e=>({user_id:currentUser.id,template_id:template.id,food_id:e.food_id||null,entry_type:e.entry_type,recipe_id:e.recipe_id||null,food_name:e.food_name,serving_size:e.serving_size,servings:e.servings,calories:e.calories,protein:e.protein,carbs:e.carbs,fat:e.fat,fiber:e.fiber}));const {error}=await supabaseClient.from('meal_template_entries').insert(rows);if(error)throw error;closeModal();await loadAll();renderToday();showToast('Saved meal created.');}catch(error){showToast(error.message,true);}};
}

async function openSavedMealsModal() {
  openModal(`<div class="modal-header"><div><h2>Saved Meals</h2><div class="muted">Logging to ${esc(fmtDate(selectedDate))}</div></div><button class="ghost" data-close>Close</button></div><div class="modal-body">${state.templates.length?state.templates.map(t=>{const count=state.templateEntries.filter(e=>e.template_id===t.id).length;return `<div class="card"><div class="meal-header"><div><h3>${esc(t.name)}</h3><div class="muted">${esc(t.meal_type)} • ${count} items</div></div><div class="actions"><button class="primary" data-template-log="${t.id}">Log</button><button data-template-delete="${t.id}">Delete</button></div></div></div>`;}).join(''):'<div class="empty">No saved meals yet.</div>'}</div>`);
  document.querySelectorAll('[data-template-log]').forEach(button=>button.onclick=()=>logTemplate(Number(button.dataset.templateLog)));
  document.querySelectorAll('[data-template-delete]').forEach(button=>button.onclick=()=>deleteTemplate(Number(button.dataset.templateDelete)));
}

async function logTemplate(templateId) {
  const template = state.templates.find(t=>t.id===templateId); if(!template)return;
  const entries=state.templateEntries.filter(e=>e.template_id===templateId); if(!entries.length){showToast('This saved meal has no entries.',true);return;}
  try{const rows=entries.map(e=>({user_id:currentUser.id,food_id:e.food_id||null,date:selectedDate,meal_type:template.meal_type,servings:e.servings,entry_type:e.entry_type,recipe_id:e.recipe_id||null,food_name:e.food_name,serving_size:e.serving_size,calories:e.calories,protein:e.protein,carbs:e.carbs,fat:e.fat,fiber:e.fiber}));const {error}=await supabaseClient.from('meal_entries').insert(rows);if(error)throw error;closeModal();await loadAll();renderToday();showToast(`${template.name} logged.`);}catch(error){showToast(error.message,true);}}

async function deleteTemplate(id) {
  if(!confirm('Delete this saved meal?'))return;
  try{const {error:a}=await supabaseClient.from('meal_template_entries').delete().eq('template_id',id);if(a)throw a;const {error:b}=await supabaseClient.from('meal_templates').delete().eq('id',id);if(b)throw b;await loadAll();openSavedMealsModal();showToast('Saved meal deleted.');}catch(error){showToast(error.message,true);}}

function openCopyModal(mealType) {
  openModal(`<div class="modal-header"><h2>${mealType?`Copy ${esc(mealType)}`:'Copy Entire Day'}</h2><button class="ghost" data-close>Close</button></div><form id="copy-form" class="modal-body"><p class="muted">Copy ${mealType?`the ${esc(mealType)} entries`:'all entries'} from ${esc(fmtDate(selectedDate))} to another date.</p><label>Destination date<input name="destination" type="date" max="${todayString()}" value="${todayString()}" required></label><div class="inline-note">Existing destination entries are kept; copied entries are added.</div></form><div class="modal-footer"><button class="ghost" data-close>Cancel</button><button class="primary" id="copy-submit">Copy</button></div>`);
  $('copy-submit').onclick=async()=>{const form=$('copy-form');if(!form.reportValidity())return;const data=Object.fromEntries(new FormData(form));if(data.destination===selectedDate){showToast('Choose a different date.',true);return;}const entries=mealType?getMealEntries(mealType):getDateEntries();try{const rows=entries.map(e=>({user_id:currentUser.id,food_id:e.food_id||null,date:data.destination,meal_type:e.meal_type,servings:e.servings,entry_type:e.entry_type,recipe_id:e.recipe_id||null,food_name:e.food_name,serving_size:e.serving_size,calories:e.calories,protein:e.protein,carbs:e.carbs,fat:e.fat,fiber:e.fiber}));if(rows.length){const {error}=await supabaseClient.from('meal_entries').insert(rows);if(error)throw error;}closeModal();await loadAll();renderToday();showToast(`Copied to ${fmtDate(data.destination)}.`);}catch(error){showToast(error.message,true);}};
}

function openRecipeModal(id = null, draft = null) {
  const existing = id ? state.recipes.find(r => r.id === id) : null;
  let name = draft?.name ?? existing?.name ?? '';
  let servings = draft?.servings ?? existing?.servings ?? 4;
  let ingredients = (draft?.ingredients ?? (existing ? state.recipeIngredients.filter(i => i.recipe_id === id).map(i=>({...i})) : [])).map(i => ({...i}));

  const redraw = () => {
    const list = $('recipe-ingredients-list');
    if (!ingredients.length) { list.innerHTML='<div class="empty">No ingredients added yet.</div>'; return; }
    list.innerHTML=ingredients.map((ingredient,index)=>`<div class="entry"><div class="entry-main"><strong>${esc(ingredient.food_name)}</strong><div class="muted">${esc(ingredient.serving_size)}</div></div><input data-ingredient-qty="${index}" type="number" min="0.01" step="0.25" value="${amount(ingredient.quantity)}" style="max-width:100px"><button type="button" data-remove-ingredient="${index}">Remove</button></div>`).join('');
    document.querySelectorAll('[data-remove-ingredient]').forEach(button=>button.onclick=()=>{ingredients.splice(Number(button.dataset.removeIngredient),1);redraw();});
    document.querySelectorAll('[data-ingredient-qty]').forEach(input=>input.onchange=()=>{ingredients[Number(input.dataset.ingredientQty)].quantity=Math.max(num(input.value),.01);});
  };

  openModal(`<div class="modal-header"><h2>${existing?'Edit Recipe':'Create Recipe'}</h2><button class="ghost" data-close>Close</button></div><form id="recipe-form" class="modal-body"><label>Recipe name<input name="name" value="${esc(name)}" required></label><label>Recipe servings<input name="servings" type="number" min="1" step="1" value="${servings}" required></label><div class="section-title"><h3>Ingredients</h3><button type="button" id="recipe-add-ingredient">+ Add Ingredient</button></div><div id="recipe-ingredients-list"></div></form><div class="modal-footer"><button class="ghost" data-close>Cancel</button><button class="primary" id="recipe-save">Save Recipe</button></div>`);
  redraw();
  $('recipe-add-ingredient').onclick=()=>openFoodPicker(ingredients,()=>openRecipeModal(id,{name:$('recipe-form')?.name?.value||name,servings:num($('recipe-form')?.servings?.value)||servings,ingredients}));
  $('recipe-save').onclick=async()=>{const form=$('recipe-form');if(!form.reportValidity()||!ingredients.length){if(!ingredients.length)showToast('Add at least one ingredient.',true);return;}document.querySelectorAll('[data-ingredient-qty]').forEach(input=>{ingredients[Number(input.dataset.ingredientQty)].quantity=Math.max(num(input.value),.01);});const data=Object.fromEntries(new FormData(form));try{let recipe;if(existing){recipe=await dbUpsert('recipes',{...existing,user_id:currentUser.id,name:data.name.trim(),servings:Math.max(parseInt(data.servings,10)||1,1)});}else{recipe=await dbInsert('recipes',{user_id:currentUser.id,name:data.name.trim(),servings:Math.max(parseInt(data.servings,10)||1,1)});}if(existing){const {error}=await supabaseClient.from('recipe_ingredients').delete().eq('recipe_id',id);if(error)throw error;}const rows=ingredients.map(i=>({user_id:currentUser.id,recipe_id:recipe.id,food_id:i.food_id||null,food_name:i.food_name,serving_size:i.serving_size,calories:i.calories,protein:i.protein,carbs:i.carbs,fat:i.fat,fiber:i.fiber,quantity:i.quantity}));const {error}=await supabaseClient.from('recipe_ingredients').insert(rows);if(error)throw error;closeModal();await loadAll();renderRecipes();showToast('Recipe saved.');}catch(error){showToast(error.message,true);}};
}

function openFoodPicker(ingredients, returnToRecipe) {
  const previous = ingredients.map(i=>({...i}));
  openModal(`<div class="modal-header"><h2>Choose Food</h2><button class="ghost" data-close>Close</button></div><div class="modal-body"><input id="picker-search" placeholder="Search foods..."><div id="picker-list"></div></div>`);
  const draw=()=>{const q=$('picker-search').value.trim().toLowerCase();const filtered=state.foods.filter(f=>f.name.toLowerCase().includes(q));$('picker-list').innerHTML=filtered.length?filtered.map(f=>`<div class="entry" data-picker-food="${f.id}"><div class="entry-main"><strong>${esc(f.name)}</strong><div class="muted">${esc(f.serving_size)} • ${Math.round(num(f.calories))} cal</div></div><button>Select</button></div>`).join(''):'<div class="empty">No foods found.</div>';document.querySelectorAll('[data-picker-food]').forEach(row=>row.onclick=()=>{const food=state.foods.find(f=>f.id===Number(row.dataset.pickerFood));closeModal();previous.push({food_id:food.id,food_name:food.name,serving_size:food.serving_size,calories:food.calories,protein:food.protein,carbs:food.carbs,fat:food.fat,fiber:food.fiber,quantity:1});returnToRecipe(previous);});};$('picker-search').oninput=draw;draw();}

async function openRecipeLogModal(id){const recipe=state.recipes.find(r=>r.id===id);if(!recipe)return;const nutrition=recipeNutrition(id);openModal(`<div class="modal-header"><h2>Log Recipe</h2><button class="ghost" data-close>Close</button></div><form id="recipe-log-form" class="modal-body"><h3>${esc(recipe.name)}</h3><div class="muted">${Math.round(nutrition.calories)} calories per serving</div><label>Meal<select name="meal_type"><option>Breakfast</option><option>Lunch</option><option selected>Dinner</option><option>Snack</option></select></label><label>Servings eaten<input name="servings" type="number" min="0.25" step="0.25" value="1" required></label><div class="card"><strong id="recipe-log-preview">${Math.round(nutrition.calories)} calories</strong><div class="muted">${Math.round(nutrition.protein)}g protein • ${Math.round(nutrition.carbs)}g carbs • ${Math.round(nutrition.fat)}g fat • ${Math.round(nutrition.fiber)}g fiber</div></div></form><div class="modal-footer"><button class="ghost" data-close>Cancel</button><button class="primary" id="recipe-log-submit">Log Recipe</button></div>`);$('recipe-log-form [name="servings"]').oninput=()=>{const s=Math.max(num($('recipe-log-form [name="servings"]').value),0);$('recipe-log-preview').textContent=`${Math.round(nutrition.calories*s)} calories`;};$('recipe-log-submit').onclick=async()=>{const form=$('recipe-log-form');if(!form.reportValidity())return;const data=Object.fromEntries(new FormData(form));const servings=Math.max(num(data.servings),.25);try{await dbInsert('meal_entries',{user_id:currentUser.id,date:selectedDate,meal_type:data.meal_type,servings,entry_type:'RECIPE',food_id:null,recipe_id:recipe.id,food_name:recipe.name,serving_size:'1 recipe serving',calories:nutrition.calories,protein:nutrition.protein,carbs:nutrition.carbs,fat:nutrition.fat,fiber:nutrition.fiber});closeModal();await loadAll();renderCurrentPage();showToast(`Recipe logged to ${fmtDate(selectedDate)}.`);}catch(error){showToast(error.message,true);}};}

async function confirmDeleteRecipe(id){const recipe=state.recipes.find(r=>r.id===id);if(!recipe||!confirm(`Delete ${recipe.name}? Existing history remains.`))return;try{const {error:a}=await supabaseClient.from('recipe_ingredients').delete().eq('recipe_id',id);if(a)throw a;const {error:b}=await supabaseClient.from('recipes').delete().eq('id',id);if(b)throw b;await loadAll();renderRecipes();showToast('Recipe deleted.');}catch(error){showToast(error.message,true);}}

async function exportBackup(){try{const backup={version:1,exportedAt:new Date().toISOString(),foods:state.foods,meal_entries:state.entries,recipes:state.recipes,recipe_ingredients:state.recipeIngredients,daily_goals:state.goals,meal_templates:state.templates,meal_template_entries:state.templateEntries};const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`foodtracker-backup-${todayString()}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);showToast('Backup exported.');}catch(error){showToast(error.message,true);}}

async function importBackup(event){const file=event.target.files?.[0];if(!file)return;try{const data=JSON.parse(await file.text());if(!data||!Array.isArray(data.foods))throw new Error('That file does not look like a FoodTracker backup.');if(!confirm('Importing will add backup data to this account. Existing data will not be deleted. Continue?'))return;const foodMap=new Map();for(const food of data.foods){const inserted=await dbInsert('foods',{user_id:currentUser.id,name:food.name,serving_size:food.serving_size??food.servingSize,calories:num(food.calories),protein:num(food.protein),carbs:num(food.carbs),fat:num(food.fat),fiber:num(food.fiber),is_favorite:Boolean(food.is_favorite??food.isFavorite)});foodMap.set(String(food.id),inserted.id);}for(const entry of (data.meal_entries||[])){await dbInsert('meal_entries',{user_id:currentUser.id,food_id:entry.food_id?foodMap.get(String(entry.food_id))??null:null,date:entry.date,meal_type:entry.meal_type??entry.mealType,servings:num(entry.servings),entry_type:entry.entry_type??entry.entryType??'FOOD',recipe_id:null,food_name:entry.food_name??entry.foodName,serving_size:entry.serving_size??entry.servingSize,calories:num(entry.calories),protein:num(entry.protein),carbs:num(entry.carbs),fat:num(entry.fat),fiber:num(entry.fiber)});}if(data.daily_goals){await dbUpsert('daily_goals',{user_id:currentUser.id,calorie_goal:num(data.daily_goals.calorie_goal??data.daily_goals.calorieGoal),protein_goal:num(data.daily_goals.protein_goal??data.daily_goals.proteinGoal),carbs_goal:num(data.daily_goals.carbs_goal??data.daily_goals.carbsGoal),fat_goal:num(data.daily_goals.fat_goal??data.daily_goals.fatGoal),fiber_goal:num(data.daily_goals.fiber_goal??data.daily_goals.fiberGoal)});}await loadAll();renderSettings();showToast('Backup imported.');}catch(error){showToast(error.message||'Import failed.',true);}finally{event.target.value='';}}

async function signOut(){if(!supabaseClient)return;try{await supabaseClient.auth.signOut();}catch(error){showToast(error.message,true);}}

async function handlePasswordRecovery(){
  openModal(`<div class="modal-header"><h2>Set New Password</h2><button class="ghost" data-close>Close</button></div><form id="password-form" class="modal-body"><label>New password<input name="password" type="password" minlength="6" required></label><label>Confirm password<input name="confirm" type="password" minlength="6" required></label></form><div class="modal-footer"><button class="primary" id="password-submit">Update Password</button></div>`);
  $('password-submit').onclick=async()=>{const form=$('password-form');if(!form.reportValidity())return;const d=Object.fromEntries(new FormData(form));if(d.password!==d.confirm){showToast('Passwords do not match.',true);return;}try{const {error}=await supabaseClient.auth.updateUser({password:d.password});if(error)throw error;closeModal();showToast('Password updated.');}catch(error){showToast(error.message,true);}};
}

async function initAuth() {
  if (!createClient || !config.SUPABASE_URL || !config.SUPABASE_PUBLISHABLE_KEY || config.SUPABASE_PUBLISHABLE_KEY.includes('YOUR_')) {
    showAuthPanel('login', { preserveEmail: false });
    showAuthMessage('Add your Supabase URL and publishable key to config.js before signing in.', true, 'login');
    $('login-submit').disabled = true;
    $('signup-submit').disabled = true;
    $('reset-submit').disabled = true;
    return;
  }

  supabaseClient = createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY);
  displayAuthRedirectError();

  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    currentUser = session?.user || null;
    if (event === 'PASSWORD_RECOVERY' && currentUser) {
      await handlePasswordRecovery();
      return;
    }
    if (currentUser) {
      $('auth-view').classList.add('hidden');
      $('main-view').classList.remove('hidden');
      $('user-email').textContent = currentUser.email || '';
      try {
        await loadAll();
        navigate(activeTab);
      } catch (error) {
        showToast(error.message, true);
      }
    } else {
      $('main-view').classList.add('hidden');
      $('auth-view').classList.remove('hidden');
    }
  });

  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
    showAuthMessage(error.message, true, 'login');
    return;
  }

  currentUser = data.session?.user || null;
  if (currentUser) {
    $('auth-view').classList.add('hidden');
    $('main-view').classList.remove('hidden');
    $('user-email').textContent = currentUser.email || '';
    try {
      await loadAll();
      navigate(activeTab);
    } catch (error) {
      showToast(error.message, true);
    }
  }
}

function setupEvents() {
  document.querySelectorAll('.nav-btn').forEach(button => {
    button.onclick = () => navigate(button.dataset.tab);
  });
  $('signout-btn').onclick = signOut;

  $('show-signup').onclick = () => showAuthPanel('signup');
  $('show-reset').onclick = () => showAuthPanel('reset');
  $('signup-back-to-login').onclick = () => showAuthPanel('login');
  $('reset-back-to-login').onclick = () => showAuthPanel('login');

  $('login-form').onsubmit = async event => {
    event.preventDefault();
    clearAuthMessage();
    if (!supabaseClient) {
      showAuthMessage('Supabase is not configured yet. Check config.js.', true, 'login');
      return;
    }
    const submit = $('login-submit');
    submit.disabled = true;
    submit.textContent = 'Logging in…';
    try {
      const { error } = await supabaseClient.auth.signInWithPassword({
        email: $('login-email').value.trim(),
        password: $('login-password').value
      });
      if (error) throw error;
    } catch (error) {
      showAuthMessage(error.message, true, 'login');
    } finally {
      submit.disabled = false;
      submit.textContent = 'Log In';
    }
  };

  $('signup-form').onsubmit = async event => {
    event.preventDefault();
    clearAuthMessage();
    if (!supabaseClient) {
      showAuthMessage('Supabase is not configured yet. Check config.js.', true, 'signup');
      return;
    }

    const email = $('signup-email').value.trim();
    const password = $('signup-password').value;
    const confirmPassword = $('signup-confirm-password').value;
    if (password !== confirmPassword) {
      showAuthMessage('Your passwords do not match. Please try again.', true, 'signup');
      $('signup-confirm-password').focus();
      return;
    }

    const submit = $('signup-submit');
    submit.disabled = true;
    submit.textContent = 'Creating account…';
    try {
      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: getAppRedirectUrl()
        }
      });
      if (error) throw error;

      if (data.session) {
        showAuthMessage('Your account is ready. You are now signed in.', false, 'signup');
      } else {
        showAuthMessage(
          `Account request received for ${email}. Check your inbox (and Spam/Junk) for the confirmation email. The confirmation link will return you to FoodTracker. Once confirmed, you can log in here.`,
          false,
          'signup'
        );
        $('signup-password').value = '';
        $('signup-confirm-password').value = '';
      }
    } catch (error) {
      showAuthMessage(error.message || 'Account creation failed. Please try again.', true, 'signup');
    } finally {
      submit.disabled = false;
      submit.textContent = 'Create Account';
    }
  };

  $('reset-form').onsubmit = async event => {
    event.preventDefault();
    clearAuthMessage();
    if (!supabaseClient) {
      showAuthMessage('Supabase is not configured yet. Check config.js.', true, 'reset');
      return;
    }
    const email = $('reset-email').value.trim();
    const submit = $('reset-submit');
    submit.disabled = true;
    submit.textContent = 'Sending…';
    try {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: getAppRedirectUrl()
      });
      if (error) throw error;
      showAuthMessage('If an account exists for that email, a password reset link has been sent. Check your inbox and Spam/Junk folder.', false, 'reset');
    } catch (error) {
      showAuthMessage(error.message, true, 'reset');
    } finally {
      submit.disabled = false;
      submit.textContent = 'Send Reset Link';
    }
  };
}

setupEvents();
initAuth();
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
