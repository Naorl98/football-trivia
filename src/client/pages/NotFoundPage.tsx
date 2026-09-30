import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import "./IntroPage.css";

export function NotFoundPage() {
  return (
    <div className="page gate">
      <div className="plate a-pop">
        <span className="plate-mark">
          <Icon name="whistle" size={23} />
        </span>
        <h1 className="plate-title">הדף לא נמצא</h1>
        <p className="plate-text">הבעיטה הזאת עברה מעל הרוחב. הקישור כנראה שבור.</p>
        <Link className="btn btn-primary" to="/">
          חזרה לדף הבית
        </Link>
      </div>
    </div>
  );
}
