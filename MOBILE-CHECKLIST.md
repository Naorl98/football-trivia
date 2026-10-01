# Manual mobile checklist

Ten minutes on a real iPhone. For each step: what to do, and what should
happen. Anything else is worth reporting.

**If you ever see a dark screen again**, do not reload immediately. Wait about
ten seconds. A recovery screen should appear with a short code at the bottom
(`קוד: STAGE / REASON / VENDOR`). That code says which stage startup reached and
why the screen appeared — send it, and it identifies the mechanism without
needing to reproduce it.

---

### 1. Fresh tab
Open a new tab → `football-iq.naorl.workers.dev`

**Expect:** a dark screen with a spinning ball and "טוען את Football IQ…" for a
moment, then the home page. The headline animates up **once**.
**Not:** a white page, a dark page with nothing on it, or a ball that keeps
spinning for more than ten seconds.

### 2. Reload
Pull to refresh, twice.

**Expect:** the same thing each time. The loading shell may be too quick to see.

### 3. Close and reopen the browser
Close Safari completely (swipe it away), reopen, go back to the tab.

**Expect:** either the page as you left it, or a fresh load. Both are fine.
**Not:** a dark or white screen that stays. This is the case that used to fail —
a tab restored from before a deployment. It should now reload itself once,
automatically, and land on a working page.

### 4. Wi-Fi → cellular, mid-session
On the home page, turn Wi-Fi off so it drops to cellular. Wait five seconds.

**Expect:** nothing visible happens. The home page needs no network once loaded —
it makes no API calls at all.

### 5. Cellular → Wi-Fi
Turn Wi-Fi back on.

**Expect:** again nothing visible. Then tap "התחל משחק" and confirm the builder
loads and shows a question count.

### 6. Background and foreground
Home page open → switch to another app for about thirty seconds → come back.

**Expect:** the page exactly as you left it, immediately usable. No re-animation
of the headline, no reload, no dark screen.

### 7. In-app browser
Send yourself the link in WhatsApp or post it to your own Instagram story, and
open it from inside that app.

**Expect:** the same as step 1. This is the environment the original report came
from, so it is the most important one. Scroll, then tap "התחל משחק".

### 8. Play a quiz
Quick-start tile → pick an answer mode → answer two or three questions.

**Expect:** a brief "שריקת פתיחה" overlay, then the board. Options are tappable,
the score updates, the explanation appears after answering.
**Not:** a dark overlay that stays on top of the question.

### 9. Mid-quiz reload
While on a question, pull to refresh.

**Expect:** the same question again, with your progress intact.

### 10. Return home
Finish or leave the quiz, then go back to the home page.

**Expect:** the home page, headline animating once.

### 11. Multiplayer, and back
"משחק עם חברים" → open a room → note the six-digit code → go back home.

**Expect:** the room shows a code and a lobby. Coming back home leaves no socket
running and no banner. If the connection drops you should see "מתחברים
מחדש…" and then it should recover; if it keeps failing for about twenty seconds
it changes to "לא מצליחים להתחבר למשחק" with a refresh button — that wording
means the phone cannot reach the room, not that the game is broken.

### 12. Airplane mode during a room
In a room, turn airplane mode on for five seconds, then off.

**Expect:** "מתחברים מחדש…" then back to the lobby with your seat and score.

---

## What should never happen

- A white page.
- A dark page with no content and no recovery screen after ten seconds.
- The headline animating repeatedly, or text flickering.
- Content appearing and then disappearing.
- A loading ball spinning for more than about ten seconds.

If any of those happen, note which step you were on and the code on the recovery
screen if one appeared.
