import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The living Lixus building — the hero's ≥xl decoration.
//
// A small apartment block with a real 3D corner that quietly tells the product
// story on loop: a gray guest bubble appears, one flat's window warms up, and
// a navy reply bubble leaves with a check. No button (decoration must not
// compete with the real CTA), no status text, and DELIBERATELY no "use client":
// every behavior here is a CSS animation in globals.css (lxb-*), so the scene
// ships zero JavaScript and costs the landing's LCP nothing. Hover straightens
// the corner toward the viewer — desktop-only delight, which is fine because
// the whole thing is hidden below xl where hover doesn't exist anyway.
//
// aria-hidden on the root: this is scenery. Screen readers get the hero copy,
// not a narrated building.
// ---------------------------------------------------------------------------

// Facade windows, top floor first: 5 rows × 4 columns. `undefined` is a dark
// window; the classed ones are the steady evening lights, the two slow
// "breathing" flats, and the single flat the story cycle lights up.
const WINDOWS: (string | undefined)[] = [
  undefined, undefined, "lxb-lit", undefined,
  "lxb-lit", undefined, undefined, "lxb-breath",
  undefined, "lxb-target", undefined, "lxb-lit",
  "lxb-breath lxb-breath--late", undefined, undefined, undefined,
  undefined, undefined, "lxb-lit", undefined,
];

export function LixusBuilding() {
  return (
    <div className="hidden xl:block" aria-hidden="true">
      <div className="lxb-stage">
        <div className="lxb-scene">
          <div className="lxb-building">
            <div className="lxb-top" />
            <div className="lxb-flank" />
            <div className="lxb-front">
              <span className="lxb-lettering">LIXUS AI</span>
              <span className="lxb-mast">
                <span className="lxb-beacon" />
              </span>
              {WINDOWS.map((extra, i) => (
                <span key={i} data-testid="lxb-window" className={cn("lxb-win", extra)} />
              ))}
              <span data-testid="lxb-door" className="lxb-door" />
            </div>
          </div>
          <div className="lxb-bubble lxb-in">
            <span className="lxb-lines">
              <i />
              <i />
            </span>
          </div>
          <div className="lxb-bubble lxb-out">
            <span className="lxb-lines">
              <i />
              <i />
            </span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
        </div>
        <div className="lxb-ground" />
      </div>
    </div>
  );
}
