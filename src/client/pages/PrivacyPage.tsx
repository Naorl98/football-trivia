import { Link } from "react-router-dom";
import { openPrivacySettings } from "../components/PrivacyGate";
import { Icon } from "../components/Icon";
import "./PrivacyPage.css";

/**
 * The full disclosure, written to be read rather than to be survived.
 *
 * Everything here is checkable against the code: the storage keys are the ones
 * in `lib/privacy.ts`, and the "no cookies / no analytics" claim holds because
 * the app ships no third-party script beyond the Google Fonts stylesheet, which
 * is disclosed below rather than glossed over.
 */
export function PrivacyPage() {
  return (
    <div className="page policy">
      <header className="policy-head">
        <p className="label">מסמך</p>
        <h1 className="policy-title display">פרטיות, בלי אותיות קטנות</h1>
        <p className="policy-lede prose">
          Football IQ הוא משחק חידונים. אין בו חשבונות, אין בו התחברות, ואין לנו שום דרך לדעת מי
          אתם. הדף הזה מפרט בדיוק מה כן נשמר — גם כשזה מעט.
        </p>
      </header>

      <hr className="rule" />

      <div className="policy-body">
        <Clause index="01" title="מה אנחנו לא עושים">
          <ul className="policy-list">
            <li>לא מציבים קובצי Cookie. אף אחד.</li>
            <li>לא מריצים אנליטיקס — לא Google Analytics ולא חלופה.</li>
            <li>לא מציגים פרסומות ולא משתמשים במזהי פרסום.</li>
            <li>לא מבקשים שם, אימייל, טלפון או כל פרט מזהה.</li>
            <li>לא מוכרים ולא משתפים נתונים, כי אין מה למכור.</li>
          </ul>
        </Clause>

        <Clause index="02" title="מה נשמר בדפדפן שלכם">
          <p>
            כל מה שהמשחק זוכר נשמר אצלכם מקומית, לא אצלנו. אתם יכולים לכבות את הקטגוריות
            האופציונליות או למחוק הכול בכל רגע.
          </p>
          <div className="policy-table">
            <Row
              k="fiq_active_quiz"
              scope="sessionStorage"
              why="החידון שאתם משחקים כרגע, כדי שרענון של הדף לא יאבד אותו"
              cat="הכרחי"
            />
            <Row
              k="fiq_last_result"
              scope="sessionStorage"
              why="התוצאה האחרונה, כדי להציג את מסך הסיכום"
              cat="הכרחי"
            />
            <Row
              k="fiq_intro_seen"
              scope="sessionStorage"
              why="שהאנימציה הפותחת תופיע פעם אחת בכרטיסייה"
              cat="הכרחי"
            />
            <Row k="fiq_sound_enabled" scope="localStorage" why="אם הצלילים דלוקים או כבויים" cat="העדפות" />
            <Row
              k="fiq_recent_questions"
              scope="localStorage"
              why="מזהים של עד 300 שאלות שראיתם, כדי להעדיף שאלות חדשות"
              cat="היסטוריה"
            />
            <Row
              k="fiq_privacy_v1"
              scope="localStorage"
              why="הבחירה שלכם בדף הזה, כדי שלא נשאל בכל כניסה"
              cat="הכרחי"
            />
          </div>
          <p className="policy-note">
            כל מה שב-<code>sessionStorage</code> נמחק לבד כשסוגרים את הכרטיסייה.
          </p>
        </Clause>

        <Clause index="03" title="מה נשמר בשרת">
          <p>
            כשמסיימים חידון נרשמת שורה אנונימית: מספר השאלות, כמה נכונות, כמה זמן זה לקח ואיזו
            תצורה שיחקתם. אין בה כתובת IP, אין מזהה דפדפן ואין שום דבר שמחבר בין שתי הרצות שלכם.
            היא משמשת אותנו כדי לדעת אם שאלה מסוימת קשה מדי — לא כדי לעקוב אחרי שחקנים.
          </p>
          <p>
            קישור אתגר שאתם מייצרים נשמר כדי שהחברים שלכם יקבלו בדיוק את אותן שאלות. הוא מכיל את
            תצורת החידון, לא אתכם.
          </p>
        </Clause>

        <Clause index="04" title="צדדים שלישיים">
          <p>
            הגופנים (Frank Ruhl Libre ו-Heebo) נטענים מ-Google Fonts. זאת אומרת שבטעינת הדף הדפדפן
            שלכם פונה לשרת של Google, ולכן כתובת ה-IP שלכם נחשפת אליו. זה הצד השלישי היחיד, והוא
            מוזכר כאן כי אמירה כמו &rdquo;אפס צדדים שלישיים&ldquo; הייתה לא נכונה.
          </p>
          <p>
            האפליקציה מתארחת ב-Cloudflare Workers. Cloudflare מעבדת את הבקשות כספקית תשתית, לפי
            תנאיה.
          </p>
        </Clause>

        <Clause index="05" title="השליטה שלכם">
          <p>
            בלחיצה אחת אפשר לשנות קטגוריות או למחוק כל מה שנשמר מקומית. מחיקה היא מיידית ומלאה —
            כולל רשומת ההסכמה עצמה, כך שתישאלו מחדש בפעם הבאה.
          </p>
          <div className="policy-actions">
            <button className="btn btn-ink" onClick={openPrivacySettings}>
              <Icon name="sliders" size={18} />
              פתח הגדרות פרטיות
            </button>
            <Link to="/" className="btn btn-outline">
              חזרה למשחק
            </Link>
          </div>
        </Clause>
      </div>
    </div>
  );
}

function Clause({ index, title, children }: { index: string; title: string; children: React.ReactNode }) {
  return (
    <section className="policy-clause">
      <div className="section-head">
        <span className="section-index">{index}</span>
        <h2 className="section-title">{title}</h2>
      </div>
      <div className="prose">{children}</div>
    </section>
  );
}

function Row({ k, scope, why, cat }: { k: string; scope: string; why: string; cat: string }) {
  return (
    <div className="policy-row">
      <code className="policy-key">{k}</code>
      <span className="stamp">{scope}</span>
      <span className="policy-why">{why}</span>
      <span className="policy-cat label">{cat}</span>
    </div>
  );
}
