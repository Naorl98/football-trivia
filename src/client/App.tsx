import { Route, Routes } from "react-router-dom";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { ScrollToTop } from "./components/ScrollToTop";
import { RouteAnnouncer } from "./components/RouteAnnouncer";
import { BrandIntro } from "./components/BrandIntro";
import { PrivacyGate } from "./components/PrivacyGate";
import { HomePage } from "./pages/HomePage";
import { BuilderPage } from "./pages/BuilderPage";
import { QuizPage } from "./pages/QuizPage";
import { ResultsPage } from "./pages/ResultsPage";
import { ChallengePage } from "./pages/ChallengePage";
import { DailyPage } from "./pages/DailyPage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { NotFoundPage } from "./pages/NotFoundPage";

export default function App() {
  return (
    <>
      {/* First tab stop on every page: jump straight past the masthead. */}
      <a href="#main" className="skip-link">
        דלגו לתוכן הראשי
      </a>

      <BrandIntro />
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
