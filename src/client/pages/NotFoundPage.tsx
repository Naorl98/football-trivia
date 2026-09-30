import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import "./IntroPage.css";

export function NotFoundPage() {
  return (
    <div className="page gate">
      <div className="plate card">
        <span className="plate-mark">
          <Icon name="whistle" size={26} />
        </span>
        <p className="label plate-kicker">שגיאה 404</p>
        <h1 className="plate-title">הבעיטה הזאת עברה מעל הרוחב</h1>
        <p className="plate-text">הדף שחיפשתם לא קיים. אולי הקישור נשבר, אולי הכתובת הוקלדה אחרת.</p>
        <Link className="btn btn-ink" to="/">
          חזרה לדף הבית
        </Link>
      </div>
    </div>
  );
}
