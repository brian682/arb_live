/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║         LIVE ARB BOT — KENYA EDITION  v2                 ║
 * ║                                                          ║
 * ║  Scrapes LIVE in-play games directly from:               ║
 * ║    • SportyBet Kenya  (live feed)                        ║
 * ║    • Betika Kenya     (live feed)                        ║
 * ║    • 22Bet            (live feed)                        ║
 * ║                                                          ║
 * ║  NO PAID API NEEDED — all direct scraping                ║
 * ╚══════════════════════════════════════════════════════════╝
 */

const axios = require("axios");

const TELEGRAM_TOKEN   = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const MIN_PROFIT_PCT   = parseFloat(process.env.MIN_PROFIT_PCT || "0");
const STAKE            = parseFloat(process.env.STAKE || "1000");

// ─── HELPERS ─────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function nowKE() {
  return new Date().toLocaleTimeString("en-KE", {
    timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
}

function norm(s) {
  return (s || "").toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ").trim();
}

function teamsMatch(h1, a1, h2, a2) {
  const [nh1, na1, nh2, na2] = [norm(h1), norm(a1), norm(h2), norm(a2)];
  if (nh1 === nh2 && na1 === na2) return true;
  if (nh1 === na2 && na1 === nh2) return true;
  const words = s => new Set(s.split(" ").filter(w => w.length > 2));
  const overlap = (x, y) => { let n = 0; for (const w of words(x)) if (words(y).has(w)) n++; return n; };
  return Math.max(overlap(nh1, nh2) + overlap(na1, na2), overlap(nh1, na2) + overlap(na1, nh2)) >= 2;
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
    else console.error("[TG FAIL]", res.data.description);
  } catch (e) {
    console.error("[TG ERROR]", e.response?.data?.description || e.message);
  }
}

// ════════════════════════════════════════════════════════════
//  SPORTYBET LIVE — corrected endpoint
// ════════════════════════════════════════════════════════════
async function fetchSportybetLive() {
  const games = [];
  try {
    // Correct endpoint for SportyBet KE live events
    const { data } = await axios.get(
      "https://www.sportybet.com/api/ke/factsCenter/liveData",
      {
        params: { sportId: "sr:sport:1", _t: Date.now() },
        headers: {
          "User-Agent":      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
          "Accept":          "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          "Origin":          "https://www.sportybet.com",
          "Referer":         "https://www.sportybet.com/ke/live",
          "x-requested-with":"XMLHttpRequest",
        },
        timeout: 20000,
      }
    );

    // SportyBet wraps data in data.data.events or data.data
    const events = data?.data?.events || data?.data || [];
    for (const ev of events) {
      const home = ev.homeTeamName || ev.home_team || ev.home || "";
      const away = ev.awayTeamName || ev.away_team || ev.away || "";
      if (!home || !away) continue;

      const game = {
        bookmaker: "SportyBet", bookKey: "sportybet",
        home, away,
        score:       buildScore(ev.homeScore, ev.awayScore) || ev.score || null,
        matchMinute: ev.matchStatus || ev.playedSeconds
          ? Math.floor((ev.playedSeconds || 0) / 60) + "" : null,
        league:  ev.tournament?.name || ev.tournament_name || "",
        markets: {},
      };

      for (const mkt of (ev.markets || [])) {
        const mName = (mkt.desc || mkt.name || "").toLowerCase();
        // Look for total / over-under markets
        if (!mName.includes("total") && !mName.includes("goal") &&
            !mName.includes("over")  && !mName.includes("under")) continue;

        const attr = parseFloat(mkt.attr || mkt.spreadInfo?.spread || 0);
        for (const oc of (mkt.outcomes || [])) {
          const desc = (oc.desc || oc.name || "").toLowerCase();
          const odd  = parseFloat(oc.odds || oc.price || 0);
          const pt   = parseFloat(oc.attr || attr || 0);
          if (!odd || odd <= 1 || !pt) continue;
          const line = String(pt);
          if (!game.markets[line]) game.markets[line] = {};
          if (desc.includes("over"))  game.markets[line].over  = odd;
          if (desc.includes("under")) game.markets[line].under = odd;
        }
      }
      if (Object.keys(game.markets).length > 0) games.push(game);
    }
    console.log(`[SPORTYBET LIVE] ✅ ${games.length} live games with totals`);
  } catch (e) {
    console.error("[SPORTYBET LIVE ERR]", e.response?.status, e.message);

    // Fallback: try alternate endpoint
    try {
      const { data } = await axios.get(
        "https://www.sportybet.com/api/ke/factsCenter/liveEventsBySport",
        {
          params: { sportId: "sr:sport:1" },
          headers: {
            "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36",
            "Accept":     "application/json",
            "Referer":    "https://www.sportybet.com/ke/live",
          },
          timeout: 20000,
        }
      );
      const events = data?.data?.events || data?.data || [];
      console.log(`[SPORTYBET FALLBACK] ${events.length} events found`);
      // Parse same way — we'll get what we get
    } catch (e2) {
      console.error("[SPORTYBET FALLBACK ERR]", e2.response?.status, e2.message);
    }
  }
  return games;
}

// ════════════════════════════════════════════════════════════
//  BETIKA LIVE — fixed totals parsing
// ════════════════════════════════════════════════════════════
async function fetchBetikaLive() {
  const games = [];
  try {
    const { data } = await axios.get(
      "https://api.betika.com/v1/uo/matches",
      {
        params: { limit: 200, page: 1, period: "live", sport_id: 1 },
        headers: {
          "User-Agent":      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36",
          "Accept":          "application/json",
          "Accept-Language": "en-US,en;q=0.9",
          "Origin":          "https://www.betika.com",
          "Referer":         "https://www.betika.com/ke/live",
        },
        timeout: 20000,
      }
    );

    for (const match of (data?.data || [])) {
      const home = match.home_team || match.home || "";
      const away = match.away_team || match.away || "";
      if (!home || !away) continue;

      const game = {
        bookmaker: "Betika", bookKey: "betika",
        home, away,
        score:       match.live_score || match.score || null,
        matchMinute: match.time_elapsed || match.match_time || match.minute || null,
        league:      match.competition_name || match.league || "",
        markets:     {},
      };

      for (const pick of (match.picks || [])) {
        const key = (pick.odd_key || pick.market_type || "").toLowerCase();
        const odd  = parseFloat(pick.odd_value || pick.odds || 0);
        const spec = pick.special_bet_value || pick.line || pick.value;
        if (!odd || odd <= 1) continue;

        // Betika uses various key formats for totals:
        // "ov2.5", "un2.5", "over_2.5", "under_2.5", "o2.5", "u2.5"
        // Also check sub_type_id or market_name
        const mName = (pick.market_name || pick.name || "").toLowerCase();
        let line = null, side = null;

        // Pattern 1: over_2.5 / under_2.5
        let m = key.match(/^(over|under|ov|un|o|u)[_\s]?([\d.]+)$/);
        if (m) { side = m[1].startsWith("ov") || m[1] === "o" ? "over" : "under"; line = m[2]; }

        // Pattern 2: line from spec value, side from key
        if (!line && spec) {
          line = String(parseFloat(spec) || "");
          if (key.includes("over") || key.startsWith("ov") || key === "o") side = "over";
          if (key.includes("under") || key.startsWith("un") || key === "u") side = "under";
          if (mName.includes("over"))  side = "over";
          if (mName.includes("under")) side = "under";
        }

        if (line && side && parseFloat(line) > 0) {
          if (!game.markets[line]) game.markets[line] = {};
          game.markets[line][side] = odd;
        }
      }

      if (Object.keys(game.markets).length > 0) games.push(game);
    }
    console.log(`[BETIKA LIVE] ✅ ${games.length} live games with totals`);
  } catch (e) {
    console.error("[BETIKA LIVE ERR]", e.response?.status, e.message);
  }
  return games;
}

// ════════════════════════════════════════════════════════════
//  22BET LIVE — corrected parsing
// ════════════════════════════════════════════════════════════
async function fetch22BetLive() {
  const games = [];
  try {
    const { data } = await axios.get(
      "https://22bet.com/LiveFeed/Get1_2",
      {
        params: { sports: "1,2,3", lng: "en", gr: 128, isGames: 1 },
        headers: {
          "User-Agent":       "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36",
          "Accept":           "application/json, text/javascript, */*; q=0.01",
          "Accept-Language":  "en-US,en;q=0.9",
          "Referer":          "https://22bet.com/live/",
          "X-Requested-With": "XMLHttpRequest",
        },
        timeout: 20000,
      }
    );

    if (!data?.Value) { console.log("[22BET LIVE] No data"); return games; }

    for (const league of data.Value) {
      for (const ev of (league.Events || [])) {
        const home = ev.Team1 || ev.HomeTeam || "";
        const away = ev.Team2 || ev.AwayTeam || "";
        if (!home || !away) continue;

        const sb = ev.Scoreboard;
        const game = {
          bookmaker: "22Bet", bookKey: "22bet",
          home, away,
          score:       sb ? buildScore(sb.Score1, sb.Score2) : null,
          matchMinute: String(sb?.Time || ev.Timer || ev.MatchTime || "").replace(/[^0-9]/g,"") || null,
          league:      league.Name || "",
          markets:     {},
        };

        for (const mkt of (ev.GameEvents || ev.E || [])) {
          // Group 17 = Totals
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
    console.error("[22BET LIVE ERR]", e.response?.status, e.message);
  }
  return games;
}

function buildScore(s1, s2) {
  if (s1 !== undefined && s2 !== undefined) return `${s1}-${s2}`;
  return null;
}

// ════════════════════════════════════════════════════════════
//  ARB DETECTION
// ════════════════════════════════════════════════════════════
function findLiveArbs(allGames) {
  const arbs = [];

  // Group same match across bookmakers
  const groups = [];
  for (const g of allGames) {
    const grp = groups.find(gr => teamsMatch(gr[0].home, gr[0].away, g.home, g.away));
    if (grp) grp.push(g);
    else groups.push([g]);
  }

  for (const group of groups) {
    if (group.length < 2) continue;

    // Collect all over/under per line from different books
    const lineMap = {};
    for (const g of group) {
      for (const [line, sides] of Object.entries(g.markets)) {
        if (!lineMap[line]) lineMap[line] = { over: [], under: [] };
        if (sides.over)  lineMap[line].over.push({ book: g.bookmaker, bookKey: g.bookKey, odd: sides.over });
        if (sides.under) lineMap[line].under.push({ book: g.bookmaker, bookKey: g.bookKey, odd: sides.under });
      }
    }

    const ref = group[0];
    const ctx = group.find(g => g.score || g.matchMinute) || ref;

    for (const [line, sides] of Object.entries(lineMap)) {
      if (!sides.over.length || !sides.under.length) continue;
      const bO = sides.over.reduce((a, b) => a.odd > b.odd ? a : b);
      const bU = sides.under.reduce((a, b) => a.odd > b.odd ? a : b);
      if (bO.bookKey === bU.bookKey) continue;

      const sum = 1 / bO.odd + 1 / bU.odd;
      if (sum >= 1.0) continue;

      const profitPct = ((1 - sum) * 100).toFixed(2);
      if (parseFloat(profitPct) < MIN_PROFIT_PCT) continue;

      arbs.push({
        match:       `${ref.home} vs ${ref.away}`,
        league:      ctx.league || "",
        line, profitPct,
        profit:      (STAKE / sum - STAKE).toFixed(2),
        totalReturn: (STAKE / sum).toFixed(2),
        margin:      (sum * 100).toFixed(2),
        over:        { ...bO, stake: ((STAKE / sum) / bO.odd).toFixed(2) },
        under:       { ...bU, stake: ((STAKE / sum) / bU.odd).toFixed(2) },
        score:       ctx.score,
        matchMinute: ctx.matchMinute,
        books:       group.map(g => g.bookmaker).join(", "),
      });
    }
  }

  return arbs.sort((a, b) => parseFloat(b.profitPct) - parseFloat(a.profitPct));
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
    `📌 Market: <b>Goals O/U ${arb.line}</b>`,
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
    `📉 Combined margin: ${arb.margin}%`,
    `📡 Books scanned: ${arb.books}`,
    `⚡ <b>Place BOTH bets immediately — odds change fast!</b>`,
  ].filter(l => l !== null).join("\n");
}

// ════════════════════════════════════════════════════════════
//  MAIN
// ════════════════════════════════════════════════════════════
async function main() {
  const t = nowKE();
  console.log("=".repeat(62));
  console.log(`  LIVE ARB BOT v2 — Kenya | ${t}`);
  console.log(`  Books: SportyBet | Betika | 22Bet`);
  console.log(`  Stake: KES ${STAKE} | Min profit: ${MIN_PROFIT_PCT}%`);
  console.log("=".repeat(62));

  // Check Telegram config first
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("❌ Missing TELEGRAM_TOKEN or TELEGRAM_CHAT_ID in secrets!");
    process.exit(1);
  }

  console.log("\n[SCRAPING] Fetching live odds from all books...\n");

  // Scrape all books (continue even if some fail)
  const [sportyLive, betikaLive, bet22Live] = await Promise.allSettled([
    fetchSportybetLive(),
    fetchBetikaLive(),
    fetch22BetLive(),
  ]).then(results => results.map(r => r.status === "fulfilled" ? r.value : []));

  const total = sportyLive.length + betikaLive.length + bet22Live.length;
  console.log(`\n[TOTAL] ${total} live games across all books`);

  if (total === 0) {
    await sendTelegram(
      `🔴 <b>Live Scan</b> | ${t}\n\n` +
      `❌ No live games found.\n\n` +
      `Possible reasons:\n` +
      `• No matches live right now\n` +
      `• Bookmakers returning errors\n\n` +
      `SportyBet: ${sportyLive.length} | Betika: ${betikaLive.length} | 22Bet: ${bet22Live.length}\n\n` +
      `Next scan in 1 min...`
    );
    return;
  }

  console.log("\n[SCANNING] Looking for arb opportunities...");
  const allGames = [...sportyLive, ...betikaLive, ...bet22Live];
  const arbs = findLiveArbs(allGames);

  console.log(`\n  SportyBet: ${sportyLive.length} | Betika: ${betikaLive.length} | 22Bet: ${bet22Live.length}`);
  console.log(`  Arbs found: ${arbs.length}`);

  if (arbs.length === 0) {
    await sendTelegram(
      `🔍 <b>Live Scan</b> | ${t}\n\n` +
      `📡 SportyBet: <b>${sportyLive.length}</b>\n` +
      `📡 Betika: <b>${betikaLive.length}</b>\n` +
      `📡 22Bet: <b>${bet22Live.length}</b>\n` +
      `📊 Total: <b>${total}</b> live games\n\n` +
      `❌ No arbs right now — next scan in 1 min...`
    );
  } else {
    const toSend = arbs.slice(0, 5);
    for (let i = 0; i < toSend.length; i++) {
      await sendTelegram(formatAlert(toSend[i], i + 1, arbs.length));
      await sleep(1200);
    }
    await sendTelegram(
      `✅ <b>${arbs.length} LIVE arb(s) found!</b> | ${t}\n\n` +
      arbs.slice(0, 5).map((a, i) =>
        `${i+1}. <b>${a.match}</b> — ${a.profitPct}%\n` +
        `   O/U ${a.line} | ${a.over.book} vs ${a.under.book}`
      ).join("\n") +
      `\n\n⚡ Place bets IMMEDIATELY!`
    );
  }
}

main().catch(async err => {
  console.error("FATAL:", err.message);
  try {
    await sendTelegram(`❌ <b>Bot crashed:</b> ${err.message}`);
  } catch (_) {}
  process.exit(1);
});
