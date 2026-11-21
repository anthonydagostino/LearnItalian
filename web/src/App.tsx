import { useEffect, useState } from "react";
import { api, onUnauthorized, serverConfig } from "./api";
import { useApp, useRoute } from "./state";
import { startSyncLoop, sync, useSyncState } from "./sync";
import { unlockAudio } from "./speech";
import { TimerBar } from "./ui";
import { Icon, Toasts } from "./look";
import Welcome from "./screens/Welcome";
import Today from "./screens/Today";
import Cards from "./screens/Cards";
import Talk from "./screens/Talk";
import Shadow from "./screens/Shadow";
import Mistakes from "./screens/Mistakes";
import Tutor from "./screens/Tutor";
import Progress from "./screens/Progress";
import SettingsScreen from "./screens/Settings";
import More from "./screens/More";

function Login({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  return (
    <div className="login">
      <div className="login-logo">💬</div>
      <h1>Parla</h1>
      <p className="muted">Speak Italian every day.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api("/api/login", { password: pw });
            await serverConfig(true);
            onDone();
          } catch (e) {
            setErr((e as Error).message);
          }
        }}
      >
        <input type="password" autoFocus placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} />
        <button className="btn primary big">Entra</button>
        {err && <p className="error">{err}</p>}
      </form>
    </div>
  );
}

const TABS = [
  { path: "/today", label: "Today", icon: "home" },
  { path: "/cards", label: "Cards", icon: "cards" },
  { path: "/talk", label: "Talk", icon: "chat" },
  { path: "/shadow", label: "Shadow", icon: "headphones" },
  { path: "/more", label: "More", icon: "grid" },
];

export default function App() {
  const [needLogin, setNeedLogin] = useState(false);
  const [welcomed, setWelcomed] = useState(() => localStorage.getItem("parla.welcomed") === "1");
  const route = useRoute();
  const app = useApp();
  const syncState = useSyncState();

  useEffect(() => {
    const off = onUnauthorized(() => setNeedLogin(true));
    serverConfig(true).then((c) => {
      if (c && !c.authed) setNeedLogin(true);
      else void startSyncLoop();
    });
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => {
      off();
    };
  }, []);

  if (needLogin)
    return (
      <Login
        onDone={() => {
          setNeedLogin(false);
          void startSyncLoop();
        }}
      />
    );

  if (!app)
    return (
      <div className="login">
        <div className="login-logo spin-slow">🇮🇹</div>
        <h1>Parla</h1>
        <p className="muted">
          {syncState.status === "offline"
            ? "You're offline. Connect once to download your deck and plan."
            : syncState.status === "error"
              ? `Couldn't load data: ${syncState.error}`
              : "Getting your words and plan ready…"}
        </p>
        {syncState.status !== "syncing" && (
          <button className="btn" onClick={() => void sync()}>
            Try again
          </button>
        )}
      </div>
    );

  if (!welcomed) return <Welcome app={app} onDone={() => setWelcomed(true)} />;

  const p = route.path;
  const screen =
    p.startsWith("/cards") ? <Cards app={app} params={route.params} /> :
    p.startsWith("/talk") ? <Talk app={app} /> :
    p.startsWith("/shadow") ? <Shadow app={app} /> :
    p.startsWith("/mistakes") ? <Mistakes app={app} params={route.params} /> :
    p.startsWith("/tutor") ? <Tutor app={app} /> :
    p.startsWith("/progress") ? <Progress app={app} /> :
    p.startsWith("/settings") ? <SettingsScreen app={app} /> :
    p.startsWith("/more") ? <More /> :
    <Today app={app} />;

  const activeTab = TABS.find((t) => p.startsWith(t.path))?.path ?? (["/mistakes", "/tutor", "/progress", "/settings"].some((x) => p.startsWith(x)) ? "/more" : "/today");

  return (
    <div className="app">
      {syncState.status === "offline" && <div className="banner">📴 Offline — your progress will sync when you're back</div>}
      <main key={p.split("?")[0]} className="page-enter">
        {screen}
      </main>
      <TimerBar />
      <Toasts />
      <nav className="tabs">
        {TABS.map((t) => (
          <a key={t.path} href={`#${t.path}`} className={activeTab === t.path ? "active" : ""}>
            <span className="tab-icon">
              <Icon name={t.icon} size={24} />
            </span>
            <span>{t.label}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
