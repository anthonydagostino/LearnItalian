export default function More() {
  const items = [
    { href: "#/mistakes", label: "Mistakes journal", icon: "📝" },
    { href: "#/tutor", label: "Tutor sessions", icon: "👩‍🏫" },
    { href: "#/progress", label: "Progress", icon: "📈" },
    { href: "#/cards?browse=1", label: "Browse & add cards", icon: "🔎" },
    { href: "#/settings", label: "Settings & mic test", icon: "⚙️" },
  ];
  return (
    <div className="screen">
      <h2>More</h2>
      <div className="list">
        {items.map((i) => (
          <a key={i.href} className="list-item link" href={i.href}>
            <span>{i.icon}</span> {i.label}
          </a>
        ))}
      </div>
    </div>
  );
}
