# 🔴 LIVE ARB BOT — Kenya Edition

Scans **live in-play games** across Kenya bookmakers every minute.
**No paid API key needed** — scrapes directly from each bookmaker.

---

## 📡 Books Scanned

| Bookmaker | Live Feed | Markets |
|-----------|-----------|---------|
| SportyBet 🇰🇪 | Direct scrape | Over/Under totals |
| Betika 🇰🇪 | Direct scrape | Over/Under totals |
| 22Bet 🇰🇪 | Direct scrape | Over/Under totals |
| Odibets 🇰🇪 | Direct scrape | Over/Under totals |

---

## ⚡ Why Live Arbs Are Better

During a match, bookmakers update their odds at **different speeds**.
When one book is slow to update, a gap opens — e.g.:

```
SportyBet: Over 4.5 @ 3.75  ← hasn't updated yet
22Bet:    Under 4.5 @ 2.26  ← already updated
= 29% guaranteed profit
```

The bot catches these gaps the moment they appear.

---

## 🛠 SETUP

### Step 1 — Create GitHub Repo
1. Go to https://github.com → **+** → **New repository**
2. Name: `live-arb-bot` | **Private** | Create

### Step 2 — Upload Files
Upload all these files (drag & drop into GitHub):
```
index.js
package.json
.github/
  workflows/
    live-arb-bot.yml
```

### Step 3 — Add Secrets
**Settings → Secrets and variables → Actions → New repository secret**

| Secret | Value |
|--------|-------|
| `TELEGRAM_TOKEN` | Your bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Your Telegram chat ID |

> No ODDS_API_KEY needed — this bot scrapes directly!

### Step 4 — Enable & Test
1. **Actions** tab → Enable workflows
2. Click **Live Arb Bot** → **Run workflow** to test

---

## 📲 Sample Alert

```
🚨 LIVE ARB FOUND — 29.09% Edge  [1/3]
🔴 LIVE | 18:43:00

🏆 Premier League
⚽ Chelsea vs Nottingham Forest
📊 Score: 3-1   ⏱ Minute: 72'
📌 Market: Goals O/U | Line: 4.5

💰 Profit: 29.09%
✅ Guaranteed profit: KES 290.90
📈 Total return: KES 1290.90 (on KES 1000)

📋 Place these 2 bets RIGHT NOW:

  🔼 Over 4.5
     📍 SportyBet
     Odd: 3.75  |  Stake: KES 376.04

  🔽 Under 4.5
     📍 22Bet
     Odd: 2.26  |  Stake: KES 623.96

📉 Combined margin: 70.91%
📡 Books compared: SportyBet, 22Bet, Betika
⚡ LIVE odds change every second — place bets NOW!
```

---

## ⚙️ Customize

Edit `live-arb-bot.yml`:
```yaml
STAKE: "1000"         # Your total stake in KES
MIN_PROFIT_PCT: "0"   # Minimum profit % to alert
                      # Set "2" to only see 2%+ arbs
                      # Set "5" to only see 5%+ arbs
```

---

## ⚠️ Important Notes

- **Place bets within 30 seconds** — live odds move every few seconds
- Start with **KES 200–500** while learning
- A 5%+ edge is excellent for live arbs
- The bot runs every 1 minute — GitHub Actions free tier gives ~2,000 runs/month
- If a bookmaker blocks the scraper, the bot continues with the remaining books

---

## 🔄 Combine with v12

This bot focuses on **live only**. For pre-match arbs too,
use **arb-bot-v12** alongside this one (separate GitHub repo).
