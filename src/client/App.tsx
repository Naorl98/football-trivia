import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { ScrollToTop } from "./components/ScrollToTop";
import { RouteAnnouncer } from "./components/RouteAnnouncer";
import { PrivacyGate } from "./components/PrivacyGate";
import { HomePage } from "./pages/HomePage";
import { BuilderPage } from "./pages/BuilderPage";
import { QuizPage } from "./pages/QuizPage";
import { ResultsPage } from "./pages/ResultsPage";
import { ChallengePage } from "./pages/ChallengePage";
import { DailyPage } from "./pages/DailyPage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { MultiplayerPage } from "./pages/MultiplayerPage";
import { DuelSearchPage } from "./pages/DuelSearchPage";
import { RoomPage } from "./pages/RoomPage";
import { RoomDisplayPage } from "./pages/RoomDisplayPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { a11y } from "./lib/a11y";
import { sound } from "./lib/sound";

export default function App() {
  const { pathname } = useLocation();

  // The shared screen is furniture in a room, not a page someone is browsing:
  // the site header, the footer and the skip link would all be dead weight on a
  // television nobody can click.
  const bare = /^\/room\/[^/]+\/display\/?$/.test(pathname);

  useEffect(() => {
    // Apply stored accessibility settings before first paint of the routes,
    // and arm the audio context on the first interaction of any kind.
    a11y.init();
    sound.bindGestures();
  }, []);

  return (
    <>
      {!bare && (
        <a href="#main" className="skip-link">
          דלגו לתוכן הראשי
        </a>
      )}

      {/* Faint halfway line and centre circle, behind everything. */}
      <div className="pitch-bg" aria-hidden="true" />

      <ScrollToTop />
      <RouteAnnouncer />
      {!bare && <Header />}

      <main id="main" tabIndex={-1} className="app-main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/build" element={<BuilderPage />} />
          <Route path="/play" element={<QuizPage />} />
          <Route path="/results" element={<ResultsPage />} />
          <Route path="/challenge/:publicId" element={<ChallengePage />} />
          <Route path="/daily" element={<DailyPage />} />
          <Route path="/multiplayer" element={<MultiplayerPage />} />
          <Route path="/multiplayer/duel" element={<DuelSearchPage />} />
          <Route path="/room/:code" element={<RoomPage />} />
          <Route path="/room/:code/display" element={<RoomDisplayPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>

      {!bare && <Footer />}
      <PrivacyGate />
    </>
  );
}
