/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║         LIVE ARB BOT — KENYA EDITION                     ║
 * ║                                                          ║
 * ║  Scrapes LIVE in-play games directly from:               ║
 * ║    • SportyBet Kenya  (live feed)                        ║
 * ║    • Betika Kenya     (live feed)                        ║
 * ║    • 22Bet            (live feed)                        ║
 * ║    • Odibets Kenya    (live feed)                        ║
 * ║                                                          ║
 * ║  Finds arbs across books in real time                    ║
 * ║  Sends Telegram alert with score + match minute          ║
 * ║  Runs every 1 minute FREE on GitHub Actions              ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * NO PAID API KEY NEEDED — all direct scraping
 */

const axios = require("axios");

// ─── ENV ────────────────────────────────────────────────────
const TELEGRAM_TOKEN   = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const MIN_PROFIT_PCT   = parseFloat(process.env.MIN_PROFIT_PCT || "0");
const STAKE            = parseFloat(process.env.STAKE || "1000");

// ─── HELPERS ─────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function now() {
  return new Date().toLocaleTimeString("en-KE", {
    timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
}

function norm(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Fuzzy team name matching across bookmakers
function teamsMatch(homeA, awayA, homeB, awayB) {
  const ha = norm(homeA), aa = norm(awayA), hb = norm(homeB), ab = norm(awayB);
  if (ha === hb && aa === ab) return true;
  if (ha === ab && aa === hb) return true;

  const words = s => new Set(s.split(" ").filter(w => w.length > 2));
  const overlap = (x, y) => { let n = 0; for (const w of words(x)) if (words(y).has(w)) n++; return n; };
  const fwd = overlap(ha, hb) + overlap(aa, ab);
  const rev = overlap(ha, ab) + overlap(aa, hb);
  return Math.max(fwd, rev) >= 2;
}

// ════════════════════════════════════════════════════════════
//  TELEGRAM
// ════════════════════════════════════════════════════════════
async function sendTelegram(message) {
  try {
    const res = await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      { chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: "HTML" },
      { timeout: 10000 }
    );
    if (res.data.ok) console.log(`[TG ✅] Sent`);
    else console.error("[TG FAIL]", JSON.stringify(res.data));
  } catch (e) {
    console.error("[TG ERROR]", e.response?.data || e.message);
  }
}

// ════════════════════════════════════════════════════════════
//  SPORTYBET LIVE SCRAPER
//  Endpoint: /api/ke/factsCenter/liveEvent
// ════════════════════════════════════════════════════════════
async function fetchSportybetLive() {
  const games = [];
  try {
    const { data } = await axios.get(
      "https://www.sportybet.com/api/ke/factsCenter/liveEvent",
      {
        params: { sportId: "sr:sport:1", _t: Date.now() },
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36",
          "Accept": "application/json",
          "Referer": "https://www.sportybet.com/ke/",
        },
        timeout: 15000,
      }
    );

    const events = data?.data?.events || data?.data || [];
    for (const event of events) {
      const home = event.homeTeamName || event.home || "";
      const away = event.awayTeamName || event.away || "";
      if (!home || !away) continue;

      const game = {
        bookmaker: "SportyBet",
        bookKey:   "sportybet",
        home, away,
        score:       parseScore(event),
        matchMinute: parseMinute(event),
        league:      event.tournament?.name || event.leagueName || "",
        markets:     {},
      };

      // Parse markets — Over/Under totals
      for (const market of (event.markets || [])) {
        const mName = (market.desc || market.name || "").toLowerCase();
        if (!mName.includes("total") && !mName.includes("over") && !mName.includes("under")) continue;

        for (const outcome of (market.outcomes || [])) {
          const desc = (outcome.desc || outcome.name || "").toLowerCase();
          const odd  = parseFloat(outcome.odds || outcome.price || 0);
          const pt   = parseFloat(outcome.spreadInfo?.spread || market.attr || 0);
          if (!odd || odd <= 1 || !pt) continue;

          const lineKey = String(pt);
          if (!game.markets[lineKey]) game.markets[lineKey] = {};
          if (desc.includes("over"))  game.markets[lineKey].over  = odd;
          if (desc.includes("under")) game.markets[lineKey].under = odd;
        }
      }

      if (Object.keys(game.markets).length > 0) games.push(game);
    }

    console.log(`[SPORTYBET LIVE] ${games.length} live games with totals`);
  } catch (e) {
    console.error("[SPORTYBET LIVE ERR]", e.response?.status || e.message);
  }
  return games;
}

// ════════════════════════════════════════════════════════════
//  BETIKA LIVE SCRAPER
//  Endpoint: /v1/uo/matches?period=live
// ════════════════════════════════════════════════════════════
async function fetchBetikaLive() {
  const games = [];
  try {
    const { data } = await axios.get(
      "https://api.betika.com/v1/uo/matches",
      {
        params: { limit: 200, page: 1, period: "live", sport_id: 1 },
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36",
          "Accept": "application/json",
          "Origin":  "https://www.betika.com",
          "Referer": "https://www.betika.com/",
        },
        timeout: 15000,
      }
    );

    for (const match of (data?.data || [])) {
      const home = match.home_team || "";
      const away = match.away_team || "";
      if (!home || !away) continue;

      const game = {
        bookmaker: "Betika",
        bookKey:   "betika",
        home, away,
        score:       match.live_score || match.score || null,
        matchMinute: match.match_time || match.minute || null,
        league:      match.competition_name || "",
        markets:     {},
      };

      for (const pick of (match.picks || [])) {
        const key  = (pick.odd_key || "").toLowerCase();
        const odd  = parseFloat(pick.odd_value || 0);
        if (!odd || odd <= 1) continue;

        // Betika total keys look like: "over_2.5", "under_2.5"
        const overMatch  = key.match(/^over[_\s]?([\d.]+)$/);
        const underMatch = key.match(/^under[_\s]?([\d.]+)$/);
        if (overMatch)  {
          const line = overMatch[1];
          if (!game.markets[line]) game.markets[line] = {};
          game.markets[line].over = odd;
        }
        if (underMatch) {
          const line = underMatch[1];
          if (!game.markets[line]) game.markets[line] = {};
          game.markets[line].under = odd;
        }
      }

      if (Object.keys(game.markets).length > 0) games.push(game);
    }

    console.log(`[BETIKA LIVE] ${games.length} live games with totals`);
  } catch (e) {
    console.error("[BETIKA LIVE ERR]", e.response?.status || e.message);
  }
  return games;
}

// ════════════════════════════════════════════════════════════
//  22BET LIVE SCRAPER
//  Endpoint: /LiveFeed/Get1_2
// ════════════════════════════════════════════════════════════
async function fetch22BetLive() {
  const games = [];
  try {
    const { data } = await axios.get(
      "https://22bet.com/LiveFeed/Get1_2",
      {
        params: { sports: "1,2,3", lng: "en", gr: 128, isGames: 1 },
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36",
          "Accept":           "application/json, text/javascript, */*; q=0.01",
          "Accept-Language":  "en-US,en;q=0.9",
          "Referer":          "https://22bet.com/live/",
          "X-Requested-With": "XMLHttpRequest",
        },
        timeout: 20000,
      }
    );

    if (!data?.Value) {
      console.log("[22BET LIVE] No data returned");
      return games;
    }

    for (const league of data.Value) {
      for (const event of (league.Events || [])) {
        const home = event.Team1 || event.HomeTeam || "";
        const away = event.Team2 || event.AwayTeam || "";
        if (!home || !away) continue;

        const sb = event.Scoreboard;
        const game = {
          bookmaker: "22Bet",
          bookKey:   "22bet",
          home, away,
          score:       sb ? `${sb.Score1 ?? 0}-${sb.Score2 ?? 0}` : null,
          matchMinute: String(sb?.Time || event.Timer || event.MatchTime || ""),
          league:      league.Name || "",
          markets:     {},
        };

        // Parse totals (Group 17 = Totals in 22Bet)
        for (const market of (event.GameEvents || event.E || [])) {
          if (market.G !== 17 && market.GroupId !== 17) continue;
          let overOdd = null, underOdd = null, line = null;

          for (const oc of (market.GameEventItem || market.Items || [])) {
            const name = (oc.Name || oc.N || "").toLowerCase();
            const odd  = parseFloat(oc.Price || oc.Coef || oc.C || 0);
            const pt   = parseFloat(oc.Param || oc.P || 0);
            if (!odd || odd <= 1) continue;
            if (name.includes("over")  || name === "tb" || name === "o") { overOdd  = odd; if (pt) line = String(pt); }
            if (name.includes("under") || name === "tm" || name === "u") { underOdd = odd; if (pt && !line) line = String(pt); }
          }

          if (overOdd && underOdd && line) {
            game.markets[line] = { over: overOdd, under: underOdd };
          }
        }

        if (Object.keys(game.markets).length > 0) games.push(game);
      }
    }

    console.log(`[22BET LIVE] ${games.length} live games with totals`);
  } catch (e) {
    console.error("[22BET LIVE ERR]", e.response?.status || e.message);
  }
  return games;
}

// ════════════════════════════════════════════════════════════
//  ODIBETS LIVE SCRAPER
//  Endpoint: /api/v3/games?status=live
// ════════════════════════════════════════════════════════════
async function fetchOdibetsLive() {
  const games = [];
  try {
    const { data } = await axios.get(
      "https://www.odibets.com/api/v3/games",
      {
        params: { status: "live", sport: 1, page: 1, per_page: 100 },
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36",
          "Accept":  "application/json",
          "Referer": "https://www.odibets.com/live",
        },
        timeout: 15000,
      }
    );

    const events = data?.data || data?.games || data?.results || [];
    for (const event of events) {
      const home = event.home_team || event.home || event.team1 || "";
      const away = event.away_team || event.away || event.team2 || "";
      if (!home || !away) continue;

      const game = {
        bookmaker: "Odibets",
        bookKey:   "odibets",
        home, away,
        score:       event.score || event.live_score || null,
        matchMinute: event.minute || event.match_time || null,
        league:      event.league || event.competition || "",
        markets:     {},
      };

      const outcomes = event.outcomes || event.markets || event.picks || [];
      for (const oc of outcomes) {
        const name = (oc.name || oc.desc || oc.odd_key || "").toLowerCase();
        const odd  = parseFloat(oc.odd || oc.price || oc.odds || oc.odd_value || 0);
        const pt   = parseFloat(oc.line || oc.point || oc.total || 0);
        if (!odd || odd <= 1 || !pt) continue;
        const line = String(pt);
        if (!game.markets[line]) game.markets[line] = {};
        if (name.includes("over"))  game.markets[line].over  = odd;
        if (name.includes("under")) game.markets[line].under = odd;
      }

      if (Object.keys(game.markets).length > 0) games.push(game);
    }

    console.log(`[ODIBETS LIVE] ${games.length} live games with totals`);
  } catch (e) {
    console.error("[ODIBETS LIVE ERR]", e.response?.status || e.message);
  }
  return games;
}

// ════════════════════════════════════════════════════════════
//  SCORE + MINUTE PARSERS
// ════════════════════════════════════════════════════════════
function parseScore(event) {
  try {
    if (event.homeScore !== undefined && event.awayScore !== undefined)
      return `${event.homeScore}-${event.awayScore}`;
    if (event.score) return String(event.score);
    if (event.setScore) return String(event.setScore);
  } catch (_) {}
  return null;
}

function parseMinute(event) {
  try {
    if (event.matchStatus) return String(event.matchStatus);
    if (event.playedTime)  return String(event.playedTime);
    if (event.clock?.matchTime) return String(event.clock.matchTime);
  } catch (_) {}
  return null;
}

// ════════════════════════════════════════════════════════════
//  ARB DETECTION — cross-bookmaker live
// ════════════════════════════════════════════════════════════
function findLiveArbs(allGames) {
  const arbs = [];

  // Group games by match (across all bookmakers)
  const matchGroups = [];

  for (let i = 0; i < allGames.length; i++) {
    const g = allGames[i];
    let found = false;

    for (const group of matchGroups) {
      const ref = group[0];
      if (teamsMatch(ref.home, ref.away, g.home, g.away)) {
        group.push(g);
        found = true;
        break;
      }
    }
    if (!found) matchGroups.push([g]);
  }

  // For each match group, find arbs across bookmakers
  for (const group of matchGroups) {
    if (group.length < 2) continue; // need at least 2 bookmakers

    const ref = group[0];
    const matchName = `${ref.home} vs ${ref.away}`;

    // Collect all Over/Under odds per line across all books in the group
    const lineMap = {};
    for (const g of group) {
      for (const [line, sides] of Object.entries(g.markets)) {
        if (!lineMap[line]) lineMap[line] = { over: [], under: [] };
        if (sides.over)  lineMap[line].over.push({ book: g.bookmaker, bookKey: g.bookKey, odd: sides.over });
        if (sides.under) lineMap[line].under.push({ book: g.bookmaker, bookKey: g.bookKey, odd: sides.under });
      }
    }

    // Find best Over + best Under from DIFFERENT bookmakers
    for (const [line, sides] of Object.entries(lineMap)) {
      if (!sides.over.length || !sides.under.length) continue;

      const bestOver  = sides.over.reduce((a, b) => a.odd > b.odd ? a : b);
      const bestUnder = sides.under.reduce((a, b) => a.odd > b.odd ? a : b);

      // Must be different bookmakers
      if (bestOver.bookKey === bestUnder.bookKey) continue;

      const sum = 1 / bestOver.odd + 1 / bestUnder.odd;
      if (sum >= 1.0) continue;

      const profitPct = ((1 - sum) * 100).toFixed(2);
      if (parseFloat(profitPct) < MIN_PROFIT_PCT) continue;

      // Get live context from whichever book has it
      const liveCtx = group.find(g => g.score || g.matchMinute) || group[0];

      arbs.push({
        match:       matchName,
        home:        ref.home,
        away:        ref.away,
        league:      ref.league || liveCtx.league || "",
        line,
        profitPct,
        profit:      (STAKE / sum - STAKE).toFixed(2),
        totalReturn: (STAKE / sum).toFixed(2),
        margin:      (sum * 100).toFixed(2),
        over:        { ...bestOver,  stake: ((STAKE / sum) / bestOver.odd).toFixed(2) },
        under:       { ...bestUnder, stake: ((STAKE / sum) / bestUnder.odd).toFixed(2) },
        score:       liveCtx.score,
        matchMinute: liveCtx.matchMinute,
        booksInGroup: group.map(g => g.bookmaker),
      });
    }
  }

  // Sort by profit % descending
  return arbs.sort((a, b) => parseFloat(b.profitPct) - parseFloat(a.profitPct));
}

// ════════════════════════════════════════════════════════════
//  FORMAT LIVE ALERT
// ════════════════════════════════════════════════════════════
function formatLiveAlert(arb, rank, total) {
  const t = now();
  const scoreLine  = arb.score       ? `📊 Score: <b>${arb.score}</b>` : null;
  const minuteLine = arb.matchMinute ? `⏱ Minute: <b>${arb.matchMinute}'</b>` : null;
  const ctx        = [scoreLine, minuteLine].filter(Boolean).join("   ");

  return [
    `🚨 <b>LIVE ARB FOUND — ${arb.profitPct}% Edge</b>  [${rank}/${total}]`,
    `🔴 LIVE | ${t}`,
    ``,
    arb.league ? `🏆 <b>${arb.league}</b>` : null,
    `⚽ <b>${arb.match}</b>`,
    ctx || null,
    `📌 Market: <b>Goals O/U | Line: ${arb.line}</b>`,
    ``,
    `💰 Profit: <b>${arb.profitPct}%</b>`,
    `✅ Guaranteed profit: <b>KES ${arb.profit}</b>`,
    `📈 Total return: <b>KES ${arb.totalReturn}</b> (on KES ${STAKE})`,
    ``,
    `📋 <b>Place these 2 bets RIGHT NOW:</b>`,
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
    `📡 Books compared: ${arb.booksInGroup.join(", ")}`,
    `⚡ <b>LIVE odds change every second — place bets NOW!</b>`,
  ].filter(l => l !== null).join("\n");
}

// ════════════════════════════════════════════════════════════
//  MAIN
// ════════════════════════════════════════════════════════════
async function main() {
  const t = now();
  console.log("=".repeat(62));
  console.log(`  LIVE ARB BOT — Kenya Edition | ${t}`);
  console.log(`  Books: SportyBet | Betika | 22Bet | Odibets`);
  console.log(`  Stake: KES ${STAKE} | Min profit: ${MIN_PROFIT_PCT}%`);
  console.log("=".repeat(62));

  // ── Scrape all bookmakers in parallel ─────────────────────
  console.log("\n[SCRAPING] Fetching live odds from all books...\n");
  const [sportyLive, betikaLive, bet22Live, odiLive] = await Promise.allSettled([
    fetchSportybetLive(),
    fetchBetikaLive(),
    fetch22BetLive(),
    fetchOdibetsLive(),
  ]).then(results => results.map(r => r.status === "fulfilled" ? r.value : []));

  const totalGames = sportyLive.length + betikaLive.length + bet22Live.length + odiLive.length;
  console.log(`\n[TOTAL] ${totalGames} live games across all books`);

  if (totalGames === 0) {
    await sendTelegram(
      `🔴 <b>Live Scan</b> | ${t}\n\n` +
      `⚠️ No live games found from any bookmaker.\n` +
      `This could mean:\n` +
      `  • No matches currently live\n` +
      `  • Bookmakers blocking requests\n\n` +
      `Next scan in 1 min...`
    );
    return;
  }

  // ── Combine all games ──────────────────────────────────────
  const allGames = [
    ...sportyLive,
    ...betikaLive,
    ...bet22Live,
    ...odiLive,
  ];

  // ── Find arbs ──────────────────────────────────────────────
  console.log("\n[SCANNING] Looking for live arb opportunities...");
  const arbs = findLiveArbs(allGames);

  console.log(`\n  SportyBet live:  ${sportyLive.length}`);
  console.log(`  Betika live:     ${betikaLive.length}`);
  console.log(`  22Bet live:      ${bet22Live.length}`);
  console.log(`  Odibets live:    ${odiLive.length}`);
  console.log(`  ──────────────────────`);
  console.log(`  Total games:     ${totalGames}`);
  console.log(`  Arbs found:      ${arbs.length}`);

  if (arbs.length === 0) {
    await sendTelegram(
      `🔍 <b>Live Scan Complete</b> | ${t}\n\n` +
      `📡 SportyBet: <b>${sportyLive.length}</b> live games\n` +
      `📡 Betika: <b>${betikaLive.length}</b> live games\n` +
      `📡 22Bet: <b>${bet22Live.length}</b> live games\n` +
      `📡 Odibets: <b>${odiLive.length}</b> live games\n\n` +
      `❌ No live arbs found — next scan in 1 min...`
    );
  } else {
    // Send top 5 arbs
    const toSend = arbs.slice(0, 5);
    for (let i = 0; i < toSend.length; i++) {
      await sendTelegram(formatLiveAlert(toSend[i], i + 1, arbs.length));
      await sleep(1200);
    }

    // Send summary
    await sendTelegram(
      `✅ <b>${arbs.length} LIVE arb(s) found!</b> | ${t}\n\n` +
      `Top opportunities:\n` +
      arbs.slice(0, 5).map((a, i) =>
        `  ${i+1}. ${a.match} — <b>${a.profitPct}%</b>\n` +
        `     O/U ${a.line} | ${a.over.book} vs ${a.under.book}`
      ).join("\n") +
      `\n\n⚡ <b>Place bets IMMEDIATELY — live odds expire fast!</b>`
    );
  }
}

main().catch(async (err) => {
  console.error("FATAL:", err.message);
  await sendTelegram(`❌ <b>Live Bot error:</b> ${err.message}`);
  process.exit(1);
});
