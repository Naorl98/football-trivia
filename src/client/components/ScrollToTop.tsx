import { useEffect } from "react";
import { useLocation } from "react-router-dom";

// SPA navigations keep the previous scroll offset, which leaves the player
// mid-page when a new question screen or result screen mounts.
export function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}
