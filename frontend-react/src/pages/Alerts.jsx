import { useEffect, useState } from "react";
import {
  getAlerts,
  deleteAlert,
  getNotifications,
  addNotification,
  deleteNotification,
  getCropPrice,
  getObservedChangePct,
} from "../lib/api.js";
import { useLang } from "../lib/i18n.jsx";

export default function Alerts() {
  const { t, lang, cropName, unitName } = useLang();
  const [news, setNews] = useState([]);
  const [hasRules, setHasRules] = useState(false);

  function messageFor(n) {
    if (n.condition === "above")
      return t("al.hitAbove", { t: n.threshold, u: unitName(n.unit), p: n.price });
    if (n.condition === "below")
      return t("al.hitBelow", { t: n.threshold, u: unitName(n.unit), p: n.price });
    if (n.condition === "percent_up")
      return t("al.hitPUp", { c: n.changePct, u: unitName(n.unit), p: n.price });
    if (n.condition === "percent_down")
      return t("al.hitPDown", { c: n.changePct, u: unitName(n.unit), p: n.price });
    return "";
  }

  function timeAgo(ts) {
    const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (mins < 60) return t("time.minAgo", { n: mins });
    const hours = Math.round(mins / 60);
    if (hours < 24) return t("time.hoursAgo", { n: hours });
    return t("time.dAgo", { n: Math.round(hours / 24) });
  }

  /** Check every active rule; fired rules post one news item (then retire). */
  async function load() {
    const rules = await getAlerts();
    setHasRules(rules.length > 0);
    const existing = await getNotifications();

    for (const rule of rules) {
      if (rule.active === false) continue;
      if (existing.some((n) => n.ruleId === rule.id)) continue;
      const price = await getCropPrice(rule.crop);
      if (!price) continue;

      let hit = false;
      let change = null;
      if (rule.condition === "above" && price.modal >= rule.threshold) hit = true;
      if (rule.condition === "below" && price.modal <= rule.threshold) hit = true;
      if (rule.condition === "percent_up" || rule.condition === "percent_down") {
        // Real movement only: % change across prices this app genuinely
        // observed from the live backend in the last 7 days. null means
        // "not enough history yet" — the rule waits instead of firing on
        // demo data.
        change = getObservedChangePct(rule.crop, 7);
        if (change === null) continue;
        if (rule.condition === "percent_up" && change >= rule.threshold) hit = true;
        if (rule.condition === "percent_down" && change <= -rule.threshold) hit = true;
      }

      if (hit) {
        await addNotification({
          ruleId: rule.id,
          crop: rule.crop,
          condition: rule.condition,
          threshold: rule.threshold,
          unit: rule.unit,
          price: price.modal,
          changePct: change,
          location: rule.location,
        });
        await deleteAlert(rule.id);
      }
    }

    setNews(await enrichWithLive(await getNotifications()));
  }

  /**
   * Attach the *current* live price to each stored item (not persisted —
   * recomputed on every visit), so the feed shows real data every time, not
   * just the snapshot from when the rule fired. Live lookup fails → the
   * stored snapshot still renders on its own.
   */
  async function enrichWithLive(items) {
    const crops = [...new Set(items.map((n) => n.crop).filter(Boolean))];
    const nowPrices = {};
    await Promise.all(
      crops.map(async (c) => {
        try {
          const p = await getCropPrice(c);
          if (p) nowPrices[c] = p;
        } catch {
          /* keep snapshot only */
        }
      })
    );
    return items.map((n) =>
      nowPrices[n.crop]
        ? { ...n, liveNow: nowPrices[n.crop].modal, liveUnit: nowPrices[n.crop].unit }
        : n
    );
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  async function dismiss(id) {
    await deleteNotification(id);
    setNews(await enrichWithLive(await getNotifications()));
  }

  return (
    <main id="main" className="section-tight">
      <div className="container">
        <div>
          <h1>{t("al.title")}</h1>
          <p className="muted mb-0">{t("al.sub")}</p>
        </div>
        <p className="muted text-sm mt-2 mb-0">{t("al.expiryNote")}</p>

        <div className="card mt-5">
          <div id="alertsList">
            {news.map((n) => (
              <div className="crop-row" key={n.id}>
                <div className="flex gap-3" style={{ alignItems: "flex-start" }}>
                  <span className="badge-verified" style={{ marginTop: 2 }}>
                    <i className="bi bi-bell-fill" aria-hidden="true"></i>
                  </span>
                  <div>
                    <div>
                      <strong>{cropName(n.crop)}</strong>
                      <span className="muted text-sm"> · {n.location}</span>
                    </div>
                    <div className="mt-2">{messageFor(n)}</div>
                    {n.liveNow != null && (
                      <div className="muted text-sm" style={{ marginTop: 4 }}>
                        {t("al.now", { p: n.liveNow, u: unitName(n.liveUnit || n.unit) })}
                      </div>
                    )}
                    <div className="muted text-sm" style={{ marginTop: 4 }}>
                      {timeAgo(n.createdAt)}
                    </div>
                  </div>
                </div>
                <button
                  className="icon-btn"
                  onClick={() => dismiss(n.id)}
                  aria-label={t("al.dismiss")}
                  title={t("al.dismiss")}
                >
                  <i className="bi bi-x-lg" aria-hidden="true"></i>
                </button>
              </div>
            ))}
          </div>
          {news.length === 0 && (
            <div className="empty" id="emptyState">
              <div className="icon">
                <i className="bi bi-bell" aria-hidden="true"></i>
              </div>
              <p>{hasRules ? t("al.quiet") : t("al.empty")}</p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
