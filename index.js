/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║       LIVE ARB BOT v3 — KENYA EDITION                    ║
 * ║                                                          ║
 * ║  Uses The Odds API (free tier) for reliable live data    ║
 * ║  Books: 1xBet, Betway, Marathonbet, Unibet, Betsson      ║
 * ║  + 22Bet scraped directly                                ║
 * ║                                                          ║
 * ║  WHY THE ODDS API:                                       ║
 * ║  SportyBet/Betika block GitHub IPs (all return 404)      ║
 * ║  The Odds API is reliable, fast, and free for 500 req/mo ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * SECRETS NEEDED (GitHub → Settings → Secrets):
 *   TELEGRAM_TOKEN    — from @BotFather
 *   TELEGRAM_CHAT_ID  — your personal chat ID (NOT the bot ID)
 *   ODDS_API_KEY      — free at https://the-odds-api.com
 */

const axios = require("axios");

const TELEGRAM_TOKEN   = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const ODDS_API_KEY     = process.env.ODDS_API_KEY;
const MIN_PROFIT_PCT   = parseFloat(process.env.MIN_PROFIT_PCT || "0");
const STAKE            = parseFloat(process.env.STAKE || "1000");

// ─── BOOKMAKERS ──────────────────────────────────────────────
// These are all available on Odds API free tier
const BOOKS = {
  "onexbet":     "1xBet 🇰🇪",
  "betway":      "Betway 🇰🇪",
  "marathonbet": "MarathonBet 🇰🇪",
  "unibet_eu":   "Unibet 🇰🇪",
  "betsson":     "Betsson 🇰🇪",
  "parimatch":   "Parimatch 🇰🇪",
};
const BOOK_KEYS = Object.keys(BOOKS).join(",");

// Top live sports to scan — football first, then basketball
const LIVE_SPORTS = [
  "soccer_epl",
  "soccer_uefa_champs_league",
  "soccer_uefa_europa_league",
  "soccer_spain_la_liga",
  "soccer_germany_bundesliga",
  "soccer_italy_serie_a",
  "soccer_france_ligue_one",
  "soccer_netherlands_eredivisie",
  "soccer_portugal_primeira_liga",
  "soccer_turkey_super_league",
  "soccer_brazil_campeonato",
  "soccer_argentina_primera_division",
  "soccer_africa_africa_cup_of_nations",
  "soccer_kenya_premier_league",
  "basketball_nba",
  "basketball_euroleague",
  "tennis_atp_french_open",
  "tennis_wta_french_open",
];

// ─── HELPERS ─────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function nowKE() {
  return new Date().toLocaleTimeString("en-KE", {
    timeZone: "Africa/Nairobi",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
}

function norm(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

function teamsMatch(h1, a1, h2, a2) {
  const [nh1, na1, nh2, na2] = [norm(h1), norm(a1), norm(h2), norm(a2)];
  if (nh1 === nh2 && na1 === na2) return true;
  if (nh1 === na2 && na1 === nh2) return true;
  const words = s => new Set(s.split(" ").filter(w => w.length > 2));
  const ov = (x, y) => { let n = 0; for (const w of words(x)) if (words(y).has(w)) n++; return n; };
  return Math.max(ov(nh1, nh2) + ov(na1, na2), ov(nh1, na2) + ov(na1, nh2)) >= 2;
}

// ════════════════════════════════════════════════════════════
//  TELEGRAM
// ════════════════════════════════════════════════════════════
async function sendTelegram(msg) {
  try {
    const res = await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      { chat_id: TELEGRAM_CHAT_ID, text: msg, parse_mode: "HTML" },
      { timeout: 10000 }
    );
    if (res.data.ok) console.log("[TG ✅] Sent");
    else console.error("[TG ❌]", res.data.description);
  } catch (e) {
    console.error("[TG ERROR]", e.response?.data?.description || e.message);
  }
}

// ════════════════════════════════════════════════════════════
//  THE ODDS API — LIVE GAMES
//  Fetches in-play odds for a given sport
// ════════════════════════════════════════════════════════════
async function fetchLiveOdds(sport) {
  try {
    const { data, headers } = await axios.get(
      `https://api.the-odds-api.com/v4/sports/${sport}/odds/`,
      {
        params: {
          apiKey:     ODDS_API_KEY,
          regions:    "eu,uk",
          markets:    "totals",
          oddsFormat: "decimal",
          bookmakers: BOOK_KEYS,
          // Live games filter — only returns in-play events
          commenceTimeTo: new Date(Date.now() - 60000).toISOString(), // started before now
        },
        timeout: 20000,
      }
    );

    const remaining = headers["x-requests-remaining"] || "?";
    // Filter to only currently live (started but presumably ongoing)
    const now = Date.now();
    const liveGames = data.filter(g => {
      const start = new Date(g.commence_time).getTime();
      const hoursAgo = (now - start) / (1000 * 60 * 60);
      // Football: typically 0–2.5hrs, basketball: 0–3hrs
      return start <= now && hoursAgo < 3;
    });

    if (liveGames.length > 0) {
      console.log(`[${sport}] ${liveGames.length} live games | API left: ${remaining}`);
    }
    return liveGames.map(g => ({ ...g, isLive: true, sport_key: sport }));
  } catch (e) {
    // 422 = no games for this sport right now (normal)
    if (e.response?.status === 422) return [];
    // 401 = live not on free plan for this sport
    if (e.response?.status === 401) return [];
    console.error(`[ODDS API ERR] ${sport}: ${e.response?.data?.message || e.message}`);
    return [];
  }
}

// ════════════════════════════════════════════════════════════
//  22BET LIVE SCRAPER (direct — still works)
// ════════════════════════════════════════════════════════════
async function fetch22BetLive() {
  const games = [];
  try {
    const { data } = await axios.get(
      "https://22bet.com/LiveFeed/Get1_2",
      {
        params: { sports: "1,2,3", lng: "en", gr: 128, isGames: 1 },
        headers: {
          "User-Agent":       "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36",
          "Accept":           "application/json, text/javascript, */*; q=0.01",
          "Accept-Language":  "en-US,en;q=0.9",
          "Referer":          "https://22bet.com/live/",
          "X-Requested-With": "XMLHttpRequest",
        },
        timeout: 20000,
      }
    );

    if (!data?.Value) { console.log("[22BET LIVE] No data returned"); return games; }

    for (const league of data.Value) {
      for (const ev of (league.Events || [])) {
        const home = ev.Team1 || ev.HomeTeam || "";
        const away = ev.Team2 || ev.AwayTeam || "";
        if (!home || !away) continue;

        const sb = ev.Scoreboard;
        const minute = String(sb?.Time || ev.Timer || ev.MatchTime || "").replace(/\D/g, "") || null;
        const game = {
          bookmaker: "22Bet", bookKey: "22bet",
          home_team: home, away_team: away,
          score:       sb ? `${sb.Score1 ?? 0}-${sb.Score2 ?? 0}` : null,
          matchMinute: minute,
          league:      league.Name || "",
          markets:     {},
        };

        for (const mkt of (ev.GameEvents || ev.E || [])) {
          if (mkt.G !== 17 && mkt.GroupId !== 17) continue;
          let over = null, under = null, line = null;
          for (const oc of (mkt.GameEventItem || mkt.Items || [])) {
            const name = (oc.Name || oc.N || "").toLowerCase();
            const odd  = parseFloat(oc.Price || oc.Coef || oc.C || 0);
            const pt   = parseFloat(oc.Param || oc.P || 0);
            if (!odd || odd <= 1) continue;
            if (name.includes("over")  || name === "tb" || name === "o") { over  = odd; if (pt) line = String(pt); }
            if (name.includes("under") || name === "tm" || name === "u") { under = odd; if (pt && !line) line = String(pt); }
          }
          if (over && under && line) game.markets[line] = { over, under };
        }

        if (Object.keys(game.markets).length > 0) games.push(game);
      }
    }
    console.log(`[22BET LIVE] ✅ ${games.length} live games with totals`);
  } catch (e) {
    console.error("[22BET LIVE ERR]", e.response?.status || e.message);
  }
  return games;
}

// ════════════════════════════════════════════════════════════
//  ARB DETECTION — Odds API books vs each other
// ════════════════════════════════════════════════════════════
function findAPIArbs(games) {
  const arbs = [];
  for (const game of games) {
    const books = (game.bookmakers || []).filter(b => BOOKS[b.key]);
    if (books.length < 2) continue;

    const lines = {};
    for (const bk of books) {
      const name = BOOKS[bk.key];
      for (const mkt of (bk.markets || [])) {
        if (mkt.key !== "totals") continue;
        for (const oc of (mkt.outcomes || [])) {
          const line = String(oc.point);
          const side = oc.name.toLowerCase();
          const odd  = parseFloat(oc.price);
          if (!lines[line]) lines[line] = { over: [], under: [] };
          if (side === "over" || side === "under")
            lines[line][side].push({ book: name, bookKey: bk.key, odd });
        }
      }
    }

    for (const [line, sides] of Object.entries(lines)) {
      if (!sides.over.length || !sides.under.length) continue;
      const bO = sides.over.reduce((a, b)  => a.odd > b.odd ? a : b);
      const bU = sides.under.reduce((a, b) => a.odd > b.odd ? a : b);
      if (bO.bookKey === bU.bookKey) continue;

      const sum = 1 / bO.odd + 1 / bU.odd;
      if (sum >= 1.0) continue;
      const profitPct = ((1 - sum) * 100).toFixed(2);
      if (parseFloat(profitPct) < MIN_PROFIT_PCT) continue;

      arbs.push(buildArb({ game, line, over: bO, under: bU, sum, profitPct }));
    }
  }
  return arbs;
}

// ════════════════════════════════════════════════════════════
//  ARB DETECTION — 22Bet vs Odds API books
// ════════════════════════════════════════════════════════════
function find22BetArbs(apiGames, bet22Games) {
  const arbs = [];
  for (const ag of apiGames) {
    const m22 = bet22Games.find(g => teamsMatch(ag.home_team, ag.away_team, g.home_team, g.away_team));
    if (!m22) continue;

    // Build line map from Odds API
    const apiLines = {};
    for (const bk of (ag.bookmakers || [])) {
      const name = BOOKS[bk.key];
      if (!name) continue;
      for (const mkt of (bk.markets || [])) {
        if (mkt.key !== "totals") continue;
        for (const oc of (mkt.outcomes || [])) {
          const line = String(oc.point);
          const side = oc.name.toLowerCase();
          const odd  = parseFloat(oc.price);
          if (!apiLines[line]) apiLines[line] = { over: [], under: [] };
          if (side === "over" || side === "under")
            apiLines[line][side].push({ book: name, bookKey: bk.key, odd });
        }
      }
    }

    // Compare each 22Bet line against Odds API lines
    for (const [line, sides22] of Object.entries(m22.markets)) {
      const al = apiLines[line];
      if (!al) continue;

      // 22Bet OVER vs API UNDER
      if (al.under.length && sides22.over) {
        const best = al.under.reduce((a, b) => a.odd > b.odd ? a : b);
        const over = { book: "22Bet 🇰🇪", bookKey: "22bet", odd: sides22.over };
        tryPushArb({ game: ag, m22, line, over, under: best, arbs });
      }
      // API OVER vs 22Bet UNDER
      if (al.over.length && sides22.under) {
        const best = al.over.reduce((a, b) => a.odd > b.odd ? a : b);
        const under = { book: "22Bet 🇰🇪", bookKey: "22bet", odd: sides22.under };
        tryPushArb({ game: ag, m22, line, over: best, under, arbs });
      }
    }
  }
  return arbs;
}

function tryPushArb({ game, m22, line, over, under, arbs }) {
  const sum = 1 / over.odd + 1 / under.odd;
  if (sum >= 1.0) return;
  const profitPct = ((1 - sum) * 100).toFixed(2);
  if (parseFloat(profitPct) < MIN_PROFIT_PCT) return;
  // Merge live context from 22Bet
  const merged = { ...game, score: m22.score, matchMinute: m22.matchMinute, league: game.league || m22.league };
  arbs.push(buildArb({ game: merged, line, over, under, sum, profitPct }));
}

function buildArb({ game, line, over, under, sum, profitPct }) {
  return {
    match:       `${game.home_team} vs ${game.away_team}`,
    league:      game.league || game.sport_key || "",
    line, profitPct,
    profit:      (STAKE / sum - STAKE).toFixed(2),
    totalReturn: (STAKE / sum).toFixed(2),
    margin:      (sum * 100).toFixed(2),
    over:        { ...over,  stake: ((STAKE / sum) / over.odd).toFixed(2) },
    under:       { ...under, stake: ((STAKE / sum) / under.odd).toFixed(2) },
    score:       game.score || null,
    matchMinute: game.matchMinute || null,
  };
}

// ════════════════════════════════════════════════════════════
//  FORMAT ALERT
// ════════════════════════════════════════════════════════════
function formatAlert(arb, rank, total) {
  const t = nowKE();
  const ctx = [
    arb.score       ? `📊 Score: <b>${arb.score}</b>` : null,
    arb.matchMinute ? `⏱ Minute: <b>${arb.matchMinute}'</b>` : null,
  ].filter(Boolean).join("   ");

  return [
    `🚨 <b>LIVE ARB — ${arb.profitPct}% Edge</b>  [${rank}/${total}]`,
    `🔴 LIVE | ${t}`,
    ``,
    arb.league ? `🏆 <b>${arb.league}</b>` : null,
    `⚽ <b>${arb.match}</b>`,
    ctx || null,
    `📌 <b>Goals O/U | Line: ${arb.line}</b>`,
    ``,
    `💰 Profit: <b>${arb.profitPct}%</b>`,
    `✅ Guaranteed profit: <b>KES ${arb.profit}</b>`,
    `📈 Total return: <b>KES ${arb.totalReturn}</b> (stake: KES ${STAKE})`,
    ``,
    `📋 <b>Place these 2 bets NOW:</b>`,
    ``,
    `  🔼 <b>Over ${arb.line}</b>`,
    `     📍 <b>${arb.over.book}</b>`,
    `     Odd: <b>${arb.over.odd}</b>  |  Stake: <b>KES ${arb.over.stake}</b>`,
    ``,
    `  🔽 <b>Under ${arb.line}</b>`,
    `     📍 <b>${arb.under.book}</b>`,
    `     Odd: <b>${arb.under.odd}</b>  |  Stake: <b>KES ${arb.under.stake}</b>`,
    ``,
    `📉 Margin: ${arb.margin}%`,
    `⚡ <b>Place BOTH bets immediately — odds change fast!</b>`,
  ].filter(l => l !== null).join("\n");
}

// ════════════════════════════════════════════════════════════
//  MAIN
// ════════════════════════════════════════════════════════════
async function main() {
  const t = nowKE();
  console.log("=".repeat(62));
  console.log(`  LIVE ARB BOT v3 — Kenya | ${t}`);
  console.log(`  Sources: Odds API (1xBet/Betway/etc) + 22Bet direct`);
  console.log(`  Stake: KES ${STAKE} | Min profit: ${MIN_PROFIT_PCT}%`);
  console.log("=".repeat(62));

  if (!ODDS_API_KEY) {
    await sendTelegram(
      "❌ <b>Missing ODDS_API_KEY secret!</b>\n\n" +
      "Get a free key at: https://the-odds-api.com\n" +
      "Then add it to GitHub → Settings → Secrets → ODDS_API_KEY"
    );
    return;
  }

  // ── 1. Fetch 22Bet live (direct scrape) ───────────────────
  console.log("\n[STEP 1] Scraping 22Bet live...");
  const bet22Live = await fetch22BetLive();

  // ── 2. Fetch live odds from Odds API ──────────────────────
  console.log("\n[STEP 2] Fetching live odds via Odds API...");
  let apiGames = [];
  let requestsUsed = 0;

  for (const sport of LIVE_SPORTS) {
    const games = await fetchLiveOdds(sport);
    apiGames = apiGames.concat(games);
    requestsUsed++;
    await sleep(200);
    // Stop at 15 requests to conserve free tier quota
    if (requestsUsed >= 15) break;
  }

  const apiLiveCount = apiGames.filter(g => g.bookmakers?.length > 0).length;
  console.log(`\n[ODDS API] ${apiLiveCount} live games with odds`);
  console.log(`[22BET]    ${bet22Live.length} live games`);

  // ── 3. Find arbs ──────────────────────────────────────────
  console.log("\n[STEP 3] Scanning for arbs...");
  const apiArbs    = findAPIArbs(apiGames);
  const cross22Arbs = find22BetArbs(apiGames, bet22Live);

  const allArbs = [...apiArbs, ...cross22Arbs]
    .sort((a, b) => parseFloat(b.profitPct) - parseFloat(a.profitPct));

  console.log(`\n  Odds API arbs:  ${apiArbs.length}`);
  console.log(`  22Bet cross:    ${cross22Arbs.length}`);
  console.log(`  TOTAL:          ${allArbs.length}`);

  // ── 4. Send alerts ────────────────────────────────────────
  if (allArbs.length === 0) {
    await sendTelegram(
      `🔴 <b>Live Scan</b> | ${t}\n\n` +
      `📡 Odds API live games: <b>${apiLiveCount}</b>\n` +
      `📡 22Bet live games: <b>${bet22Live.length}</b>\n\n` +
      `❌ No live arbs right now\n` +
      `Next scan in 1 min...`
    );
  } else {
    const toSend = allArbs.slice(0, 5);
    for (let i = 0; i < toSend.length; i++) {
      await sendTelegram(formatAlert(toSend[i], i + 1, allArbs.length));
      await sleep(1200);
    }
    await sendTelegram(
      `✅ <b>${allArbs.length} LIVE arb(s) found!</b> | ${t}\n\n` +
      allArbs.slice(0, 5).map((a, i) =>
        `${i+1}. <b>${a.match}</b> — <b>${a.profitPct}%</b>\n` +
        `   O/U ${a.line} | ${a.over.book} vs ${a.under.book}`
      ).join("\n") +
      `\n\n⚡ Place bets IMMEDIATELY — live odds expire in seconds!`
    );
  }
}

main().catch(async err => {
  console.error("FATAL:", err.message);
  try { await sendTelegram(`❌ <b>Bot crashed:</b> ${err.message}`); } catch (_) {}
  process.exit(1);
});
