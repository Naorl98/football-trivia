import { Route, Routes } from "react-router-dom";
import { Header } from "./components/Header";
import { ScrollToTop } from "./components/ScrollToTop";
import { HomePage } from "./pages/HomePage";
import { BuilderPage } from "./pages/BuilderPage";
import { QuizPage } from "./pages/QuizPage";
import { ResultsPage } from "./pages/ResultsPage";
import { ChallengePage } from "./pages/ChallengePage";
import { DailyPage } from "./pages/DailyPage";
import { NotFoundPage } from "./pages/NotFoundPage";

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Header />
      <main style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/build" element={<BuilderPage />} />
          <Route path="/play" element={<QuizPage />} />
          <Route path="/results" element={<ResultsPage />} />
          <Route path="/challenge/:publicId" element={<ChallengePage />} />
          <Route path="/daily" element={<DailyPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </>
  );
}
