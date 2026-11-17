// Launch Radar's page. It reads window.RADAR (written beside dashboard/ by
// main.ts from the same board board.json carries) and renders the ranked
// board, its filters, and one detail view per protocol with the model's
// factors and the farm plan. No network: every byte shown is in data.js.
// The page recomputes each implied value from the row's own figures with
// impliedOf below, the same arithmetic as lib/model.ts, and marks the rows
// where the two agree, so what the board claims the code can be checked
// against on the spot.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('app');
  if (!DATA || !app) return;
  var C = DATA.constants;

  var params = new URLSearchParams(location.search);
  var state = {
    view: params.get('view') === 'detail' ? 'detail' : 'board',
    slug: params.get('slug') || null,
    q: params.get('q') || '',
    category: params.get('category') || 'all',
    chain: params.get('chain') || 'all',
    tier: params.get('tier') || 'all',
    watchlist: params.get('watchlist') === '1',
    sort: params.get('sort') || 'implied',
    dir: params.get('dir') === 'asc' ? 1 : -1,
  };

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'untracked';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }
  function fmtMult(n) { return 'x' + Number(n).toFixed(2); }

  // The model, restated: the page's own copy of lib/model.ts's impliedValue,
  // fed with the row's stored category multiple.
  function impliedOf(row) {
    var g = Math.min(C.growth_cap, Math.max(C.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    var growth = 1 + (g / 100) * C.growth_weight;
    var age = row.age_days === null ? C.unknown_age_days : row.age_days;
    var maturity = C.maturity_floor + (Math.min(Math.max(age, 0), C.maturity_days) / C.maturity_days) * C.maturity_range;
    var reach = 1 + C.reach_per_chain * Math.min(Math.max(row.chains.length - 1, 0), C.reach_max_extra_chains);
    return Math.max(1, Math.round(row.tvl_usd * row.model.category_multiple * growth * maturity * reach));
  }
  function agrees(row) {
    var mine = impliedOf(row);
    return Math.abs(mine - row.implied_value_usd) <= Math.max(2, row.implied_value_usd * 0.001);
  }

  function categories() {
    var seen = {};
    DATA.rows.forEach(function (r) { if (r.category) seen[r.category] = 1; });
    return Object.keys(seen).sort();
  }
  function chains() {
    var seen = {};
    DATA.rows.forEach(function (r) { r.chains.forEach(function (c) { seen[c] = 1; }); });
    return Object.keys(seen).sort();
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchlist && !r.watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.tier !== 'all' && r.tier !== state.tier) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  var SORTS = {
    rank: function (r) { return r.rank; },
    name: function (r) { return r.name.toLowerCase(); },
    tvl: function (r) { return r.tvl_usd; },
    change: function (r) { return r.change_7d === null ? -Infinity : r.change_7d; },
    age: function (r) { return r.age_days === null ? -1 : r.age_days; },
    implied: function (r) { return r.implied_value_usd; },
    ratio: function (r) { return r.tvl_usd > 0 ? r.implied_value_usd / r.tvl_usd : 0; },
  };
  function sorted(rows) {
    var key = SORTS[state.sort] || SORTS.implied;
    return rows.slice().sort(function (a, b) {
      var x = key(a), y = key(b);
      if (x < y) return -state.dir;
      if (x > y) return state.dir;
      return a.rank - b.rank;
    });
  }

  function headerHTML() {
    return '<div class="head"><div class="scope" aria-hidden="true"></div><div>' +
      '<h1>Launch <span class="thin">Radar</span></h1>' +
      '<p class="tagline">Protocols that record <b>no token yet</b>, ranked by what a token would be worth ' +
      'if it traded like the peers that already have one. Every row carries the steps to farm it.</p>' +
      '<div class="meta">snapshot ' + esc(DATA.as_of) + ' · ' + esc(DATA.source) + ' · model ' + esc(DATA.model_version) + '</div>' +
      '</div></div>';
  }
  function statsHTML() {
    var wl = DATA.rows.filter(function (r) { return r.watchlist; }).length;
    return '<div class="stats">' +
      stat(DATA.scanned, 'protocols scanned') +
      stat(DATA.pre_token, 'record no token') +
      stat(DATA.board_size, 'ranked on the board') +
      stat('<em>' + wl + ' / ' + DATA.watchlist_size + '</em>', 'watchlist covered') +
      stat(fmtMult(DATA.global_multiple), 'median peer multiple') +
      stat(DATA.set_aside, 'already trading, set aside') +
      '</div>';
    function stat(n, k) { return '<div class="stat"><div class="n">' + n + '</div><div class="k">' + k + '</div></div>'; }
  }
  function options(list, current, allLabel) {
    var out = '<option value="all">' + allLabel + '</option>';
    list.forEach(function (v) { out += '<option value="' + esc(v) + '"' + (v === current ? ' selected' : '') + '>' + esc(v) + '</option>'; });
    return out;
  }
  function controlsHTML() {
    return '<div class="controls">' +
      '<div class="ctl"><label for="q">Search</label><input id="q" type="search" placeholder="name, slug, category" value="' + esc(state.q) + '"></div>' +
      '<div class="ctl"><label for="category">Category</label><select id="category">' + options(categories(), state.category, 'All categories') + '</select></div>' +
      '<div class="ctl"><label for="chain">Chain</label><select id="chain">' + options(chains(), state.chain, 'All chains') + '</select></div>' +
      '<div class="ctl"><label for="tier">Tier</label><select id="tier">' + options(['Watchlist', 'Core', 'Early'], state.tier, 'All tiers') + '</select></div>' +
      '<div class="ctl check"><input id="watchlist" type="checkbox"' + (state.watchlist ? ' checked' : '') + '><label for="watchlist">Watchlist only</label></div>' +
      '</div>';
  }
  function th(key, label, cls) {
    var arrow = state.sort === key ? ' <span class="dir">' + (state.dir === -1 ? '▾' : '▴') + '</span>' : '';
    return '<th class="sortable ' + (cls || '') + '" data-sort="' + key + '">' + label + arrow + '</th>';
  }
  function tableHTML(rows) {
    if (rows.length === 0) return '<div class="empty">No protocol matches this filter. Loosen it: the radar is wider than one view.</div>';
    var body = rows.map(function (r) {
      var chg = r.change_7d === null ? '' : (r.change_7d >= 0 ? 'up' : 'down');
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td>' + r.rank + '</td>' +
        '<td class="l name">' + esc(r.name) + (r.watchlist ? ' <span class="wl" title="On the house watchlist">★</span>' : '') +
        '<span class="sub">' + esc(r.slug) + '</span></td>' +
        '<td class="l">' + esc(r.category || 'Uncategorised') + '</td>' +
        '<td class="l">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td>' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="' + chg + '">' + fmtPct(r.change_7d) + '</td>' +
        '<td>' + fmtAge(r.age_days) + '</td>' +
        '<td class="implied">' + fmtUsd(r.implied_value_usd) + '</td>' +
        '<td>' + fmtMult(r.tvl_usd > 0 ? r.implied_value_usd / r.tvl_usd : 0) + '</td>' +
        '<td class="l"><span class="chip ' + r.tier.toLowerCase() + '">' + r.tier + '</span></td>' +
        '</tr>';
    }).join('');
    return '<table><thead><tr>' +
      th('rank', '#') + th('name', 'Protocol', 'l') + '<th class="l">Category</th><th class="l">Chains</th>' +
      th('tvl', 'TVL') + th('change', '7d') + th('age', 'Age') + th('implied', 'Implied value') + th('ratio', 'x TVL') + '<th class="l">Tier</th>' +
      '</tr></thead><tbody>' + body + '</tbody></table>';
  }
  function liveHTML() {
    var body = DATA.live.map(function (r) {
      return '<tr><td class="l name">' + esc(r.name) + '<span class="sub">' + esc(r.slug) + '</span></td>' +
        '<td class="l">' + esc(r.category || 'Uncategorised') + '</td>' +
        '<td>' + fmtUsd(r.tvl_usd) + '</td><td>' + fmtUsd(r.mcap_usd) + '</td>' +
        '<td>' + fmtMult(r.tvl_usd > 0 && r.mcap_usd ? r.mcap_usd / r.tvl_usd : 0) + '</td></tr>';
    }).join('');
    return '<div class="section"><h2>Already trading: set aside, not ranked</h2>' +
      '<p>These protocols record a token, so the market prices them and a radar has nothing to add. ' +
      'They are not wasted here: <b>their market-cap to TVL ratios are the multiples the board prices with</b>, ' +
      'category by category. The largest by market cap:</p>' +
      '<table class="live-table"><thead><tr><th class="l">Protocol</th><th class="l">Category</th><th>TVL</th><th>Market cap</th><th>MCap x TVL</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table></div>';
  }
  function modelHTML() {
    return '<div class="section"><h2>How the price is made</h2>' +
      '<div class="formula">implied = TVL x category multiple x growth x maturity x reach</div>' +
      '<ul>' +
      '<li><b>Category multiple.</b> For each category, the median market-cap / TVL of the protocols in it whose token already trades (TVL at least $1M), each peer\u2019s ratio first winsorized to x0.02–x20 so one stale TVL print cannot set a price, then shrunk toward the global median by peer count: (n x category + 5 x global) / (n + 5), clamped to x0.05–x3.00. No multiple is typed in by hand; change the snapshot and every multiple moves.</li>' +
      '<li><b>Growth.</b> 1 + clamp(7-day TVL change, -40%, +60%) x 0.35. A rising protocol is priced up, a shrinking one down, neither without limit.</li>' +
      '<li><b>Maturity.</b> 0.70 + 0.30 x min(age, 3 years) / 3 years, age being the days DefiLlama has tracked the protocol with no token. Untracked protocols are priced as 300 days old.</li>' +
      '<li><b>Reach.</b> 1 + 0.02 per extra chain beyond the first, up to ten: a wider deployment has more holders to distribute to.</li>' +
      '<li><b>Who is ranked.</b> Every watchlist protocol, always. Below the $' + (DATA.floor_usd / 1e6) + 'M floor, the strongest further protocols that record no token, leaving out exchanges, bridges and wrapped or staked products of tokens that already trade, and versioned pools of a protocol already counted. A protocol is said to <b>record</b> no token: the snapshot is a record, not a proof.</li>' +
      '<li><b>Reading a row.</b> Implied value is the entry\u2019s own claim about a launch that may never happen, not a prediction and not advice. The farm plan is what a reader can do about it before or after a token exists.</li>' +
      '</ul></div>';
  }

  function detailHTML(r) {
    var m = r.model;
    function bar(label, v, max, note) {
      var pct = Math.max(2, Math.min(100, (v / max) * 100));
      return '<div class="factor"><div class="top"><span>' + label + '</span><span class="v">' + fmtMult(v) + '</span></div>' +
        '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
        (note ? '<div class="meta">' + note + '</div>' : '') + '</div>';
    }
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    return '<button class="back" id="back">← Back to the board</button>' +
      '<div class="detail-head"><h2>' + esc(r.name) + '</h2>' +
      '<span class="chip ' + r.tier.toLowerCase() + '">' + r.tier + '</span>' +
      (r.watchlist ? '<span class="chip watchlist">★ house watchlist</span>' : '') +
      '<span class="cat">' + esc(r.category || 'Uncategorised') + ' · rank #' + r.rank + ' of ' + DATA.board_size + '</span></div>' +
      '<div class="grid">' +
      '<div class="card"><h3>The record</h3>' +
      kv('TVL', fmtUsd(r.tvl_usd)) +
      kv('TVL change, 7d', fmtPct(r.change_7d)) +
      kv('Chains', esc(r.chains.join(', ') || 'none listed')) +
      kv('Tracked since', esc(r.listed_at || 'untracked')) +
      kv('Age with no token', fmtAge(r.age_days)) +
      kv('Token', 'records none in this snapshot') +
      '</div>' +
      '<div class="card"><h3>The price, factor by factor</h3>' +
      bar('Category multiple', m.category_multiple, 3, m.category_peers > 0 ? 'median of ' + m.category_peers + ' trading peer' + (m.category_peers === 1 ? '' : 's') + ' in ' + esc(r.category || 'its category') : 'no trading peers in its category: the global median') +
      bar('Growth', m.growth_multiplier, 1.3, 'from the 7-day TVL change of ' + fmtPct(r.change_7d)) +
      bar('Maturity', m.maturity_multiplier, 1, 'from ' + fmtAge(r.age_days) + ' tracked with no token') +
      bar('Reach', m.reach_multiplier, 1.2, 'from ' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's')) +
      '<div class="arith">' + fmtUsd(r.tvl_usd) + ' x ' + m.category_multiple + ' x ' + m.growth_multiplier + ' x ' + m.maturity_multiplier + ' x ' + m.reach_multiplier +
      ' = <b>' + fmtUsd(r.implied_value_usd) + '</b> implied' +
      (agrees(r) ? ' · this page recomputes the same figure from the record' : '') + '</div>' +
      '</div>' +
      '<div class="card"><h3>The farm plan</h3><ol class="steps">' + steps + '</ol></div>' +
      '</div>';
    function kv(k, v) { return '<div class="kv"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>'; }
  }

  function render() {
    if (state.view === 'detail' && state.slug) {
      var row = null;
      DATA.rows.forEach(function (r) { if (r.slug === state.slug) row = r; });
      if (row) {
        app.innerHTML = headerHTML() + detailHTML(row) +
          '<footer>Launch Radar · model ' + esc(DATA.model_version) + ' · figures from the sealed snapshot of ' + esc(DATA.as_of) + '; implied values are the board\u2019s own claims, not predictions.</footer>';
        app.setAttribute('aria-busy', 'false');
        document.getElementById('back').addEventListener('click', function () {
          state.view = 'board'; render(); window.scrollTo(0, 0);
        });
        return;
      }
      state.view = 'board';
    }
    var rows = sorted(filtered());
    app.innerHTML = headerHTML() + statsHTML() + controlsHTML() +
      '<p class="count-line">showing ' + rows.length + ' of ' + DATA.board_size + ' ranked protocols · sorted by ' + state.sort + ' · click a row for its price breakdown and farm plan</p>' +
      tableHTML(rows) + liveHTML() + modelHTML() +
      '<footer>Launch Radar · model ' + esc(DATA.model_version) + ' · snapshot ' + esc(DATA.as_of) + ' · a protocol is said to record no token, never to have none; implied values are the board\u2019s own claims, not predictions or advice.</footer>';
    app.setAttribute('aria-busy', 'false');
    bind();
  }

  function bind() {
    var q = document.getElementById('q');
    q.addEventListener('input', function () { state.q = q.value; refreshTable(); });
    document.getElementById('category').addEventListener('change', function (e) { state.category = e.target.value; render(); });
    document.getElementById('chain').addEventListener('change', function (e) { state.chain = e.target.value; render(); });
    document.getElementById('tier').addEventListener('change', function (e) { state.tier = e.target.value; render(); });
    document.getElementById('watchlist').addEventListener('change', function (e) { state.watchlist = e.target.checked; render(); });
    app.querySelectorAll('th.sortable').forEach(function (t) {
      t.addEventListener('click', function () {
        var k = t.getAttribute('data-sort');
        if (state.sort === k) state.dir = -state.dir;
        else { state.sort = k; state.dir = k === 'name' ? 1 : -1; }
        render();
      });
    });
    bindRows();
  }
  function bindRows() {
    app.querySelectorAll('tbody tr[data-slug]').forEach(function (tr) {
      tr.addEventListener('click', function () {
        state.view = 'detail'; state.slug = tr.getAttribute('data-slug'); render(); window.scrollTo(0, 0);
      });
    });
  }
  // Search re-renders only the table body, so typing does not lose the caret.
  function refreshTable() {
    var rows = sorted(filtered());
    var table = app.querySelector('table');
    var count = app.querySelector('.count-line');
    if (count) count.textContent = 'showing ' + rows.length + ' of ' + DATA.board_size + ' ranked protocols · sorted by ' + state.sort + ' · click a row for its price breakdown and farm plan';
    if (table) {
      var wrap = document.createElement('div');
      wrap.innerHTML = tableHTML(rows);
      table.replaceWith(wrap.firstChild);
      app.querySelectorAll('th.sortable').forEach(function (t) {
        t.addEventListener('click', function () {
          var k = t.getAttribute('data-sort');
          if (state.sort === k) state.dir = -state.dir;
          else { state.sort = k; state.dir = k === 'name' ? 1 : -1; }
          render();
        });
      });
      bindRows();
    }
  }

  render();
})();
