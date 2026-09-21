import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { dedupePriceRows, getAllPrices, getLocations, searchBackendProducts } from "../lib/api.js";
import { useLang } from "../lib/i18n.jsx";
import { TrendIcon } from "../components/bits.jsx";

export default function Market() {
  const { t, cropName, cropLocal, categoryName, unitName } = useLang();
  const [params, setSearchParams] = useSearchParams();
  /** Read a query param straight from the URL — doesn't depend on useSearchParams. */
  function readP(name) {
    try {
      return new URLSearchParams(window.location.search).get(name) || "";
    } catch {
      return "";
    }
  }
  /**
   * Initial active state:
   *  - explicit `state` query param ("" = All India) if present;
   *  - otherwise the saved location's state (near-me default);
   *  - otherwise All India.
   */
  function initStateSel() {
    try {
      const sp = new URLSearchParams(window.location.search);
      if (sp.has("state")) return sp.get("state") || "";
    } catch {
      /* fall through */
    }
    try {
      const loc = JSON.parse(localStorage.getItem("kisansetu_location") || "null");
      return (loc && loc.state) || "";
    } catch {
      return "";
    }
  }
  const [allPrices, setAllPrices] = useState([]);
  const [q, setQ] = useState(readP("q"));
  const [stateSel, setStateSel] = useState(initStateSel());
  const [states, setStates] = useState([]);
  // Direct backend matches for the raw user query (products outside the
  // 19-crop local directory, e.g. honey/egg, plus extra variants). Merged
  // with the directory rows below — one request per search, deduplicated.
  const [backendRows, setBackendRows] = useState([]);

  useEffect(() => {
    getLocations().then((l) => setStates(Object.keys(l)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    getAllPrices(stateSel).then((rows) => {
      if (!cancelled) {
        setAllPrices(rows);
      }
    });
    // New state scope invalidates the previous query's backend rows until
    // the debounced search below refetches them for the new scope.
    setBackendRows([]);
    return () => {
      cancelled = true;
    };
  }, [stateSel]);

  useEffect(() => {
    setQ(readP("q"));
  }, [params]);

  // Fetch backend-only matches for the current search text (debounced).
  // Short (<2 char) queries stay local-only: the backend substring search
  // is slow for single letters and would add noise without value.
  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) {
      setBackendRows([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchBackendProducts(needle, { state: stateSel }).then((rows) => {
        if (!cancelled) setBackendRows(rows);
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, stateSel]);

  function changeState(s) {
    if (s === stateSel) return;
    const next = new URLSearchParams(params.toString());
    // Always write the state key (even "" for All India) so the choice is sticky.
    next.set("state", s);
    setStateSel(s);
    setSearchParams(next);
  }

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    // allPrices already contains every backend record for the 19 directory
    // crops (multi-match variants included — no data[0] truncation). When a
    // search is active we additionally merge direct backend matches so the
    // ~392 products outside the directory become visible, deduplicated by
    // backend product identity.
    const pool = needle ? dedupePriceRows([...allPrices, ...backendRows]) : allPrices;
    const filtered = pool.filter(
      ({ crop }) =>
        !needle ||
        crop.name.toLowerCase().includes(needle) ||
        (crop.local || "").toLowerCase().includes(needle) ||
        cropName(crop).toLowerCase().includes(needle) ||
        cropLocal(crop).toLowerCase().includes(needle)
    );
    return [...filtered].sort((a, b) => cropName(a.crop).localeCompare(cropName(b.crop)));
  }, [allPrices, backendRows, q, cropName, cropLocal]);

  return (
    <main id="main" className="section-tight">
      <div className="container">
        <h1>{t("mkt.title")}</h1>
        <p className="muted" id="mktStatus">
          {allPrices.length
            ? (stateSel
                ? t("mkt.showingState", { state: stateSel })
                : t("mkt.showingIndia"))
            : t("c.loading")}
        </p>

        <div className="filters">
          <div className="field">
            <label htmlFor="mSearch">{t("mkt.search")}</label>
            <input
              id="mSearch"
              type="text"
              placeholder={t("mkt.searchPh")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="mState">{t("mkt.state")}</label>
            <select id="mState" value={stateSel} onChange={(e) => changeState(e.target.value)}>
              <option value="">{t("mkt.allIndia")}</option>
              {states.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-3" id="cropGrid">
          {list.map(({ crop, price }) => (
            <Link
              key={crop.id}
              className="crop-card"
              to={`/crop?crop=${crop.id}${stateSel ? `&state=${encodeURIComponent(stateSel)}` : ""}`}
            >
              <div className="name">{cropName(crop)}</div>
              <div className="local">
                {cropLocal(crop)} · {categoryName(crop.category)}
              </div>
              <div className="price-line">
                <span className="price">₹{price.modal}</span>
                <span className="unit">/{unitName(price.unit)}</span>
              </div>
              <span className={`trend ${price.trendDir}`}>
                <TrendIcon dir={price.trendDir} /> {price.trendPct}%
              </span>
              <div className="updated">
                {t("mkt.updated", {
                  ago:
                    price.updatedMinsAgo < 60
                      ? t("time.mAgo", { n: price.updatedMinsAgo })
                      : t("time.hAgo", { n: Math.round(price.updatedMinsAgo / 60) }),
                })}
                {price.live && price.source ? ` · ${price.source}` : ""}
              </div>
            </Link>
          ))}
        </div>
        <div className="empty" id="emptyState" style={{ display: list.length ? "none" : "block" }}>
          <div className="icon">
            <i className="bi bi-search" aria-hidden="true"></i>
          </div>
          <p>{t("mkt.empty")}</p>
        </div>
      </div>
    </main>
  );
}
