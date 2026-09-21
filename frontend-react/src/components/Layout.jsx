import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { Navbar, Footer, LocationModal } from "./chrome.jsx";
import { getSavedLocation, warmMarketApi } from "../lib/api.js";
import { useLang } from "../lib/i18n.jsx";

export default function Layout() {
  const { t } = useLang();
  const [location, setLocation] = useState(() => getSavedLocation());
  const [locOpen, setLocOpen] = useState(false);

  // Wake the free-tier backend on first paint so it is (hopefully) warm by
  // the time the user opens Market. Fire-and-forget, never blocks render.
  useEffect(() => {
    warmMarketApi();
  }, []);

  return (
    <>
      <a className="skip-link" href="#main">
        {t("skip")}
      </a>
      <div id="site-navbar">
        <Navbar location={location} onOpenLocation={() => setLocOpen(true)} />
      </div>
      <Outlet context={{ location, setLocation, openLocation: () => setLocOpen(true) }} />
      <div id="site-footer">
        <Footer />
      </div>
      <LocationModal open={locOpen} onClose={() => setLocOpen(false)} onSaved={setLocation} />
    </>
  );
}
