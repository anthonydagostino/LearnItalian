import type { Row } from "./db";
import type { ConversationData } from "./types";

export interface Skill {
  id: string;
  label: string;
  emoji: string;
  scenario?: string;
  stars: number; // 0..3
  detail: string;
}

const SKILLS: { id: string; label: string; emoji: string; scenario?: string }[] = [
  { id: "introductions", label: "Introduce myself", emoji: "👋", scenario: "introductions" },
  { id: "job", label: "Talk about my job", emoji: "💻", scenario: "job" },
  { id: "restaurant", label: "Order at a restaurant", emoji: "🍝", scenario: "restaurant" },
  { id: "hotel", label: "Check into a hotel", emoji: "🏨", scenario: "hotel" },
  { id: "train_tickets", label: "Buy train tickets", emoji: "🚆", scenario: "train_tickets" },
  { id: "directions", label: "Ask for directions", emoji: "🗺️", scenario: "directions" },
  { id: "shopping", label: "Go shopping", emoji: "🛍️", scenario: "shopping" },
  { id: "pharmacy", label: "Handle a pharmacy visit", emoji: "💊", scenario: "pharmacy" },
  { id: "small_talk", label: "Small talk with a stranger", emoji: "☕", scenario: "small_talk" },
  { id: "long", label: "Hold a 20–30 minute conversation", emoji: "🏆" },
];

const replies = (c: ConversationData) => c.messages.filter((m) => m.role === "user").length;

/**
 * Real-world "can do" skills, earned from actual conversations — not from tapping tiles.
 * ★ = one solid session (6+ replies), ★★ = two, ★★★ = three, with at least one at level 2+.
 * The long-conversation skill is earned by speaking time: 10 / 20 / 30 minutes in one session.
 */
export function computeSkills(convs: Row<ConversationData>[]): Skill[] {
  return SKILLS.map((s) => {
    if (s.id === "long") {
      const best = Math.max(0, ...convs.map((c) => c.data.speakingSeconds ?? 0)) / 60;
      const stars = best >= 30 ? 3 : best >= 20 ? 2 : best >= 10 ? 1 : 0;
      return { ...s, stars, detail: best ? `Longest so far: ${Math.round(best)} min` : "Any scenario, 10+ minutes to start" };
    }
    const solid = convs.filter((c) => c.data.scenario === s.scenario && replies(c.data) >= 6);
    let stars = Math.min(3, solid.length);
    if (stars === 3 && !solid.some((c) => c.data.level >= 2)) stars = 2;
    const tried = convs.some((c) => c.data.scenario === s.scenario && replies(c.data) > 0);
    return {
      ...s,
      stars,
      detail: stars === 3 ? "Confident ✓" : stars ? `${solid.length} solid session${solid.length === 1 ? "" : "s"}` : tried ? "Tried — go for 6+ replies" : "Not tried yet",
    };
  });
}

export function Stars({ n }: { n: number }) {
  return (
    <span className="stars" aria-label={`${n} of 3 stars`}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={i < n ? "on" : ""}>
          ★
        </span>
      ))}
    </span>
  );
}
