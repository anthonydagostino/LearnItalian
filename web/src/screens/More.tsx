export default function More() {
  const items = [
    { href: "#/path", label: "Your path", sub: "9 weeks & the goal", icon: "🗺️", color: "tomato" },
    { href: "#/mistakes", label: "Mistakes", sub: "Review & make cards", icon: "📝", color: "pink" },
    { href: "#/progress", label: "Progress", sub: "Streak, hours, charts", icon: "📈", color: "green" },
    { href: "#/tutor", label: "Tutor", sub: "Log iTalki/Preply", icon: "👩‍🏫", color: "amber" },
    { href: "#/cards?browse=1", label: "Your deck", sub: "Browse & add cards", icon: "🔎", color: "purple" },
    { href: "#/settings", label: "Settings", sub: "Voice, mic test, sync", icon: "⚙️", color: "blue" },
  ];
  return (
    <div className="screen">
      <header className="page-head">
        <div>
          <h1>More</h1>
        </div>
      </header>
      <div className="more-grid">
        {items.map((i) => (
          <a key={i.href} className={`more-tile c-${i.color}`} href={i.href}>
            <span className="tile-emoji">{i.icon}</span>
            <b>{i.label}</b>
            <small>{i.sub}</small>
          </a>
        ))}
      </div>
    </div>
  );
}
