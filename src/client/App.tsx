import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
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
import { NotFoundPage } from "./pages/NotFoundPage";
import { a11y } from "./lib/a11y";
import { sound } from "./lib/sound";

export default function App() {
  useEffect(() => {
    // Apply stored accessibility settings before first paint of the routes,
    // and arm the audio context on the first interaction of any kind.
    a11y.init();
    sound.bindGestures();
  }, []);

  return (
    <>
      <a href="#main" className="skip-link">
        דלגו לתוכן הראשי
      </a>

      {/* Faint halfway line and centre circle, behind everything. */}
      <div className="pitch-bg" aria-hidden="true" />

      <ScrollToTop />
      <RouteAnnouncer />
      <Header />

      <main id="main" tabIndex={-1} className="app-main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/build" element={<BuilderPage />} />
          <Route path="/play" element={<QuizPage />} />
          <Route path="/results" element={<ResultsPage />} />
          <Route path="/challenge/:publicId" element={<ChallengePage />} />
          <Route path="/daily" element={<DailyPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>

      <Footer />
      <PrivacyGate />
    </>
  );
}
