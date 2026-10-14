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
  goals: defaultGoals(),
  plannedMeals: [],
  groceryManualItems: [],
  groceryRecipeIngredients: [],
  groceryChecks: [],
  plannerAvailable: false,
  groceryAvailable: false,
  featureErrors: {},
  showMoreNutrition: false,
  quickLogExpanded: false,
  foodFilter: 'all',
  foodSort: 'name',
  historyRange: 7,
  plannerAnchor: localDateString(new Date()),
  plannerSelectedDate: localDateString(new Date()),
  groceryCategory: 'All'
};

const $ = id => document.getElementById(id);

function todayString() { return localDateString(new Date()); }

function localDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function mondayOf(isoDate) {
  const d = dateFromString(isoDate);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return localDateString(d);
}

function plusDays(isoDate, days) { return shiftDate(isoDate, days); }

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

function downloadText(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function showPrintDocument(title, bodyHtml) {
  const w = window.open('', '_blank');
  if (!w) { showToast('Allow pop-ups to print or save this report as PDF.', true); return; }
  w.document.open();
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    body{font:14px/1.45 Arial,sans-serif;color:#161616;margin:32px}h1{font-size:24px;margin:0 0 5px}h2{font-size:17px;margin:22px 0 8px;border-bottom:1px solid #ccc;padding-bottom:5px}.muted{color:#555}.summary{display:grid;grid-template-columns:repeat(5,minmax(90px,1fr));gap:10px;margin:20px 0}.metric{border:1px solid #ddd;padding:10px;border-radius:8px}.metric strong{display:block;font-size:17px}.row{padding:8px 0;border-bottom:1px solid #eee;display:flex;justify-content:space-between;gap:12px}.check{display:inline-block;width:13px;height:13px;border:1px solid #333;margin-right:8px;vertical-align:middle}.checked{text-decoration:line-through;color:#666}.group{break-inside:avoid;margin:14px 0}@media print{body{margin:12mm}.noprint{display:none}.summary{grid-template-columns:repeat(5,1fr)}}
  </style></head><body>${bodyHtml}<div class="noprint muted" style="margin-top:28px">Use your browser's Print dialog and choose Save as PDF to export.</div><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));<\/script></body></html>`);
  w.document.close();
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

async function optionalRows(table, order) {
  try { return { rows: await dbQuery(table, order ? { order } : {}), error: null }; }
  catch (error) { return { rows: [], error }; }
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
    const { data, error } = await supabaseClient.from('meal_template_entries').select('*').in('template_id', ids).order('id');
    if (error) throw error;
    templateEntries = data || [];
  }

  const [plans, manual, recipeGroceries, checks] = await Promise.all([
    optionalRows('planned_meals', { column: 'planned_date' }),
    optionalRows('grocery_manual_items', { column: 'name' }),
    optionalRows('grocery_recipe_ingredients', { column: 'food_name' }),
    optionalRows('grocery_check_states', { column: 'item_key' })
  ]);

  state.foods = foods; state.entries = entries; state.recipes = recipes;
  state.recipeIngredients = recipeIngredients; state.templates = templates;
  state.templateEntries = templateEntries; state.goals = goals[0] || defaultGoals();
  state.plannedMeals = plans.rows; state.groceryManualItems = manual.rows;
  state.groceryRecipeIngredients = recipeGroceries.rows; state.groceryChecks = checks.rows;
  state.plannerAvailable = !plans.error;
  state.groceryAvailable = !manual.error && !recipeGroceries.error && !checks.error;
  state.featureErrors = {
    planned_meals: plans.error?.message || '',
    grocery_manual_items: manual.error?.message || '',
    grocery_recipe_ingredients: recipeGroceries.error?.message || '',
    grocery_check_states: checks.error?.message || ''
  };
}

function navigate(tab) {
  const validTabs = ['today','foods','recipes','history','planner','goals','settings'];
  if (!validTabs.includes(tab)) return;
  activeTab = tab;
  document.querySelectorAll('.nav-btn').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
  document.querySelectorAll('.page').forEach(page => page.classList.add('hidden'));
  $(`${tab}-page`).classList.remove('hidden');
  $('page-title').textContent = {today:'Today',foods:'Foods',recipes:'Recipes',history:'History',planner:'Weekly Planner',goals:'Goals',settings:'Settings'}[tab];
  renderCurrentPage();
}

function renderCurrentPage() {
  if (activeTab === 'today') renderToday();
  if (activeTab === 'foods') renderFoods();
  if (activeTab === 'recipes') renderRecipes();
  if (activeTab === 'history') renderHistory();
  if (activeTab === 'planner') renderPlanner();
  if (activeTab === 'goals') renderGoals();
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
  const cal = total(entries, 'calories'), protein = total(entries, 'protein');
  const carbs = total(entries, 'carbs'), fat = total(entries, 'fat'), fiber = total(entries, 'fiber');
  return `<div class="card"><div class="kpi"><div><div class="big">${Math.round(cal).toLocaleString()}</div><div class="muted">/ ${Math.round(num(state.goals.calorie_goal)).toLocaleString()} calories</div></div><div class="muted">Daily totals</div></div>
    <div class="progress" style="margin-top:10px"><span style="width:${progressPercent(cal,num(state.goals.calorie_goal))}%"></span></div>
    <div class="kpi" style="margin-top:16px"><strong>Protein</strong><span>${Math.round(protein)} / ${Math.round(num(state.goals.protein_goal))} g</span></div>
    <div class="progress" style="margin-top:6px"><span style="width:${progressPercent(protein,num(state.goals.protein_goal))}%"></span></div>
    <div class="actions" style="margin-top:14px"><button id="toggle-more-nutrition">${state.showMoreNutrition?'Hide':'More'} nutrition ${state.showMoreNutrition?'−':'+'}</button><button id="open-goals-from-today">Goals & progress</button></div>
    ${state.showMoreNutrition ? `<div class="grid grid-3 macro-more" style="margin-top:16px">${miniMacro('Carbs',carbs,num(state.goals.carbs_goal))}${miniMacro('Fat',fat,num(state.goals.fat_goal))}${miniMacro('Fiber',fiber,num(state.goals.fiber_goal))}</div>` : ''}
  </div>`;
}

function miniMacro(label,value,goal) { return `<div><strong>${Math.round(value)} / ${Math.round(goal)}g</strong><div class="muted">${esc(label)}</div></div>`; }

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
  const meals = ['Breakfast','Lunch','Dinner','Snack'];
  const isToday = selectedDate === todayString();
  const favoriteCount = state.foods.filter(f => f.is_favorite).length;
  const recentIds = [...new Set(state.entries.filter(e => e.food_id && e.entry_type !== 'RECIPE').map(e => e.food_id))].slice(0,5);
  const recentCount = recentIds.length;
  $('today-page').innerHTML = `${dateBar()}
    <div class="actions today-actions"><button class="primary" id="add-food-today">+ Add Food</button><button id="saved-meals-btn">Saved Meals</button><button id="weekly-planner-btn">Weekly Planner</button>${entries.length?'<button id="copy-day-btn">Copy Entire Day</button>':''}</div>
    ${nutritionCard(entries)}
    <div class="section-title"><h2>Meals</h2><button class="ghost" id="open-groceries-btn">Weekly Groceries</button></div>
    ${meals.map(meal=>renderMeal(meal,entries)).join('')}
    ${entries.length?'':`<div class="card empty">Nothing logged ${isToday?'today':`on ${esc(fmtDate(selectedDate))}`} yet.<br>Use <strong>+ Add Food</strong> or Quick Log to get started.</div>`}
    <div class="section-title"><h2>Quick Log</h2><button id="toggle-quick-log">${state.quickLogExpanded?'Collapse':'Expand'} · ${favoriteCount} favorites / ${recentCount} recent</button></div>
    ${state.quickLogExpanded?`<div class="card">${quickLogHtml()}</div>`:''}`;

  $('prev-day').onclick=()=>{selectedDate=shiftDate(selectedDate,-1);renderToday();};
  $('next-day').onclick=()=>{if(selectedDate<todayString()){selectedDate=shiftDate(selectedDate,1);renderToday();}};
  $('date-picker').onchange=e=>{if(e.target.value){selectedDate=e.target.value;renderToday();}};
  $('add-food-today').onclick=()=>openAddFoodModal(selectedDate);
  $('saved-meals-btn').onclick=openSavedMealsModal;
  $('weekly-planner-btn').onclick=()=>{state.plannerAnchor=selectedDate;state.plannerSelectedDate=selectedDate;navigate('planner');};
  $('open-groceries-btn').onclick=()=>{state.plannerAnchor=selectedDate;state.plannerSelectedDate=selectedDate;navigate('planner');renderPlanner(true);};
  $('toggle-more-nutrition')?.addEventListener('click',()=>{state.showMoreNutrition=!state.showMoreNutrition;renderToday();});
  $('open-goals-from-today')?.addEventListener('click',()=>navigate('goals'));
  $('toggle-quick-log').onclick=()=>{state.quickLogExpanded=!state.quickLogExpanded;renderToday();};
  if($('copy-day-btn'))$('copy-day-btn').onclick=()=>openCopyModal(null);
  document.querySelectorAll('[data-quick-food]').forEach(b=>b.onclick=()=>openLogFoodModal(Number(b.dataset.quickFood),selectedDate));
  document.querySelectorAll('[data-edit-entry]').forEach(b=>b.onclick=()=>openEditEntryModal(Number(b.dataset.editEntry)));
  document.querySelectorAll('[data-delete-entry]').forEach(b=>b.onclick=()=>confirmDeleteEntry(Number(b.dataset.deleteEntry)));
  document.querySelectorAll('[data-copy-meal]').forEach(b=>b.onclick=()=>openCopyModal(b.dataset.copyMeal));
  document.querySelectorAll('[data-save-meal]').forEach(b=>b.onclick=()=>openSaveMealModal(b.dataset.saveMeal));
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
  $('foods-page').innerHTML = `<div class="actions foods-toolbar"><button class="primary" id="new-food-btn">+ Add Food</button><button id="food-database-btn">Search Food Database</button><button id="export-foods-csv">Export CSV</button><button id="import-foods-csv-btn">Import CSV</button><input id="foods-csv-file" type="file" accept=".csv,text/csv" class="hidden"></div>
    <div class="card foods-filters"><label>Search name or serving size<input id="food-search" placeholder="Search foods or serving sizes…"></label>
      <div class="filter-sort-row"><div class="segmented" role="group" aria-label="Food filter">${[['all','All'],['favorites','Favorites'],['recent','Recent']].map(([v,l])=>`<button data-food-filter="${v}" class="${state.foodFilter===v?'active':''}">${l}</button>`).join('')}</div>
      <label>Sort by<select id="food-sort"><option value="name">Name A–Z</option><option value="calories-asc">Calories low–high</option><option value="calories-desc">Calories high–low</option><option value="protein-desc">Protein high–low</option><option value="carbs-asc">Carbs low–high</option></select></label></div></div><div id="food-list" class="grid food-list"></div>`;
  $('food-sort').value=state.foodSort;
  const list=$('food-list');
  const draw=()=>{
    const query=$('food-search').value.trim().toLowerCase();
    const recentIds=[];
    [...state.entries].sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))).forEach(e=>{if(e.food_id&&!recentIds.includes(e.food_id))recentIds.push(e.food_id);});
    let filtered=state.foods.filter(f=>(`${f.name||''} ${f.serving_size||''}`).toLowerCase().includes(query));
    if(state.foodFilter==='favorites')filtered=filtered.filter(f=>f.is_favorite);
    if(state.foodFilter==='recent')filtered=filtered.filter(f=>recentIds.includes(f.id)).sort((a,b)=>recentIds.indexOf(a.id)-recentIds.indexOf(b.id));
    if(state.foodSort==='name')filtered.sort(sortByName);
    if(state.foodSort==='calories-asc')filtered.sort((a,b)=>num(a.calories)-num(b.calories));
    if(state.foodSort==='calories-desc')filtered.sort((a,b)=>num(b.calories)-num(a.calories));
    if(state.foodSort==='protein-desc')filtered.sort((a,b)=>num(b.protein)-num(a.protein));
    if(state.foodSort==='carbs-asc')filtered.sort((a,b)=>num(a.carbs)-num(b.carbs));
    list.innerHTML=filtered.length?filtered.map(food=>`<div class="card food-card"><div class="entry"><div class="entry-main"><div class="entry-name">${esc(food.name)}</div><div class="entry-meta">${esc(food.serving_size)}</div><div class="entry-macros">${Math.round(num(food.calories))} cal • ${Math.round(num(food.protein))}g protein • ${Math.round(num(food.carbs))}g carbs • ${Math.round(num(food.fat))}g fat • ${Math.round(num(food.fiber))}g fiber</div></div><div class="entry-actions food-actions"><button title="${food.is_favorite?'Remove favorite':'Add favorite'}" data-fav-food="${food.id}">${food.is_favorite?'★':'☆'}</button><button class="primary" data-food-log="${food.id}">Log</button><button data-food-edit="${food.id}">Edit</button><button data-food-duplicate="${food.id}">Duplicate</button><button class="ghost" data-food-delete="${food.id}">Delete</button></div></div></div>`).join(''):'<div class="card empty">No matching foods.</div>';
    document.querySelectorAll('[data-fav-food]').forEach(b=>b.onclick=()=>toggleFavorite(Number(b.dataset.favFood)));
    document.querySelectorAll('[data-food-log]').forEach(b=>b.onclick=()=>openLogFoodModal(Number(b.dataset.foodLog),selectedDate||todayString()));
    document.querySelectorAll('[data-food-edit]').forEach(b=>b.onclick=()=>openFoodEditModal(Number(b.dataset.foodEdit)));
    document.querySelectorAll('[data-food-delete]').forEach(b=>b.onclick=()=>confirmDeleteFood(Number(b.dataset.foodDelete)));
    document.querySelectorAll('[data-food-duplicate]').forEach(b=>b.onclick=()=>duplicateFood(Number(b.dataset.foodDuplicate)));
  };
  $('food-search').oninput=draw;
  $('food-sort').onchange=e=>{state.foodSort=e.target.value;draw();window.scrollTo({top:0,behavior:'smooth'});};
  document.querySelectorAll('[data-food-filter]').forEach(b=>b.onclick=()=>{state.foodFilter=b.dataset.foodFilter;renderFoods();});
  $('new-food-btn').onclick=()=>openFoodEditModal(null);
  $('food-database-btn').onclick=openFoodDatabaseSearchModal;
  $('export-foods-csv').onclick=exportFoodsCsv;
  $('import-foods-csv-btn').onclick=()=>$('foods-csv-file').click();
  $('foods-csv-file').onchange=importFoodsCsv;
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
  const period = state.historyRange === 30 ? 30 : 7;
  const start = shiftDate(today, -(period - 1));
  const items = state.entries.filter(e => e.date >= start && e.date <= today);
  const daysLogged = new Set(items.map(e => e.date)).size;
  // Match Android: the 7-/30-day overview averages across every calendar day in the range.
  const avg = key => period ? items.reduce((sum, e) => sum + num(e[key]) * num(e.servings), 0) / period : 0;
  const days = [...new Set(state.entries.map(e => e.date))].sort().reverse();
  const trendDays = Array.from({length: period}, (_, i) => {
    const date = shiftDate(start, i);
    const rows = state.entries.filter(e => e.date === date);
    return { date, calories: total(rows, 'calories'), count: rows.length };
  });

  // Android's weekly comparison uses the most recent rolling seven days, then the prior seven.
  const currentStart = shiftDate(today, -6);
  const previousStart = shiftDate(today, -13);
  const previousEnd = shiftDate(today, -7);
  const currentDates = Array.from({length:7}, (_,i)=>shiftDate(currentStart,i));
  const previousDates = Array.from({length:7}, (_,i)=>shiftDate(previousStart,i));
  const dayTotals = date => {
    const es = state.entries.filter(e=>e.date===date);
    return {date, logged:es.length>0, calories:total(es,'calories'), protein:total(es,'protein'), carbs:total(es,'carbs'), fat:total(es,'fat'), fiber:total(es,'fiber')};
  };
  const currentDays = currentDates.map(dayTotals);
  const previousDays = previousDates.map(dayTotals);
  const currentLogged = currentDays.filter(d=>d.logged);
  const previousLogged = previousDays.filter(d=>d.logged);
  const weekAverage = (rows,key) => rows.length ? rows.reduce((sum,d)=>sum+d[key],0)/rows.length : null;
  const consistency = [
    {label:'Calories at or below goal',met:currentLogged.filter(d=>d.calories<=num(state.goals.calorie_goal)).length},
    {label:'Protein goal reached',met:currentLogged.filter(d=>d.protein>=num(state.goals.protein_goal)).length},
    {label:'Carbs at or below goal',met:currentLogged.filter(d=>d.carbs<=num(state.goals.carbs_goal)).length},
    {label:'Fat at or below goal',met:currentLogged.filter(d=>d.fat<=num(state.goals.fat_goal)).length},
    {label:'Fiber goal reached',met:currentLogged.filter(d=>d.fiber>=num(state.goals.fiber_goal)).length}
  ].map(x=>({...x,logged:currentLogged.length,rate:currentLogged.length?x.met/currentLogged.length:0}));
  const mostConsistent = currentLogged.length ? [...consistency].sort((a,b)=>b.rate-a.rate)[0] : null;
  const weeklyRows = [['Calories','calories','cal'],['Protein','protein','g'],['Carbs','carbs','g'],['Fat','fat','g'],['Fiber','fiber','g']];
  const consistencyHtml = currentLogged.length ? `
    <div class="status-note"><div class="muted">Most consistent goal</div><strong>${esc(mostConsistent.label)}: ${mostConsistent.met}/${mostConsistent.logged} logged days</strong></div>
    <h3 style="margin:16px 0 6px">Goal consistency (logged days only)</h3>
    ${consistency.map(x=>`<div class="stat-row"><div class="stat-top"><strong>${esc(x.label)}</strong><span>${x.met}/${x.logged}</span></div><div class="progress"><span style="width:${Math.round(x.rate*100)}%"></span></div></div>`).join('')}
    <p class="muted" style="margin-top:10px">Days without food entries are excluded rather than counted as misses.</p>` : '<p class="muted">Log food on a day to start tracking how consistently you meet your goals.</p>';

  $('history-page').innerHTML = `
    <div class="card"><div class="section-title" style="margin-top:0"><h2>${period}-Day Overview</h2><select id="history-range" aria-label="History range"><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></div>
      <div class="muted">${fmtShortDate(start)} – ${fmtDate(today)} · ${daysLogged} days with entries</div>
      <div class="calorie-chart" style="margin-top:16px"><div class="section-title" style="margin:0 0 4px"><div><h3>Daily Calories</h3><div class="muted">Goal: ${Math.round(num(state.goals.calorie_goal))} cal/day · red bars are above goal</div></div></div>
      <div class="calorie-bars" style="--bar-count:${period}">${trendDays.map((d,i)=>{const max=Math.max(num(state.goals.calorie_goal),...trendDays.map(x=>x.calories),1);const h=d.count?Math.max(3,Math.round(d.calories/max*104)):2;const date=dateFromString(d.date);const show=period<=7||i===0||i===trendDays.length-1||date.getDay()===1;const label=period<=7?date.toLocaleDateString(undefined,{weekday:'short'}):date.getDate();return `<div class="calorie-bar-day" title="${esc(fmtDate(d.date))}: ${Math.round(d.calories)} calories${d.count?'':' (no entries)'}" aria-label="${esc(fmtDate(d.date))}: ${Math.round(d.calories)} calories"><div class="calorie-bar-track"><span class="calorie-bar ${d.count&&d.calories>num(state.goals.calorie_goal)?'above-goal':''}" style="height:${h}px"></span></div><small>${show?label:''}</small></div>`;}).join('')}</div></div>
      <div class="muted" style="margin-top:12px">Daily averages below use all ${period} calendar days in the selected range.</div>
      ${historyStat('Calories',avg('calories'),num(state.goals.calorie_goal),'cal')}${historyStat('Protein',avg('protein'),num(state.goals.protein_goal),'g')}${historyStat('Carbs',avg('carbs'),num(state.goals.carbs_goal),'g')}${historyStat('Fat',avg('fat'),num(state.goals.fat_goal),'g')}${historyStat('Fiber',avg('fiber'),num(state.goals.fiber_goal),'g')}
    </div>
    <div class="card" style="margin-top:14px"><h2>Weekly Nutrition Summary</h2><p class="muted">Current 7 days: ${fmtShortDate(currentStart)} – ${fmtShortDate(today)} · ${currentLogged.length} of 7 days logged</p>
      ${consistencyHtml}
      <h3 style="margin:18px 0 6px">Compared with the previous 7 days</h3><p class="muted">Previous 7 days: ${fmtShortDate(previousStart)} – ${fmtShortDate(previousEnd)} · ${previousLogged.length} logged days</p>
      <div class="table-scroll"><table class="data-table"><thead><tr><th>Nutrient</th><th>Current 7 days</th><th>Previous 7 days</th><th>Change</th></tr></thead><tbody>
      ${weeklyRows.map(([label,key,unit])=>{const a=weekAverage(currentLogged,key),b=weekAverage(previousLogged,key),diff=a!==null&&b!==null?a-b:null;return `<tr><td>${label}</td><td>${a===null?'—':`${Math.round(a)} ${unit}`}</td><td>${b===null?'—':`${Math.round(b)} ${unit}`}</td><td>${diff===null?'—':`${diff>0?'+':''}${Math.round(diff)} ${unit}`}</td></tr>`;}).join('')}
      </tbody></table></div>
    </div>
    <div class="section-title"><h2>Logged Days</h2><span class="muted">Tap a day</span></div><div class="day-list">${days.length?days.map(historyDay).join(''):'<div class="card empty">No food history yet.</div>'}</div>`;
  $('history-range').value=String(period);
  $('history-range').onchange=e=>{state.historyRange=Number(e.target.value);renderHistory();};
  document.querySelectorAll('[data-history-date]').forEach(card=>card.onclick=()=>{selectedDate=card.dataset.historyDate;navigate('today');});
  document.querySelectorAll('[data-history-delete]').forEach(b=>b.onclick=e=>{e.stopPropagation();confirmDeleteEntry(Number(b.dataset.historyDelete));});
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
  $('settings-page').innerHTML=`<div class="card"><h2>Your Data</h2><p class="muted">Export a portable backup or a spreadsheet of your diary and saved foods. PDF reports open your browser's print dialog, where you can choose Save as PDF.</p><div class="settings-action-grid"><button class="primary" id="export-data">Create Full Backup (.json)</button><button id="import-data">Restore / Import Backup</button><button id="export-diary-csv">Export Diary as CSV</button><button id="export-foods-csv-settings">Export Saved Foods as CSV</button><button id="export-food-csv-template">Save Food CSV Template</button><button id="import-foods-csv-settings">Import Saved Foods from CSV</button><button id="daily-report-pdf">Daily Nutrition Report (PDF)</button><button id="weekly-report-pdf">Weekly Nutrition Report (PDF)</button><button id="refresh-data">Sync Now / Refresh</button></div><input id="import-file" class="hidden" type="file" accept="application/json,.json"><input id="settings-foods-csv-file" class="hidden" type="file" accept=".csv,text/csv"><p class="inline-note">This website writes directly to the same Supabase account used by the Android app. Refresh reloads cloud data. Do not share your backup file; it contains personal food history.</p></div>
    <div class="card" style="margin-top:14px"><h2>Account</h2><div class="muted">${esc(currentUser?.email||'')}</div><div class="actions" style="margin-top:12px"><button id="signout-secondary" class="ghost">Log Out</button></div></div>
    ${!state.plannerAvailable||!state.groceryAvailable?`<div class="card setup-warning" style="margin-top:14px"><h2>Planner & grocery sync setup</h2><p>Some Android features require the matching Supabase tables. Run the SQL files included in <code>supabase/migrations/</code> once in your Supabase SQL Editor.</p><div class="muted">Planner: ${state.plannerAvailable?'ready':'needs planned-meals migration'} · Grocery sync: ${state.groceryAvailable?'ready':'needs grocery-list migration'}</div></div>`:''}`;
  $('signout-secondary').onclick=signOut;
  $('export-data').onclick=exportBackup;
  $('import-data').onclick=()=>$('import-file').click();
  $('import-file').onchange=importBackup;
  $('export-diary-csv').onclick=exportDiaryCsv;
  $('export-foods-csv-settings').onclick=exportFoodsCsv;
  $('export-food-csv-template').onclick=exportFoodCsvTemplate;
  $('import-foods-csv-settings').onclick=()=>$('settings-foods-csv-file').click();
  $('settings-foods-csv-file').onchange=importFoodsCsv;
  $('daily-report-pdf').onclick=()=>exportNutritionReport('daily');
  $('weekly-report-pdf').onclick=()=>exportNutritionReport('weekly');
  $('refresh-data').onclick=async()=>{try{await loadAll();renderCurrentPage();showToast('Cloud data refreshed.');}catch(error){showToast(error.message,true);}};
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

async function openFoodEditModal(id, preset = null) {
  const food = id ? state.foods.find(f => f.id === id) : null;
  const initial = food || preset || {};
  openModal(`<div class="modal-header"><h2>${food?'Edit Food':'Add Food'}</h2><button class="ghost" data-close>Close</button></div><form id="food-edit-form" class="modal-body"><label>Food name<input name="name" value="${esc(initial.name||'')}" required></label><label>Serving size<input name="serving_size" value="${esc(initial.serving_size||initial.servingSize||'')}" required></label><div class="two-col-form"><label>Calories<input name="calories" type="number" min="0" step="1" value="${num(initial.calories)}" required></label><label>Protein (g)<input name="protein" type="number" min="0" step="0.1" value="${num(initial.protein)}" required></label><label>Carbs (g)<input name="carbs" type="number" min="0" step="0.1" value="${num(initial.carbs)}" required></label><label>Fat (g)<input name="fat" type="number" min="0" step="0.1" value="${num(initial.fat)}" required></label><label>Fiber (g)<input name="fiber" type="number" min="0" step="0.1" value="${num(initial.fiber)}" required></label></div></form><div class="modal-footer"><button class="ghost" data-close>Cancel</button><button class="primary" id="food-edit-submit">Save</button></div>`);
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

async function exportBackup() {
  try {
    const backup={format:'FoodTracker Full Backup',version:2,exportedAt:new Date().toISOString(),supabaseUrl:String(config.SUPABASE_URL||'').replace(/\/$/,''),userId:currentUser.id,
      foods:state.foods,meal_entries:state.entries,recipes:state.recipes,recipe_ingredients:state.recipeIngredients,daily_goals:state.goals,
      meal_templates:state.templates,meal_template_entries:state.templateEntries,planned_meals:state.plannedMeals,
      grocery_manual_items:state.groceryManualItems,grocery_recipe_ingredients:state.groceryRecipeIngredients,grocery_check_states:state.groceryChecks};
    downloadText(`foodtracker-full-backup-${todayString()}.json`,JSON.stringify(backup,null,2),'application/json;charset=utf-8');
    showToast('Full backup exported.');
  } catch(error){showToast(error.message,true);}
}

async function importBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data?.tables && data?.format === 'FoodTracker.FullBackup' && data?.formatVersion !== 1) throw new Error('This Android full backup version is not supported.');
    const src = data?.tables || data;
    const foodsRows = src?.foods || [];
    const entryRows = src?.meal_entries || src?.entries || [];
    const recipeRows = src?.recipes || [];
    const recipeIngredientRows = src?.recipe_ingredients || src?.recipeIngredients || [];
    const templateRows = src?.meal_templates || src?.templates || [];
    const templateEntryRows = src?.meal_template_entries || src?.templateEntries || [];
    const plansRows = src?.planned_meals || src?.plannedMeals || [];
    const manualRows = src?.grocery_manual_items || src?.manual_grocery_items || src?.groceryManualItems || [];
    const recipeGroceryRows = src?.grocery_recipe_ingredients || src?.groceryRecipeIngredients || [];
    const groceryCheckRows = src?.grocery_check_states || src?.grocery_checks || src?.groceryChecks || [];
    const sourceGoals = Array.isArray(src?.daily_goals) ? src.daily_goals[0] : src?.daily_goals;
    const arraysToValidate = [
      ['foods', foodsRows], ['diary entries', entryRows], ['recipes', recipeRows],
      ['recipe ingredients', recipeIngredientRows], ['saved meals', templateRows],
      ['saved-meal entries', templateEntryRows], ['planned meals', plansRows],
      ['manual grocery items', manualRows], ['recipe grocery ingredients', recipeGroceryRows],
      ['grocery check states', groceryCheckRows]
    ];
    const malformed = arraysToValidate.find(([, rows]) => !Array.isArray(rows));
    if (malformed || (!data.tables && !Array.isArray(data.foods))) {
      throw new Error(`This backup is invalid: ${malformed ? malformed[0] + ' must be a list.' : 'food data is missing.'}`);
    }
    if (plansRows.length && !state.plannerAvailable) {
      throw new Error('This backup contains planned meals, but the Weekly Planner tables are not enabled in Supabase. Run supabase/migrations/20261012_planned_meals_sync.sql and refresh before importing so those meals are not skipped.');
    }
    if ((manualRows.length || recipeGroceryRows.length || groceryCheckRows.length) && !state.groceryAvailable) {
      throw new Error('This backup contains grocery-list data, but the grocery sync tables are not enabled in Supabase. Run supabase/migrations/20261013_grocery_list_cloud_sync.sql and refresh before importing so grocery data is not skipped.');
    }
    const backupUser = data.userId || data.accountUserId;
    if (backupUser && backupUser !== currentUser.id) throw new Error('This backup belongs to a different FoodTracker account. Sign into the account that created it first.');
    const project = String(config.SUPABASE_URL || '').replace(/\/$/, '');
    if (data.supabaseUrl && project && data.supabaseUrl.replace(/\/$/, '') !== project) throw new Error('This backup was created from a different Supabase project.');
    const counts = [
      [foodsRows.length, 'foods'], [entryRows.length, 'diary entries'], [recipeRows.length, 'recipes'],
      [templateRows.length, 'saved meals'], [plansRows.length, 'planned meals'], [manualRows.length, 'manual grocery items']
    ].map(([count, label]) => `${count} ${label}`).join(', ');
    if (!confirm(`Restore / merge this backup into the signed-in account?\n\n${counts}\n\nExisting data is not deleted. Matching saved foods and meals are reused. Continue?`)) return;

    const norm = v => String(v ?? '').trim().toLowerCase();
    const val = (row, snake, camel) => row?.[snake] ?? row?.[camel];
    const foodMap = new Map();
    for (const food of foodsRows) {
      const name = food.name || '';
      const serving = val(food, 'serving_size', 'servingSize') || '';
      const matched = state.foods.find(f => norm(f.name) === norm(name) && norm(f.serving_size) === norm(serving));
      if (matched) { if (food.id != null) foodMap.set(String(food.id), matched.id); continue; }
      const inserted = await dbInsert('foods', {
        user_id: currentUser.id, name, serving_size: serving, calories: num(food.calories),
        protein: num(food.protein), carbs: num(food.carbs), fat: num(food.fat), fiber: num(food.fiber),
        is_favorite: Boolean(val(food, 'is_favorite', 'isFavorite'))
      });
      if (food.id != null) foodMap.set(String(food.id), inserted.id);
      state.foods.push(inserted);
    }

    const recipeMap = new Map();
    const templatesToMap = new Map();
    for (const recipe of recipeRows) {
      let destination = state.recipes.find(r => norm(r.name) === norm(recipe.name));
      if (!destination) { destination = await dbInsert('recipes', { user_id: currentUser.id, name: recipe.name, servings: Math.max(1, parseInt(recipe.servings, 10) || 1) }); state.recipes.push(destination); }
      if (recipe.id != null) recipeMap.set(String(recipe.id), destination.id);
    }
    for (const template of templateRows) {
      const name = template.name || '';
      const mealType = val(template, 'meal_type', 'mealType') || 'Dinner';
      let destination = state.templates.find(t => norm(t.name) === norm(name) && norm(val(t, 'meal_type', 'mealType')) === norm(mealType));
      if (!destination) { destination = await dbInsert('meal_templates', { user_id: currentUser.id, name, meal_type: mealType }); state.templates.push(destination); }
      if (template.id != null) templatesToMap.set(String(template.id), destination.id);
    }

    // Create recipe ingredients only if the chosen target recipe doesn't already have ingredients.
    for (const recipe of recipeRows) {
      const newRecipeId = recipeMap.get(String(recipe.id));
      if (!newRecipeId || state.recipeIngredients.some(i => Number(i.recipe_id) === Number(newRecipeId))) continue;
      const related = recipeIngredientRows.filter(i => String(val(i, 'recipe_id', 'recipeId')) === String(recipe.id));
      if (!related.length) continue;
      const rows = related.map(i => ({
        user_id: currentUser.id, recipe_id: newRecipeId,
        food_id: foodMap.get(String(val(i, 'food_id', 'foodId'))) ?? null,
        food_name: val(i, 'food_name', 'foodName') || '',
        serving_size: val(i, 'serving_size', 'servingSize') || 'serving',
        calories: num(i.calories), protein: num(i.protein), carbs: num(i.carbs), fat: num(i.fat), fiber: num(i.fiber), quantity: num(i.quantity) || 1
      }));
      const { error } = await supabaseClient.from('recipe_ingredients').insert(rows);
      if (error) throw error;
      state.recipeIngredients.push(...rows.map((row, index) => ({ ...row, id: `backup-${newRecipeId}-${index}` })));
    }

    // Avoid repeated template-entry rows if a backup is imported more than once or contains repeated rows.
    for (const entry of templateEntryRows) {
      const destTemplate = templatesToMap.get(String(val(entry, 'template_id', 'templateId')));
      if (!destTemplate) continue;
      const name = val(entry, 'food_name', 'foodName') || '';
      const serving = val(entry, 'serving_size', 'servingSize') || '';
      const duplicate = state.templateEntries.some(x => Number(val(x, 'template_id', 'templateId')) === Number(destTemplate) && norm(val(x, 'food_name', 'foodName')) === norm(name) && norm(val(x, 'serving_size', 'servingSize')) === norm(serving));
      if (duplicate) continue;
      const templatePayload = {
        user_id: currentUser.id, template_id: destTemplate, food_id: foodMap.get(String(val(entry, 'food_id', 'foodId'))) ?? null,
        entry_type: val(entry, 'entry_type', 'entryType') || 'FOOD',
        recipe_id: recipeMap.get(String(val(entry, 'recipe_id', 'recipeId'))) ?? null,
        food_name: name, serving_size: serving, servings: num(entry.servings) || 1, calories: num(entry.calories),
        protein: num(entry.protein), carbs: num(entry.carbs), fat: num(entry.fat), fiber: num(entry.fiber)
      };
      const { error } = await supabaseClient.from('meal_template_entries').insert(templatePayload);
      if (error) throw error;
      state.templateEntries.push({ ...templatePayload, id: `backup-${destTemplate}-${state.templateEntries.length}` });
    }

    // Use a multiset fingerprint so repeat restores don't duplicate diary entries,
    // while preserving intentionally repeated identical entries within a backup.
    const normNumber = value => num(value).toFixed(4);
    const entryKey = row => JSON.stringify([
      String(row.date || ''), norm(val(row, 'meal_type', 'mealType') || '').toLowerCase(),
      norm(val(row, 'food_name', 'foodName')), norm(val(row, 'serving_size', 'servingSize')),
      normNumber(row.servings || 1), norm(val(row, 'entry_type', 'entryType') || 'FOOD'),
      String(row.recipe_id ?? row.recipeId ?? ''), normNumber(row.calories), normNumber(row.protein),
      normNumber(row.carbs), normNumber(row.fat), normNumber(row.fiber)
    ]);
    const entryCounts = new Map();
    for (const existing of state.entries) {
      const k = entryKey(existing); entryCounts.set(k, (entryCounts.get(k) || 0) + 1);
    }
    for (const entry of entryRows) {
      const foodId = val(entry, 'food_id', 'foodId');
      const sourceRecipeId = val(entry, 'recipe_id', 'recipeId');
      const payload = {
        user_id: currentUser.id, food_id: foodId != null ? foodMap.get(String(foodId)) ?? null : null,
        date: entry.date, meal_type: val(entry, 'meal_type', 'mealType') || 'Dinner', servings: num(entry.servings) || 1,
        entry_type: val(entry, 'entry_type', 'entryType') || 'FOOD', recipe_id: sourceRecipeId != null ? recipeMap.get(String(sourceRecipeId)) ?? null : null,
        food_name: val(entry, 'food_name', 'foodName') || 'Food', serving_size: val(entry, 'serving_size', 'servingSize') || 'serving',
        calories: num(entry.calories), protein: num(entry.protein), carbs: num(entry.carbs), fat: num(entry.fat), fiber: num(entry.fiber)
      };
      const k = entryKey(payload), count = entryCounts.get(k) || 0;
      if (count > 0) { entryCounts.set(k, count - 1); continue; }
      const inserted = await dbInsert('meal_entries', payload);
      state.entries.push(inserted || payload);
      entryCounts.set(k, 1);
    }

    if (sourceGoals) {
      const goalValue = (snake, camel, fallback) => {
        const raw = val(sourceGoals, snake, camel);
        return raw === undefined || raw === null || raw === '' ? fallback : Math.max(0, num(raw));
      };
      await dbUpsert('daily_goals', {
        user_id: currentUser.id, calorie_goal: goalValue('calorie_goal', 'calorieGoal', 2000),
        protein_goal: goalValue('protein_goal', 'proteinGoal', 100),
        carbs_goal: goalValue('carbs_goal', 'carbsGoal', 200),
        fat_goal: goalValue('fat_goal', 'fatGoal', 65),
        fiber_goal: goalValue('fiber_goal', 'fiberGoal', 30)
      });
    }

    if (state.plannerAvailable) {
      const planKey = row => JSON.stringify([
        String(val(row, 'template_id', 'templateId') ?? ''), String(val(row, 'planned_date', 'plannedDate') ?? ''),
        norm(val(row, 'meal_type', 'mealType') || 'Dinner'), normNumber(val(row, 'servings_multiplier', 'servingsMultiplier') || 1)
      ]);
      const planCounts = new Map();
      for (const existing of state.plannedMeals) { const k=planKey(existing); planCounts.set(k,(planCounts.get(k)||0)+1); }
      for (const plan of plansRows) {
        const tid = templatesToMap.get(String(val(plan, 'template_id', 'templateId')));
        if (!tid) continue;
        const payload = {
          user_id: currentUser.id, template_id: tid, planned_date: val(plan, 'planned_date', 'plannedDate'),
          meal_type: val(plan, 'meal_type', 'mealType') || 'Dinner', servings_multiplier: num(val(plan, 'servings_multiplier', 'servingsMultiplier')) || 1
        };
        const k = planKey(payload), count = planCounts.get(k)||0;
        if (count > 0) { planCounts.set(k,count-1); continue; }
        const { error } = await supabaseClient.from('planned_meals').insert(payload);
        if (error) throw error;
        state.plannedMeals.push(payload); planCounts.set(k,1);
      }
    }

    if (state.groceryAvailable) {
      const manualKey = row => JSON.stringify([
        String(val(row,'week_start','weekStart')||''), norm(row.name), norm(row.quantity), norm(row.category||'Other'),
        Boolean(val(row,'is_checked','isChecked'))
      ]);
      const manualCounts = new Map();
      for (const existing of state.groceryManualItems) { const k=manualKey(existing); manualCounts.set(k,(manualCounts.get(k)||0)+1); }
      for (const item of manualRows) {
        const payload = {
          user_id: currentUser.id, week_start: val(item, 'week_start', 'weekStart'), name: item.name,
          quantity: item.quantity || '', category: item.category || 'Other', is_checked: Boolean(val(item, 'is_checked', 'isChecked'))
        };
        const k=manualKey(payload),count=manualCounts.get(k)||0;
        if(count>0){manualCounts.set(k,count-1);continue;}
        const inserted=await dbInsert('grocery_manual_items',payload);
        state.groceryManualItems.push(inserted||payload);manualCounts.set(k,1);
      }
      const recipeGroceryKey = row => JSON.stringify([
        String(val(row,'week_start','weekStart')||''), String(val(row,'recipe_id','recipeId')??''),
        norm(val(row,'recipe_name','recipeName')||'Recipe'), norm(val(row,'food_name','foodName')||'Ingredient'),
        norm(val(row,'serving_size','servingSize')||'serving'), normNumber(row.quantity), norm(row.category||'Other')
      ]);
      const recipeGroceryCounts = new Map();
      for (const existing of state.groceryRecipeIngredients) { const k=recipeGroceryKey(existing); recipeGroceryCounts.set(k,(recipeGroceryCounts.get(k)||0)+1); }
      for (const item of recipeGroceryRows) {
        const sourceRecipeId = val(item, 'recipe_id', 'recipeId');
        const recipeId = recipeMap.get(String(sourceRecipeId)) ?? state.recipes.find(r => norm(r.name) === norm(val(item, 'recipe_name', 'recipeName')))?.id;
        if (!recipeId) continue;
        const payload = {
          user_id: currentUser.id, week_start: val(item, 'week_start', 'weekStart'), recipe_id: recipeId,
          recipe_name: val(item, 'recipe_name', 'recipeName') || 'Recipe', food_name: val(item, 'food_name', 'foodName') || 'Ingredient',
          serving_size: val(item, 'serving_size', 'servingSize') || 'serving', quantity: num(item.quantity), category: item.category || 'Other'
        };
        const k=recipeGroceryKey(payload),count=recipeGroceryCounts.get(k)||0;
        if(count>0){recipeGroceryCounts.set(k,count-1);continue;}
        const inserted=await dbInsert('grocery_recipe_ingredients',payload);
        state.groceryRecipeIngredients.push(inserted||payload);recipeGroceryCounts.set(k,1);
      }
      for (const check of groceryCheckRows) {
        const { error } = await supabaseClient.from('grocery_check_states').upsert({
          user_id: currentUser.id, item_key: val(check, 'item_key', 'itemKey'),
          is_checked: Boolean(val(check, 'is_checked', 'isChecked')), updated_at_ms: num(val(check, 'updated_at_ms', 'updatedAt'))
        }, { onConflict: 'user_id,item_key' });
        if (error) throw error;
      }
    }
    await loadAll(); renderCurrentPage(); showToast('Backup import finished. Existing records were retained; new records were merged.');
  } catch (error) {
    showToast(error.message || 'Backup import failed.', true);
  } finally {
    event.target.value = '';
  }
}

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

// ---------- Android parity: food-library duplication, CSV tools, reports ----------
async function duplicateFood(id){
  const f=state.foods.find(x=>x.id===id);if(!f)return;
  const base=`${f.name} (Copy)`;let name=base,n=2;
  const exists=(candidate)=>state.foods.some(x=>x.name.toLowerCase()===candidate.toLowerCase()&&String(x.serving_size).toLowerCase()===String(f.serving_size).toLowerCase());
  while(exists(name)){name=`${f.name} (Copy ${n++})`;}
  try{await dbInsert('foods',{user_id:currentUser.id,name,serving_size:f.serving_size,calories:num(f.calories),protein:num(f.protein),carbs:num(f.carbs),fat:num(f.fat),fiber:num(f.fiber),is_favorite:false});await loadAll();renderFoods();showToast('Food duplicated.');}catch(error){showToast(error.message,true);}
}

function exportFoodsCsv(){
  const header=['Name','Serving Size','Calories','Protein','Carbs','Fat','Fiber','Is Favorite'];
  const rows=[...state.foods].sort((a,b)=>String(a.name).localeCompare(String(b.name))||String(a.serving_size).localeCompare(String(b.serving_size))).map(f=>[f.name,f.serving_size,f.calories,f.protein,f.carbs,f.fat,f.fiber,Boolean(f.is_favorite)]);
  downloadText(`foodtracker-saved-foods-${todayString()}.csv`,'\ufeff'+[header,...rows].map(r=>r.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');showToast('Saved foods CSV exported.');
}

function exportFoodCsvTemplate(){
  const header=['Name','Serving Size','Calories','Protein','Carbs','Fat','Fiber','Is Favorite'];
  downloadText('foodtracker-food-import-template.csv','\ufeff'+header.map(csvCell).join(',')+'\r\n','text/csv;charset=utf-8');
  showToast('Food CSV template exported.');
}

function parseCsvText(text){
  const rows=[];let row=[],cell='',quoted=false;const s=String(text||'').replace(/^\ufeff/,'');
  for(let i=0;i<s.length;i++){const c=s[i];if(quoted){if(c==='"'&&s[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;}else if(c==='"')quoted=true;else if(c===','){row.push(cell);cell='';}else if(c==='\n'||c==='\r'){if(c==='\r'&&s[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';}else cell+=c;}
  if(cell.length||row.length){row.push(cell);if(row.some(v=>v.trim()))rows.push(row);}return rows;
}

async function importFoodsCsv(event){
  const file=event.target.files?.[0];if(!file)return;
  try{
    const rows=parseCsvText(await file.text());if(rows.length<2)throw new Error('The CSV has no data rows.');
    const normalizeHeader=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
    const header=rows[0].map(normalizeHeader);
    const index=(...names)=>header.findIndex(h=>names.some(name=>h===normalizeHeader(name)));
    const col={
      name:index('Name','Food','Food Name','FoodName','Item','Description'),
      serving:index('Serving Size','Serving','Portion','Portion Size','Serving Description'),
      cal:index('Calories','Calories Per Serving','CaloriesPerServing','Kcal','Energy Kcal'),
      protein:index('Protein','Protein g','Protein (g)','Protein Total (g)'),
      carbs:index('Carbs','Carbohydrates','Carbs g','Carbs (g)','Carbohydrates (g)'),
      fat:index('Fat','Fat g','Fat (g)','Total Fat','Total Fat (g)'),
      fiber:index('Fiber','Fibre','Fiber g','Fiber (g)','Dietary Fiber'),
      fav:index('Favorite','Is Favorite','IsFavorite','Favourite','Is Favourite')
    };
    if(col.name<0||col.cal<0)throw new Error('CSV must include a Name (or Food) column and a Calories column. Serving Size and macros are optional. Use Save Food CSV Template for a compatible header.');
    const key=(n,ss)=>`${String(n).trim().toLowerCase().replace(/\s+/g,' ')}|${String(ss).trim().toLowerCase().replace(/\s+/g,' ')}`;
    const seen=new Set(state.foods.map(f=>key(f.name,f.serving_size)));const foods=[];let invalid=0,duplicates=0;const rowIssues=[];
    for(const [index0,r] of rows.slice(1).entries()){
      const at=i=>i>=0?(r[i]??'').trim():'';
      const name=at(col.name),serving=at(col.serving)||'1 serving';
      const parseRequired=(value,label)=>{const n=Number(value);if(value===''||!Number.isFinite(n)||n<0)throw new Error(`${label} must be a non-negative number`);return n;};
      const parseMacro=(i,label)=>{const value=at(i);if(i<0||value==='')return 0;return parseRequired(value,label);};
      try{
        if(!name)throw new Error('Name is blank');
        const calories=parseRequired(at(col.cal),'Calories');
        const protein=parseMacro(col.protein,'Protein'),carbs=parseMacro(col.carbs,'Carbs'),fat=parseMacro(col.fat,'Fat'),fiber=parseMacro(col.fiber,'Fiber');
        if(calories>2147483647)throw new Error('Calories is too large');
        const k=key(name,serving);if(seen.has(k)){duplicates++;continue;}seen.add(k);
        foods.push({name,serving_size:serving,calories:Math.round(calories),protein,carbs,fat,fiber,is_favorite:/^(true|yes|y|1|favorite|favourite|starred)$/i.test(at(col.fav))});
      }catch(err){invalid++;if(rowIssues.length<5)rowIssues.push(`Row ${index0+2}: ${err.message}`);}
    }
    if(!foods.length)throw new Error(`No new valid foods found. ${duplicates} duplicates ignored, ${invalid} invalid rows skipped.${rowIssues.length?' '+rowIssues.join('; '):''}`);
    const moreIssues=rowIssues.length?`\n\nExamples of skipped rows:\n${rowIssues.join('\n')}`:'';
    if(!confirm(`${foods.length} unique foods are ready to import. ${duplicates} duplicates and ${invalid} invalid rows will be skipped.${moreIssues}\n\nImport now?`))return;
    for(let i=0;i<foods.length;i+=50){const payload=foods.slice(i,i+50).map(f=>({...f,user_id:currentUser.id}));const {error}=await supabaseClient.from('foods').insert(payload);if(error)throw error;}
    await loadAll();if(activeTab==='foods')renderFoods();else renderSettings();showToast(`Imported ${foods.length} foods; skipped ${duplicates} duplicates and ${invalid} invalid rows.`);
  }catch(error){showToast(error.message||'Food CSV import failed.',true);}finally{event.target.value='';}
}

function exportDiaryCsv(){
  const headers=['date','meal','food_name','entry_type','serving_size','servings','calories_per_serving','total_calories','total_protein_g','total_carbs_g','total_fat_g','total_fiber_g'];
  const entries=[...state.entries].sort((a,b)=>String(a.date).localeCompare(String(b.date))||['Breakfast','Lunch','Dinner','Snack'].indexOf(a.meal_type)-['Breakfast','Lunch','Dinner','Snack'].indexOf(b.meal_type)||String(a.food_name).localeCompare(String(b.food_name)));
  const rows=entries.map(e=>[e.date,e.meal_type,e.food_name,e.entry_type,e.serving_size,e.servings,e.calories,num(e.calories)*num(e.servings),num(e.protein)*num(e.servings),num(e.carbs)*num(e.servings),num(e.fat)*num(e.servings),num(e.fiber)*num(e.servings)]);
  downloadText(`foodtracker-diary-${todayString()}.csv`,'\ufeff'+[headers,...rows].map(r=>r.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');showToast('Diary CSV exported.');
}

function exportNutritionReport(kind){
  const weekly=kind==='weekly';
  const start=weekly?mondayOf(selectedDate):selectedDate;
  const end=weekly?shiftDate(start,6):selectedDate;
  const title=weekly
    ? `Weekly Nutrition Report · ${fmtShortDate(start)} – ${fmtDate(end)}`
    : `Daily Nutrition Report · ${fmtDate(selectedDate)}`;
  const allRows=state.entries.filter(e=>e.date>=start&&e.date<=end);
  const mealOrder=['Breakfast','Lunch','Dinner','Snack'];
  const sortRows=list=>[...list].sort((a,b)=>mealOrder.indexOf(a.meal_type)-mealOrder.indexOf(b.meal_type)||String(a.food_name).localeCompare(String(b.food_name)));
  const totalVal=(list,key)=>list.reduce((sum,e)=>sum+num(e[key])*num(e.servings),0);
  const dates=weekly?Array.from({length:7},(_,i)=>shiftDate(start,i)):[selectedDate];
  const dailyData=dates.map(date=>{const rows=allRows.filter(e=>e.date===date);return {date,rows,logged:rows.length>0,calories:totalVal(rows,'calories'),protein:totalVal(rows,'protein'),carbs:totalVal(rows,'carbs'),fat:totalVal(rows,'fat'),fiber:totalVal(rows,'fiber')};});
  const loggedDays=dailyData.filter(d=>d.logged);
  const avgDenom=Math.max(loggedDays.length,1);
  const metrics=[
    {label:'Calories',key:'calories',goalKey:'calorie_goal',unit:'cal',lower:true},
    {label:'Protein',key:'protein',goalKey:'protein_goal',unit:'g',lower:false},
    {label:'Carbohydrates',key:'carbs',goalKey:'carbs_goal',unit:'g',lower:true},
    {label:'Fat',key:'fat',goalKey:'fat_goal',unit:'g',lower:true},
    {label:'Fiber',key:'fiber',goalKey:'fiber_goal',unit:'g',lower:false}
  ];
  const statusFor=(metric,value)=>{
    const goal=num(state.goals[metric.goalKey]);
    if(metric.lower)return value<=goal?'Within goal':`${Math.round(value-goal)} ${metric.unit} over goal`;
    return value>=goal?'Goal reached':`${Math.round(goal-value)} ${metric.unit} to goal`;
  };
  const summary=metrics.map(metric=>{
    const total=totalVal(allRows,metric.key),average=weekly?total/avgDenom:total,goal=num(state.goals[metric.goalKey]);
    const heading=weekly?`${Math.round(total)} ${metric.unit} total`:`${Math.round(total)} ${metric.unit}`;
    const supporting=weekly
      ? `${loggedDays.length?Math.round(average):'—'} ${metric.unit}/logged day · daily goal ${Math.round(goal)} ${metric.unit}`
      : `Daily goal ${Math.round(goal)} ${metric.unit} · ${statusFor(metric,total)}`;
    return `<div class="metric"><span class="muted">${esc(metric.label)}</span><strong>${heading}</strong><small>${supporting}</small></div>`;
  }).join('');
  const weeklyConsistency=weekly&&loggedDays.length?`
    <h2>Goal Consistency</h2><p class="muted">${loggedDays.length} of 7 days had food entries. Goal checks use only logged days.</p>
    <div class="summary">${metrics.map(metric=>{const met=loggedDays.filter(day=>metric.lower?day[metric.key]<=num(state.goals[metric.goalKey]):day[metric.key]>=num(state.goals[metric.goalKey])).length;return `<div class="metric"><span class="muted">${esc(metric.label)}</span><strong>${met}/${loggedDays.length} days</strong><small>${Math.round(met/loggedDays.length*100)}% met target</small></div>`;}).join('')}</div>`:'';
  const mealSection=(dayRows,meal)=>{
    const rows=sortRows(dayRows.filter(e=>e.meal_type===meal));
    if(!rows.length)return '';
    return `<div class="group"><h3>${meal}</h3>${rows.map(e=>`<div class="row"><span>${esc(e.food_name)}<br><small>${amount(e.servings)} × ${esc(e.serving_size)}</small></span><span>${Math.round(num(e.calories)*num(e.servings))} cal<br><small>${Math.round(num(e.protein)*num(e.servings))}g protein · ${Math.round(num(e.carbs)*num(e.servings))}g carbs · ${Math.round(num(e.fat)*num(e.servings))}g fat · ${Math.round(num(e.fiber)*num(e.servings))}g fiber</small></span></div>`).join('')}</div>`;
  };
  const details=dailyData.map(day=>{
    const daySummary=`<div class="muted">${Math.round(day.calories)} cal · ${Math.round(day.protein)}g protein · ${Math.round(day.carbs)}g carbs · ${Math.round(day.fat)}g fat · ${Math.round(day.fiber)}g fiber</div>`;
    const meals=mealOrder.map(meal=>mealSection(day.rows,meal)).join('');
    const statuses=metrics.map(metric=>`<span class="report-status"><strong>${esc(metric.label)}:</strong> ${esc(statusFor(metric,day[metric.key]))}</span>`).join(' · ');
    return `<div class="group report-day"><h2>${esc(fmtDate(day.date))}</h2>${daySummary}<div class="report-statuses">${statuses}</div>${meals||'<p class="muted">No meals logged for this date.</p>'}</div>`;
  }).join('');
  const context=weekly
    ? `Weekly average values are calculated over ${loggedDays.length} day${loggedDays.length===1?'':'s'} with logged entries. Each of the seven dates is listed below.`
    : 'Nutrition values are calculated from saved food and recipe entry snapshots multiplied by servings.';
  const html=`<h1>FoodTracker</h1><div class="muted">${esc(title)}</div><div class="summary">${summary}</div>${weeklyConsistency}<p class="muted">${esc(context)}</p><h2>Logged foods and daily details</h2>${details}<p class="muted">This report summarizes FoodTracker records and is not medical advice.</p>`;
  showPrintDocument(title,html);
}

// ---------- Android parity: Goals and progress ----------
function renderGoals(){
  const today=todayString(),start=shiftDate(today,-6);
  const todayEntries=getDateEntries(today);
  const goalSpecs=[
    {label:'Calories',key:'calories',goalKey:'calorie_goal',unit:'cal',lower:true},
    {label:'Protein',key:'protein',goalKey:'protein_goal',unit:'g',lower:false},
    {label:'Carbohydrates',key:'carbs',goalKey:'carbs_goal',unit:'g',lower:true},
    {label:'Fat',key:'fat',goalKey:'fat_goal',unit:'g',lower:true},
    {label:'Fiber',key:'fiber',goalKey:'fiber_goal',unit:'g',lower:false}
  ];
  const todayRows=goalSpecs.map(spec=>{
    const current=total(todayEntries,spec.key),goal=num(state.goals[spec.goalKey]);
    const status=spec.lower?(current<=goal?'within goal':`${Math.round(current-goal)} ${spec.unit} over`):(current>=goal?'goal reached':`${Math.round(goal-current)} ${spec.unit} to goal`);
    return {...spec,current,goal,status,pct:goal>0?Math.min(current/goal*100,100):0};
  });
  const weekDates=Array.from({length:7},(_,i)=>shiftDate(start,i));
  const days=weekDates.map(date=>{const es=getDateEntries(date);return {date,logged:es.length>0,calories:total(es,'calories'),protein:total(es,'protein'),carbs:total(es,'carbs'),fat:total(es,'fat'),fiber:total(es,'fiber')};});
  const logged=days.filter(d=>d.logged);
  const consistencies=[
    {label:'Calories at or below goal',met:logged.filter(d=>d.calories<=num(state.goals.calorie_goal)).length},
    {label:'Protein goal reached',met:logged.filter(d=>d.protein>=num(state.goals.protein_goal)).length},
    {label:'Carbs at or below goal',met:logged.filter(d=>d.carbs<=num(state.goals.carbs_goal)).length},
    {label:'Fat at or below goal',met:logged.filter(d=>d.fat<=num(state.goals.fat_goal)).length},
    {label:'Fiber goal reached',met:logged.filter(d=>d.fiber>=num(state.goals.fiber_goal)).length}
  ].map(x=>({...x,rate:logged.length?x.met/logged.length:0}));
  const best=logged.length?[...consistencies].sort((a,b)=>b.rate-a.rate)[0]:null;
  const weekRange=`${fmtShortDate(start)} – ${fmtDate(today)}`;
  $('goals-page').innerHTML=`
    <div class="section-title" style="margin-top:0"><div><h2>Goals & Progress</h2><div class="muted">Adjust your daily targets and review today and the last seven days.</div></div><button class="primary" id="edit-goals-btn">Edit Daily Targets</button></div>
    <div class="card"><h2>Today's Progress</h2><div class="muted">${esc(fmtDate(today))} · ${todayEntries.length} logged item${todayEntries.length===1?'':'s'}</div>
      ${todayEntries.length?'':`<p class="muted" style="margin-top:10px">No food logged today yet. Your progress will appear here when you add food to your diary.</p>`}
      ${todayRows.map(x=>`<div class="stat-row goal-progress-row"><div class="stat-top"><strong>${esc(x.label)}</strong><span>${Math.round(x.current*10)/10} / ${Math.round(x.goal*10)/10} ${x.unit}</span></div><div class="progress"><span style="width:${x.pct}%"></span></div><div class="inline-note">${esc(x.status)}</div></div>`).join('')}
    </div>
    <div class="card" style="margin-top:14px"><h2>Last 7 Days</h2><p class="muted">${esc(weekRange)}</p><div class="big">${logged.length} of 7</div><div class="muted">Days with food logged</div>
      ${!logged.length?'<p class="muted" style="margin-top:12px">Log food on a day to start tracking how consistently you meet each target.</p>':`
      <div class="status-note" style="margin-top:14px"><div class="muted">Most consistent goal</div><strong>${esc(best.label)}: ${best.met}/${logged.length} logged days</strong></div>
      <h3 style="margin:18px 0 6px">Goal consistency</h3>${consistencies.map(x=>`<div class="stat-row"><div class="stat-top"><strong>${esc(x.label)}</strong><span>${x.met}/${logged.length}</span></div><div class="progress"><span style="width:${Math.round(x.rate*100)}%"></span></div></div>`).join('')}
      <p class="muted" style="margin-top:12px">Consistency uses logged days only. Days without food entries aren't counted as misses.</p>`}
      <div class="actions" style="margin-top:16px"><button id="goals-report-btn">Weekly Nutrition Report (PDF)</button><button id="goals-diary-btn">View History</button></div>
    </div>`;
  $('edit-goals-btn').onclick=openGoalsEditModal;
  $('goals-report-btn').onclick=()=>exportNutritionReport('weekly');
  $('goals-diary-btn').onclick=()=>navigate('history');
}
function openGoalsEditModal(){
  const g=state.goals;
  openModal(`<div class="modal-header"><h2>Edit Daily Goals</h2><button class="ghost" data-close>Close</button></div><form id="edit-goals-form" class="modal-body"><div class="two-col-form"><label>Calories<input name="calorie_goal" type="number" min="0" step="1" value="${num(g.calorie_goal)}" required></label><label>Protein (g)<input name="protein_goal" type="number" min="0" step="0.1" value="${num(g.protein_goal)}" required></label><label>Carbs (g)<input name="carbs_goal" type="number" min="0" step="0.1" value="${num(g.carbs_goal)}" required></label><label>Fat (g)<input name="fat_goal" type="number" min="0" step="0.1" value="${num(g.fat_goal)}" required></label><label>Fiber (g)<input name="fiber_goal" type="number" min="0" step="0.1" value="${num(g.fiber_goal)}" required></label></div><p class="muted">Targets are saved to your FoodTracker account and shared with the Android app through Supabase sync.</p></form><div class="modal-footer"><button class="ghost" data-close>Cancel</button><button class="primary" id="save-goals-modal">Save Goals</button></div>`);
  $('save-goals-modal').onclick=async()=>{const f=$('edit-goals-form');if(!f.reportValidity())return;const d=Object.fromEntries(new FormData(f));const payload={user_id:currentUser.id,calorie_goal:num(d.calorie_goal),protein_goal:num(d.protein_goal),carbs_goal:num(d.carbs_goal),fat_goal:num(d.fat_goal),fiber_goal:num(d.fiber_goal)};try{await dbUpsert('daily_goals',payload);state.goals=payload;closeModal();renderGoals();showToast('Nutrition goals saved.');}catch(error){showToast(error.message,true);}};
}

// ---------- Android parity: weekly meal planner ----------
function templateEntries(templateId){return state.templateEntries.filter(e=>Number(e.template_id)===Number(templateId));}
function planStats(plans){const out={calories:0,protein:0,carbs:0,fat:0,fiber:0};for(const p of plans){for(const e of templateEntries(p.template_id)){const m=num(p.servings_multiplier)||1;for(const k of Object.keys(out))out[k]+=num(e[k])*num(e.servings)*m;}}return out;}
function plannerReadiness(date){const ps=state.plannedMeals.filter(p=>p.planned_date===date);if(!ps.length)return {label:'Needs plan',cls:'status-neutral'};const n=planStats(ps);if(n.calories>num(state.goals.calorie_goal))return {label:'Over calorie goal',cls:'status-warn'};if(n.calories<num(state.goals.calorie_goal)||n.protein<num(state.goals.protein_goal))return {label:'Below target',cls:'status-neutral'};return {label:'Targets met',cls:'status-good'};}
function renderPlanner(openGroceries=false){
  const weekStart=mondayOf(state.plannerAnchor||todayString()),weekEnd=shiftDate(weekStart,6);
  if(state.plannerSelectedDate<weekStart||state.plannerSelectedDate>weekEnd)state.plannerSelectedDate=weekStart;
  const selected=state.plannerSelectedDate,plans=state.plannedMeals.filter(p=>p.planned_date===selected);
  const dates=Array.from({length:7},(_,i)=>shiftDate(weekStart,i));
  if(!state.plannerAvailable){$('planner-page').innerHTML=`<div class=\"card setup-warning\"><h2>Weekly Planner isn't enabled on Supabase yet</h2><p>Run <code>supabase/migrations/20261012_planned_meals_sync.sql</code> in Supabase SQL Editor, then use Settings → Sync Now / Refresh.</p><p class=\"muted\">This is a one-time database setup. Other website features can still be used without this migration.</p></div>`;return;}
  const stats=planStats(plans);
  $('planner-page').innerHTML=`<div class=\"card\"><div class=\"meal-header\"><div><h2>Weekly Meal Planner</h2><div class=\"muted\">${fmtShortDate(weekStart)} – ${fmtDate(weekEnd)}</div></div><div class=\"actions\"><button id=\"planner-prev-week\">‹ Week</button><button id=\"planner-this-week\">This week</button><button id=\"planner-next-week\">Week ›</button></div></div><div class=\"week-day-grid\">${dates.map((d,i)=>{const st=plannerReadiness(d);return `<button class=\"week-day ${d===selected?'active':''}\" data-plan-day=\"${d}\"><small>${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i]}</small><strong>${dateFromString(d).getDate()}</strong><span class=\"${st.cls}\">${state.plannedMeals.some(p=>p.planned_date===d)?'●':'○'}</span><small>${st.label}</small></button>`;}).join('')}</div></div>
    <div class=\"card\" style=\"margin-top:14px\"><div class=\"section-title\" style=\"margin-top:0\"><div><h2>${esc(fmtDate(selected))}</h2><div class=\"muted\">Planned meals are estimates, not logged food or medical advice.</div></div><button class=\"primary\" id=\"planner-add-meal\">+ Add Meal</button></div><div class=\"grid grid-2\"><div><div class=\"big\">${Math.round(stats.calories)}</div><div class=\"muted\">planned calories / ${Math.round(num(state.goals.calorie_goal))} goal</div><div class=\"progress\"><span style=\"width:${progressPercent(stats.calories,num(state.goals.calorie_goal))}%\"></span></div></div><div><div class=\"big\">${Math.round(stats.protein)} g</div><div class=\"muted\">planned protein / ${Math.round(num(state.goals.protein_goal))} g goal</div><div class=\"progress\"><span style=\"width:${progressPercent(stats.protein,num(state.goals.protein_goal))}%\"></span></div></div></div><div class=\"status-note\">${esc(plannerReadiness(selected).label)} · Empty meal slots are suggestions, not requirements.</div><div class=\"actions planner-slot-actions\">${['Breakfast','Lunch','Dinner','Snack'].map(m=>`<button data-add-plan-meal=\"${m}\">+ ${m}</button>`).join('')}</div><div class=\"planned-meals-list\">${plans.length?plans.map(p=>{const t=state.templates.find(x=>Number(x.id)===Number(p.template_id));const es=templateEntries(p.template_id);const n=planStats([p]);return `<div class=\"planned-card\"><div class=\"meal-header\"><div><strong>${esc(p.meal_type)} · ${esc(t?.name||'Saved meal')}</strong><div class=\"muted\">${amount(p.servings_multiplier)}× · ${Math.round(n.calories)} cal · ${Math.round(n.protein)}g protein</div></div><div class=\"entry-actions\"><button data-log-plan=\"${p.id}\" class=\"primary\" ${p.planned_date>todayString()?'disabled':''}>Log</button><button data-remove-plan=\"${p.id}\" class=\"ghost\">Remove</button></div></div><div class=\"inline-note\">${es.map(e=>`${esc(e.food_name)} (${amount(num(e.servings)*num(p.servings_multiplier))} × ${esc(e.serving_size)})`).join(' · ')}</div></div>`;}).join(''):'<div class=\"empty\">No meals planned for this day yet.</div>'}</div><div class=\"actions\" style=\"margin-top:16px\"><button id=\"open-grocery-list\" class=\"primary\">Open Weekly Groceries</button></div></div>
    <div class=\"card\" style=\"margin-top:14px\"><h2>Plan status for the week</h2><div class=\"grid grid-2\">${dates.map(d=>{const st=plannerReadiness(d),n=planStats(state.plannedMeals.filter(p=>p.planned_date===d));return `<div class=\"stat-row\"><div class=\"stat-top\"><strong>${esc(fmtShortDate(d))}</strong><span class=\"${st.cls}\">${esc(st.label)}</span></div><div class=\"muted\">${Math.round(n.calories)} cal · ${Math.round(n.protein)}g protein planned</div></div>`;}).join('')}</div></div>`;
  $('planner-prev-week').onclick=()=>{state.plannerAnchor=shiftDate(weekStart,-7);state.plannerSelectedDate=state.plannerAnchor;renderPlanner();};
  $('planner-next-week').onclick=()=>{state.plannerAnchor=shiftDate(weekStart,7);state.plannerSelectedDate=state.plannerAnchor;renderPlanner();};
  $('planner-this-week').onclick=()=>{state.plannerAnchor=todayString();state.plannerSelectedDate=todayString();renderPlanner();};
  document.querySelectorAll('[data-plan-day]').forEach(b=>b.onclick=()=>{state.plannerSelectedDate=b.dataset.planDay;renderPlanner();});
  $('planner-add-meal').onclick=()=>openPlanPicker(null);
  document.querySelectorAll('[data-add-plan-meal]').forEach(b=>b.onclick=()=>openPlanPicker(b.dataset.addPlanMeal));
  document.querySelectorAll('[data-remove-plan]').forEach(b=>b.onclick=async()=>{try{await dbDelete('planned_meals',Number(b.dataset.removePlan));await loadAll();renderPlanner();showToast('Planned meal removed.');}catch(error){showToast(error.message,true);}});
  document.querySelectorAll('[data-log-plan]').forEach(b=>b.onclick=()=>logPlannedMeal(Number(b.dataset.logPlan)));
  $('open-grocery-list').onclick=()=>renderPlannerGroceries(weekStart);
  if(openGroceries)renderPlannerGroceries(weekStart);
}

function openPlanPicker(mealType){
  if(!state.templates.length){showToast('Create a Saved Meal from Today before planning it.',true);return;}
  openModal(`<div class=\"modal-header\"><h2>Add to Weekly Plan</h2><button class=\"ghost\" data-close>Close</button></div><form id=\"plan-picker-form\" class=\"modal-body\"><label>Meal slot<select name=\"meal_type\">${['Breakfast','Lunch','Dinner','Snack'].map(m=>`<option ${m===mealType?'selected':''}>${m}</option>`).join('')}</select></label><label>Saved meal<select name=\"template_id\" required>${state.templates.map(t=>`<option value=\"${t.id}\">${esc(t.name)} · ${esc(t.meal_type)}</option>`).join('')}</select></label><label>Portion multiplier<select name=\"servings_multiplier\"><option value=\"0.5\">0.5×</option><option value=\"1\" selected>1×</option><option value=\"1.5\">1.5×</option><option value=\"2\">2×</option></select></label><div class=\"muted\">Date: ${esc(fmtDate(state.plannerSelectedDate))}</div></form><div class=\"modal-footer\"><button class=\"ghost\" data-close>Cancel</button><button class=\"primary\" id=\"save-plan\">Add to plan</button></div>`);
  $('save-plan').onclick=async()=>{const f=$('plan-picker-form');if(!f.reportValidity())return;const d=Object.fromEntries(new FormData(f));try{await dbInsert('planned_meals',{user_id:currentUser.id,template_id:Number(d.template_id),planned_date:state.plannerSelectedDate,meal_type:d.meal_type,servings_multiplier:num(d.servings_multiplier)||1});closeModal();await loadAll();renderPlanner();showToast('Meal added to weekly plan.');}catch(error){showToast(error.message,true);}};
}

async function logPlannedMeal(id){const p=state.plannedMeals.find(x=>Number(x.id)===id);if(!p)return;if(p.planned_date>todayString()){showToast('A planned future meal cannot be logged yet.',true);return;}const es=templateEntries(p.template_id);if(!es.length){showToast('This saved meal has no food entries.',true);return;}try{const payload=es.map(e=>({user_id:currentUser.id,food_id:e.food_id||null,date:p.planned_date,meal_type:p.meal_type,servings:num(e.servings)*num(p.servings_multiplier),entry_type:e.entry_type||'FOOD',recipe_id:e.recipe_id||null,food_name:e.food_name,serving_size:e.serving_size,calories:e.calories,protein:e.protein,carbs:e.carbs,fat:e.fat,fiber:e.fiber}));const {error}=await supabaseClient.from('meal_entries').insert(payload);if(error)throw error;await dbDelete('planned_meals',id);selectedDate=p.planned_date;await loadAll();renderPlanner();showToast('Planned meal logged to diary.');}catch(error){showToast(error.message,true);}}

// ---------- Android parity: grocery lists ----------
const groceryCategories=['Produce','Meat & Seafood','Dairy & Eggs','Frozen','Bakery','Pantry','Other'];
function guessGroceryCategory(name){const n=String(name||'').toLowerCase();if(/apple|banana|lettuce|tomato|onion|pepper|spinach|broccoli|carrot|produce|berry|avocado|potato|green bean/.test(n))return 'Produce';if(/chicken|beef|pork|turkey|fish|salmon|shrimp|meat|sausage|bacon/.test(n))return 'Meat & Seafood';if(/milk|cheese|yogurt|butter|cream|egg/.test(n))return 'Dairy & Eggs';if(/frozen|ice cream/.test(n))return 'Frozen';if(/bread|bun|tortilla|bagel|muffin|roll/.test(n))return 'Bakery';if(/rice|bean|pasta|flour|sugar|oil|cereal|oat|sauce|seasoning|spice|can|broth|peanut butter/.test(n))return 'Pantry';return 'Other';}
function formatGroceryQty(value){return amount(value);}
function buildGroceryLines(weekStart){const byKey=new Map();const add=(name,serving,quantity,category)=>{name=String(name||'Unnamed food').trim()||'Unnamed food';serving=String(serving||'serving').trim()||'serving';const norm=`${name.toLowerCase()}|${serving.toLowerCase()}`,key=`${weekStart}|${norm}`;const prev=byKey.get(key);byKey.set(key,{key,name,serving,quantity:num(quantity)+(prev?.quantity||0),category:prev?.category||category||guessGroceryCategory(name)});};for(const p of state.plannedMeals.filter(p=>p.planned_date>=weekStart&&p.planned_date<=shiftDate(weekStart,6)))for(const e of templateEntries(p.template_id))add(e.food_name,e.serving_size,num(e.servings)*num(p.servings_multiplier),guessGroceryCategory(e.food_name));for(const x of state.groceryRecipeIngredients.filter(x=>(x.week_start??x.weekStart)===weekStart))add(x.food_name??x.foodName,x.serving_size??x.servingSize,x.quantity,x.category||guessGroceryCategory(x.food_name??x.foodName));return [...byKey.values()].sort((a,b)=>a.name.localeCompare(b.name));}
function groceryIsChecked(key){return Boolean(state.groceryChecks.find(c=>(c.item_key??c.itemKey)===key&&(c.is_checked??c.isChecked)));}
async function setGroceryChecked(key,value){const payload={user_id:currentUser.id,item_key:key,is_checked:Boolean(value),updated_at_ms:Date.now()};const {error}=await supabaseClient.from('grocery_check_states').upsert(payload,{onConflict:'user_id,item_key'});if(error)throw error;}
function renderPlannerGroceries(weekStart){
  if(!state.groceryAvailable){showToast('Grocery cloud tables are missing. Run supabase/migrations/20261013_grocery_list_cloud_sync.sql in Supabase SQL Editor, then refresh.',true);return;}
  const end=shiftDate(weekStart,6),generated=buildGroceryLines(weekStart),manual=state.groceryManualItems.filter(x=>(x.week_start??x.weekStart)===weekStart),recipeRows=state.groceryRecipeIngredients.filter(x=>(x.week_start??x.weekStart)===weekStart);
  const checked=generated.filter(x=>groceryIsChecked(x.key)).length+manual.filter(x=>x.is_checked).length;const total=generated.length+manual.length;
  const allRows=[...generated.map(x=>({category:x.category,name:x.name,quantity:`${formatGroceryQty(x.quantity)} × ${x.serving}`,checked:groceryIsChecked(x.key),generated:true,key:x.key})),...manual.map(x=>({category:x.category,name:x.name,quantity:x.quantity||'',checked:Boolean(x.is_checked),manual:true,id:x.id}))];
  const cats=[...groceryCategories,...new Set(allRows.map(x=>x.category).filter(x=>!groceryCategories.includes(x)))];
  openModal(`<div class=\"modal-header\"><div><h2>Weekly Grocery List</h2><div class=\"muted\">${fmtShortDate(weekStart)} – ${fmtDate(end)} · ${checked} of ${total} checked</div></div><button class=\"ghost\" data-close>Close</button></div><div class=\"actions grocery-toolbar\"><button id=\"share-grocery-list\">Share list</button><button id=\"print-grocery-list\">Print / Save PDF</button><button id=\"add-grocery-recipe\">+ Add recipe</button><button class=\"primary\" id=\"add-grocery-manual\">+ Add item</button><button id=\"clear-grocery-checks\">Clear checked</button></div><div class=\"grocery-filter-row\"><label>Filter category<select id=\"grocery-category-filter\">${['All',...cats].map(c=>`<option>${esc(c)}</option>`).join('')}</select></label></div><div id=\"grocery-items\" class=\"grocery-items\"></div><div id=\"included-recipes\" class=\"inline-note\"></div>`);
  const draw=()=>{const filter=$('grocery-category-filter').value;const view=allRows.filter(r=>filter==='All'||r.category===filter).sort((a,b)=>a.category.localeCompare(b.category)||Number(a.checked)-Number(b.checked)||a.name.localeCompare(b.name));$('grocery-items').innerHTML=view.length?view.map(r=>`<div class=\"grocery-row ${r.checked?'checked':''}\"><label class=\"grocery-check-label\"><input type=\"checkbox\" data-grocery-check=\"${esc(r.key||('manual-'+r.id))}\" ${r.checked?'checked':''}><span><strong>${esc(r.name)}</strong><small>${esc(r.category)}${r.quantity?' · '+esc(r.quantity):''}</small></span></label><div class=\"entry-actions\">${r.manual?`<button data-edit-grocery=\"${r.id}\">Edit</button><button data-remove-grocery=\"${r.id}\">Remove</button>`:r.recipe?`<button data-edit-recipe-grocery=\"${r.id}\">Edit</button><button data-remove-recipe-grocery=\"${r.id}\">Remove</button>`:'<span class=\"muted\">Planned</span>'}</div></div>`).join(''):'<div class=\"empty\">No items in this category. Add a meal plan or grocery item to get started.</div>';document.querySelectorAll('[data-grocery-check]').forEach(b=>b.onchange=async()=>{try{const row=allRows.find(x=>(x.key||`manual-${x.id}`)===b.dataset.groceryCheck);if(row?.manual){const {error}=await supabaseClient.from('grocery_manual_items').update({is_checked:b.checked}).eq('id',row.id);if(error)throw error;}else await setGroceryChecked(b.dataset.groceryCheck,b.checked);await loadAll();renderPlannerGroceries(weekStart);}catch(error){showToast(error.message,true);}});document.querySelectorAll('[data-edit-grocery]').forEach(b=>b.onclick=()=>openManualGroceryForm(weekStart,Number(b.dataset.editGrocery)));document.querySelectorAll('[data-remove-grocery]').forEach(b=>b.onclick=async()=>{try{await dbDelete('grocery_manual_items',Number(b.dataset.removeGrocery));await loadAll();renderPlannerGroceries(weekStart);}catch(error){showToast(error.message,true);}});document.querySelectorAll('[data-edit-recipe-grocery]').forEach(b=>b.onclick=()=>openRecipeGroceryEdit(weekStart,Number(b.dataset.editRecipeGrocery)));document.querySelectorAll('[data-remove-recipe-grocery]').forEach(b=>b.onclick=async()=>{try{await dbDelete('grocery_recipe_ingredients',Number(b.dataset.removeRecipeGrocery));await loadAll();renderPlannerGroceries(weekStart);}catch(error){showToast(error.message,true);}});};
  $('grocery-category-filter').value='All';$('grocery-category-filter').onchange=draw;draw();
  $('add-grocery-manual').onclick=()=>openManualGroceryForm(weekStart,null);
  $('add-grocery-recipe').onclick=()=>openRecipeGroceryPicker(weekStart);
  $('share-grocery-list').onclick=async()=>{const text=`FoodTracker grocery list\n${fmtShortDate(weekStart)} – ${fmtDate(end)}\n${checked} of ${total} checked\n\n`+cats.map(c=>{const rows=allRows.filter(r=>r.category===c).sort((a,b)=>Number(a.checked)-Number(b.checked)||a.name.localeCompare(b.name));return rows.length?`${c}\n${rows.map(r=>`${r.checked?'[x]':'[ ]'} ${r.name}${r.quantity?' — '+r.quantity:''}`).join('\n')}`:'';}).filter(Boolean).join('\n\n');try{if(navigator.share)await navigator.share({title:'FoodTracker Grocery List',text});else if(navigator.clipboard){await navigator.clipboard.writeText(text);showToast('Grocery list copied to clipboard.');}else{prompt('Copy your grocery list',text);}}catch(error){if(error.name!=='AbortError')showToast(error.message,true);}};
  $('print-grocery-list').onclick=()=>{const body=`<h1>FoodTracker Grocery List</h1><div class=\"muted\">${fmtShortDate(weekStart)} – ${fmtDate(end)} · ${checked} of ${total} items checked</div>${cats.map(c=>{const rs=allRows.filter(r=>r.category===c).sort((a,b)=>Number(a.checked)-Number(b.checked)||a.name.localeCompare(b.name));return rs.length?`<div class=\"group\"><h2>${esc(c)}</h2>${rs.map(r=>`<div class=\"row ${r.checked?'checked':''}\"><span><span class=\"check\">${r.checked?'✓':''}</span>${esc(r.name)}</span><span>${esc(r.quantity)}</span></div>`).join('')}</div>`:'';}).join('')}`;showPrintDocument('FoodTracker Grocery List',body);};
  $('clear-grocery-checks').onclick=async()=>{if(!confirm('Uncheck all items for this week?'))return;try{for(const r of generated)await setGroceryChecked(r.key,false);for(const r of manual.filter(x=>x.is_checked)){const {error}=await supabaseClient.from('grocery_manual_items').update({is_checked:false}).eq('id',r.id);if(error)throw error;}await loadAll();renderPlannerGroceries(weekStart);}catch(error){showToast(error.message,true);}};
  const inc=state.groceryRecipeIngredients.filter(x=>(x.week_start??x.weekStart)===weekStart);$('included-recipes').innerHTML=inc.length?`<div style="margin-top:18px"><strong>Recipe ingredients included</strong><div class="muted" style="margin:6px 0 10px">${[...new Set(inc.map(x=>x.recipe_name??x.recipeName))].map(esc).join(', ')}</div>${inc.map(x=>`<div class="entry"><div class="entry-main"><strong>${esc(x.food_name??x.foodName)}</strong><div class="muted">${esc(x.recipe_name??x.recipeName)} · ${amount(x.quantity)} × ${esc(x.serving_size??x.servingSize)}</div></div><div class="entry-actions"><button data-edit-recipe-grocery="${x.id}">Edit</button><button data-remove-recipe-grocery="${x.id}">Remove</button></div></div>`).join('')}</div>`:'<div class="inline-note">No recipe ingredients added.</div>';document.querySelectorAll('[data-edit-recipe-grocery]').forEach(b=>b.onclick=()=>openRecipeGroceryEdit(weekStart,Number(b.dataset.editRecipeGrocery)));document.querySelectorAll('[data-remove-recipe-grocery]').forEach(b=>b.onclick=async()=>{try{await dbDelete('grocery_recipe_ingredients',Number(b.dataset.removeRecipeGrocery));await loadAll();renderPlannerGroceries(weekStart);}catch(error){showToast(error.message,true);}});
}
function openManualGroceryForm(weekStart,id){const x=id?state.groceryManualItems.find(r=>Number(r.id)===id):null;openModal(`<div class=\"modal-header\"><h2>${x?'Edit grocery item':'Add grocery item'}</h2><button class=\"ghost\" data-close>Close</button></div><form id=\"manual-grocery-form\" class=\"modal-body\"><label>Item name<input name=\"name\" maxlength=100 value=\"${esc(x?.name||'')}\" required></label><label>Quantity<input name=\"quantity\" maxlength=50 placeholder=\"e.g. 2 bags, 1 lb\" value=\"${esc(x?.quantity||'')}\"></label><label>Category<select name=\"category\">${groceryCategories.map(c=>`<option ${c===(x?.category||'Other')?'selected':''}>${esc(c)}</option>`).join('')}</select></label></form><div class=\"modal-footer\"><button class=\"ghost\" data-close>Cancel</button><button class=\"primary\" id=\"save-manual-grocery\">Save</button></div>`);$('save-manual-grocery').onclick=async()=>{const f=$('manual-grocery-form');if(!f.reportValidity())return;const d=Object.fromEntries(new FormData(f));try{if(x){const {error}=await supabaseClient.from('grocery_manual_items').update({name:d.name.trim(),quantity:d.quantity.trim(),category:d.category}).eq('id',x.id);if(error)throw error;}else{await dbInsert('grocery_manual_items',{user_id:currentUser.id,week_start:weekStart,name:d.name.trim(),quantity:d.quantity.trim(),category:d.category,is_checked:false});}closeModal();await loadAll();renderPlannerGroceries(weekStart);}catch(error){showToast(error.message,true);}};}
function openRecipeGroceryPicker(weekStart){const recipes=state.recipes;openModal(`<div class=\"modal-header\"><h2>Add recipe ingredients</h2><button class=\"ghost\" data-close>Close</button></div><div class=\"modal-body\"><p class=\"muted\">Ingredients are saved as a snapshot, so later recipe edits won't change this grocery list.</p><label>Recipe<select id=\"recipe-grocery-choice\">${recipes.map(r=>`<option value=\"${r.id}\">${esc(r.name)}</option>`).join('')}</select></label></div><div class=\"modal-footer\"><button class=\"ghost\" data-close>Cancel</button><button class=\"primary\" id=\"save-recipe-grocery\" ${recipes.length?'':'disabled'}>Add recipe</button></div>`);$('save-recipe-grocery').onclick=async()=>{const id=Number($('recipe-grocery-choice').value),r=recipes.find(x=>x.id===id);if(!r)return;try{if(state.groceryRecipeIngredients.some(x=>(x.week_start??x.weekStart)===weekStart&&Number(x.recipe_id??x.recipeId)===id)){showToast('This recipe is already included this week.',true);return;}const is=state.recipeIngredients.filter(i=>Number(i.recipe_id)===id);if(!is.length){showToast('This recipe has no ingredients.',true);return;}const rows=is.map(i=>({user_id:currentUser.id,week_start:weekStart,recipe_id:id,recipe_name:r.name,food_name:i.food_name,serving_size:i.serving_size,quantity:num(i.quantity),category:guessGroceryCategory(i.food_name)}));const {error}=await supabaseClient.from('grocery_recipe_ingredients').insert(rows);if(error)throw error;closeModal();await loadAll();renderPlannerGroceries(weekStart);showToast('Recipe added to groceries.');}catch(error){showToast(error.message,true);}};}
function openRecipeGroceryEdit(weekStart,id){const x=state.groceryRecipeIngredients.find(r=>Number(r.id)===id);if(!x)return;openModal(`<div class=\"modal-header\"><h2>Edit recipe ingredient</h2><button class=\"ghost\" data-close>Close</button></div><form id=\"recipe-grocery-form\" class=\"modal-body\"><label>Ingredient name<input name=\"food_name\" value=\"${esc(x.food_name??x.foodName)}\" required></label><label>Quantity<input name=\"quantity\" type=\"number\" min=\"0\" step=\"0.25\" value=\"${num(x.quantity)}\" required></label><label>Serving size / unit<input name=\"serving_size\" value=\"${esc(x.serving_size??x.servingSize)}\" required></label><label>Category<select name=\"category\">${groceryCategories.map(c=>`<option ${c===x.category?'selected':''}>${esc(c)}</option>`).join('')}</select></label></form><div class=\"modal-footer\"><button class=\"ghost\" data-close>Cancel</button><button class=\"primary\" id=\"save-recipe-grocery-edit\">Save</button></div>`);$('save-recipe-grocery-edit').onclick=async()=>{const f=$('recipe-grocery-form');if(!f.reportValidity())return;const d=Object.fromEntries(new FormData(f));try{const {error}=await supabaseClient.from('grocery_recipe_ingredients').update({food_name:d.food_name.trim(),quantity:num(d.quantity),serving_size:d.serving_size.trim(),category:d.category}).eq('id',id);if(error)throw error;closeModal();await loadAll();renderPlannerGroceries(weekStart);}catch(error){showToast(error.message,true);}};}

async function openFoodDatabaseSearchModal(){
  openModal(`<div class=\"modal-header\"><h2>Search Food Database</h2><button class=\"ghost\" data-close>Close</button></div><form id=\"food-db-search-form\" class=\"modal-body\"><label>Search USDA FoodData Central<input name=\"query\" minlength=\"2\" placeholder=\"e.g. chicken breast, Greek yogurt\" required></label><div class=\"muted\">Results are supplied by the Supabase food-search Edge Function. The USDA API key stays server-side.</div><button class=\"primary\" id=\"food-db-search-submit\">Search</button></form><div id=\"food-db-results\"></div>`);
  $('food-db-search-form').onsubmit=async e=>{e.preventDefault();const q=new FormData(e.currentTarget).get('query').trim();const b=$('food-db-search-submit');b.disabled=true;b.textContent='Searching…';$('food-db-results').innerHTML='<div class=\"empty\">Searching food database…</div>';try{const {data,error}=await supabaseClient.functions.invoke('food-search',{body:{query:q}});if(error)throw error;const foods=data?.foods||[];$('food-db-results').innerHTML=foods.length?`<div class=\"food-db-list\">${foods.map((f,i)=>`<div class=\"entry\"><div class=\"entry-main\"><strong>${esc(f.description)}</strong><div class=\"muted\">${esc(f.brandOwner||f.dataType||'USDA')} · ${esc(f.servingSize||'100 g')}</div><div class=\"entry-macros\">${Math.round(num(f.calories))} cal · ${Math.round(num(f.protein))}g protein · ${Math.round(num(f.carbs))}g carbs · ${Math.round(num(f.fat))}g fat · ${Math.round(num(f.fiber))}g fiber</div></div><button class=\"primary\" data-use-db-food=\"${i}\">Use</button></div>`).join('')}</div>`:'<div class=\"empty\">No foods found. Try a shorter search.</div>';document.querySelectorAll('[data-use-db-food]').forEach(btn=>btn.onclick=()=>{const f=foods[Number(btn.dataset.useDbFood)];closeModal();openFoodEditModal(null,{name:f.description,serving_size:f.servingSize||'100 g',calories:f.calories,protein:f.protein,carbs:f.carbs,fat:f.fat,fiber:f.fiber,is_favorite:false});});}catch(error){$('food-db-results').innerHTML=`<div class=\"notice\">${esc(error.message||'Food database search failed.')}<br><small>Check that the food-search Edge Function is deployed and its USDA_API_KEY secret is configured.</small></div>`;}finally{b.disabled=false;b.textContent='Search';}};
}

// Keep adjacent navigation consistent with the Android app's swipe navigation.
function setupSwipeNavigation(){const tabs=['today','foods','recipes','history','planner','goals','settings'];let x=0,y=0;const root=$('main-view');root.addEventListener('touchstart',e=>{if(e.touches.length!==1||!e.target.closest('.page-wrap'))return;x=e.touches[0].clientX;y=e.touches[0].clientY;},{passive:true});root.addEventListener('touchend',e=>{if(!x||$('modal-root').innerHTML)return;const dx=e.changedTouches[0].clientX-x,dy=e.changedTouches[0].clientY-y;x=0;if(Math.abs(dx)<90||Math.abs(dx)<Math.abs(dy)*1.3)return;const i=tabs.indexOf(activeTab),next=i+(dx<0?1:-1);if(next>=0&&next<tabs.length)navigate(tabs[next]);},{passive:true});}


setupEvents();
setupSwipeNavigation();
initAuth();
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
