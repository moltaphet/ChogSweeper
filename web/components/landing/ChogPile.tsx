"use client";

import { useEffect, useRef } from "react";
import { ChogCard } from "./ChogCard";
import { MonadLogo } from "@/components/site/MonadLogo";

/** Ids of the Chogs that rain down. The same id always draws the same Chog. */
const IDS = [
  7, 21, 42, 88, 3, 19, 64, 105, 12, 77, 31, 55, 9, 120, 26, 71, 4, 93, 38, 14, 67, 49, 101, 58, 2, 16, 35, 46, 61, 80, 97, 110, 5, 27, 53, 84,
];
const COINS = 8;
/** Chunky letter tiles in between the cards, like the toys in the reference: they make the heap read as a pile of things. */
const LETTERS = [
  { c: "C", bg: "linear-gradient(145deg,#A78BFA,#6D4AFF)", fg: "#fff" },
  { c: "H", bg: "linear-gradient(145deg,#F9A8D4,#EC4899)", fg: "#fff" },
  { c: "O", bg: "linear-gradient(145deg,#FDE68A,#F59E0B)", fg: "#5B3A00" },
  { c: "G", bg: "linear-gradient(145deg,#6EE7B7,#10B981)", fg: "#053B2B" },
  { c: "C", bg: "linear-gradient(145deg,#93C5FD,#3B82F6)", fg: "#fff" },
  { c: "H", bg: "linear-gradient(145deg,#C4B5FD,#7C3AED)", fg: "#fff" },
];
const COIN_AT = IDS.length;
const LETTER_AT = IDS.length + COINS;

type Piece = { el: HTMLElement; w: number; h: number; body?: import("matter-js").Body };

/**
 * A pile of Chogs that falls into view: every card is a real physics body (matter-js), so they tumble, collide, bounce and
 * settle into a jumbled heap on the floor, then can be grabbed and thrown with the mouse. The cards are ordinary DOM
 * elements moved with transforms each frame, so the art stays vector-sharp at any resolution.
 *
 * The section spans the full width of the page. The drop plays once per page load, the first time it scrolls into view (at
 * once if it already is); only a refresh plays it again. With `prefers-reduced-motion`
 * the fall is gentler (no spin, little drift) but still plays. The library is loaded on demand so it never weighs on the
 * first paint.
 */
export function ChogPile() {
  const box = useRef<HTMLDivElement>(null);
  const pieces = useRef<Piece[]>([]);

  useEffect(() => {
    const host = box.current;
    if (!host) return;
    let disposed = false;
    let stop = () => {};
    let started = false;

    const run = async () => {
      if (started) return;
      started = true;
      const Matter = (await import("matter-js")).default; // already preloaded below, so this resolves at once
      if (disposed) return;
      const { Engine, World, Bodies, Body, Mouse, MouseConstraint, Events } = Matter;
      // With "reduce motion" on, the cards still fall once (it is the point of the section) but gently: no spin, little sideways drift.
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const finePointer = window.matchMedia("(pointer: fine)").matches;

      const build = (instant: boolean, calm = false) => {
        const W = host.clientWidth;
        const H = host.clientHeight;
        // Big, chunky pieces: a real heap about two to three cards deep, so they land on top of each other, with the whole height above it left clear for the fall.
        const cardW = Math.max(112, Math.min(216, W / 6.8));
        const perRow = W / cardW;
        const count = Math.max(9, Math.min(IDS.length, Math.round(perRow * 2.1)));

        const engine = Engine.create({ gravity: { x: 0, y: 2.1 }, enableSleeping: true });
        engine.timing.timeScale = 1.5; // snappier: the fall reads as rain, not slow motion
        const wall = 200;
        const thick = 80;
        World.add(engine.world, [
          Bodies.rectangle(W / 2, H + thick / 2 - 6, W + wall * 2, thick, { isStatic: true, friction: 0.8 }), // floor
          Bodies.rectangle(-thick / 2, -H, thick, H * 6, { isStatic: true }), // left wall
          Bodies.rectangle(W + thick / 2, -H, thick, H * 6, { isStatic: true }), // right wall
        ]);

        const els = pieces.current;
        const bodies: Array<{ piece: Piece; body: import("matter-js").Body; delay: number; added: boolean }> = [];
        els.forEach((p, i) => {
          const kind = i >= LETTER_AT ? "letter" : i >= COIN_AT ? "coin" : "card";
          const w = kind === "card" ? cardW : kind === "coin" ? cardW * 0.4 : cardW * 0.46;
          const h = kind === "card" ? cardW : w;
          // The artwork has transparent margin (and a thick lower edge), so a card's hit box is a little smaller than its picture: the frames then touch instead of floating apart.
          const hit = kind === "card" ? 0.88 : 1;
          p.w = w;
          p.h = h;
          p.el.style.width = `${w}px`;
          p.el.style.height = `${h}px`;
          const body =
            kind === "coin"
              ? Bodies.circle(0, 0, w / 2, { restitution: 0.6, friction: 0.2, density: 0.0012 })
              : Bodies.rectangle(0, 0, w * hit, h * hit, { chamfer: { radius: kind === "letter" ? 10 : 7 }, restitution: 0.32, friction: 0.45, frictionAir: 0.006, density: 0.001 });
          p.body = body;
          // Rain: each piece starts at its own spot across the whole width, well above the top edge so the fall is long, and ...
          Body.setPosition(body, { x: w * 0.6 + Math.random() * (W - w * 1.2), y: -h * (0.8 + Math.random() * 3.2) });
          Body.setAngle(body, (Math.random() - 0.5) * (calm ? 0.5 : 2.4));
          Body.setAngularVelocity(body, calm ? 0 : (Math.random() - 0.5) * 0.3);
          // ... with a sideways kick, so on landing every piece skids off in its own direction.
          Body.setVelocity(body, { x: (Math.random() - 0.5) * (calm ? 3 : 14), y: 9 + Math.random() * 8 });
          const live = kind === "card" ? i < count : kind === "coin" ? i - COIN_AT < COINS : i - LETTER_AT < Math.max(2, Math.round(count / 3));
          if (live) bodies.push({ piece: p, body, delay: instant ? 0 : Math.random() * (calm ? 900 : 1400), added: false });
          p.el.style.opacity = "0";
        });

        // Draw: DOM transforms from the bodies.
        const paint = () => {
          for (const b of bodies) {
            if (!b.added) continue;
            const { x, y } = b.body.position;
            b.piece.el.style.transform = `translate3d(${x - b.piece.w / 2}px, ${y - b.piece.h / 2}px, 0) rotate(${b.body.angle}rad)`;
          }
        };
        const add = (b: (typeof bodies)[number]) => {
          b.added = true;
          World.add(engine.world, b.body);
          b.piece.el.style.opacity = "1";
        };

        if (instant) {
          bodies.forEach(add);
          for (let i = 0; i < 900; i++) Engine.update(engine, 1000 / 60);
          paint();
          return () => {};
        }

        // Grab and throw (mouse only: on touch screens the pile must never steal page scrolling).
        let mc: import("matter-js").MouseConstraint | null = null;
        if (finePointer) {
          const mouse = Mouse.create(host);
          const m = mouse as unknown as Record<string, EventListener>;
          // matter-js otherwise swallows wheel and touch events, which would freeze page scrolling over the pile.
          for (const ev of ["wheel", "mousewheel", "DOMMouseScroll"]) host.removeEventListener(ev, m.mousewheel as EventListener);
          for (const ev of ["touchstart", "touchmove", "touchend"]) host.removeEventListener(ev, m[ev === "touchstart" ? "mousedown" : ev === "touchmove" ? "mousemove" : "mouseup"] as EventListener);
          mc = MouseConstraint.create(engine, { mouse, constraint: { stiffness: 0.18, damping: 0.1, render: { visible: false } } });
          World.add(engine.world, mc);
          host.style.cursor = "grab";
          Events.on(mc, "startdrag", () => (host.style.cursor = "grabbing"));
          Events.on(mc, "enddrag", () => (host.style.cursor = "grab"));
        }

        let raf = 0;
        let last = performance.now();
        const t0 = last;
        const tick = (now: number) => {
          const elapsed = now - t0;
          for (const b of bodies) if (!b.added && elapsed >= b.delay) add(b);
          const dt = Math.min(32, now - last);
          last = now;
          Engine.update(engine, dt);
          paint();
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => {
          cancelAnimationFrame(raf);
          if (mc) {
            Events.off(mc, "startdrag");
            Events.off(mc, "enddrag");
          }
          host.style.cursor = "";
          World.clear(engine.world, false);
          Engine.clear(engine);
        };
      };

      let teardown = build(false, reduced);
      let width = host.clientWidth;
      const playedAt = performance.now();
      const ro = new ResizeObserver(() => {
        if (Math.abs(host.clientWidth - width) < 40) return;
        width = host.clientWidth;
        if (performance.now() - playedAt < 6000) return; // never cut a drop short
        teardown();
        teardown = build(true); // after a resize, show the settled pile straight away
      });
      ro.observe(host);
      stop = () => {
        ro.disconnect();
        teardown();
      };
    };

    void import("matter-js"); // fetch the physics library now, so the drop starts the instant the pile is in view

    // The rain falls once per page load, the first time the pile is on screen (at once if it already is). Only a refresh plays it again.
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.intersectionRatio >= 0.35)) {
          io.disconnect();
          void run();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(host);

    return () => {
      disposed = true;
      io.disconnect();
      stop();
    };
  }, []);

  return (
    <section aria-label="A pile of Chog NFTs you can grab and throw" className="relative w-full pb-16">
      <div className="pointer-events-none absolute inset-x-0 top-4 z-10 flex justify-center" aria-hidden>
        <span className="rounded-full bg-monad-ink px-3.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white shadow-card">Grab and throw the Chogs</span>
      </div>
      <div ref={box} className="relative h-[clamp(460px,80vh,780px)] w-full touch-pan-y select-none overflow-hidden bg-gradient-to-b from-transparent via-monad-tint/40 to-monad-tint/90">
        {IDS.map((id, i) => (
          <div key={id} ref={(el) => { if (el) pieces.current[i] = Object.assign(pieces.current[i] ?? { w: 0, h: 0 }, { el }); }} className="absolute left-0 top-0 will-change-transform" style={{ opacity: 0 }}>
            <ChogCard id={id} slot={i} className="h-full w-full" />
          </div>
        ))}
        {Array.from({ length: COINS }, (_, i) => (
          <div key={`coin${i}`} ref={(el) => { if (el) pieces.current[COIN_AT + i] = Object.assign(pieces.current[COIN_AT + i] ?? { w: 0, h: 0 }, { el }); }} className="absolute left-0 top-0 will-change-transform" style={{ opacity: 0 }}>
            <MonadLogo className="h-full w-full" />
          </div>
        ))}
        {LETTERS.map((l, i) => (
          <div key={`letter${i}`} ref={(el) => { if (el) pieces.current[LETTER_AT + i] = Object.assign(pieces.current[LETTER_AT + i] ?? { w: 0, h: 0 }, { el }); }} className="absolute left-0 top-0 will-change-transform" style={{ opacity: 0 }}>
            <div className="flex h-full w-full items-center justify-center rounded-[14px] border-2 border-white/80 font-display text-3xl font-black shadow-[0_14px_26px_-12px_rgba(60,30,200,0.6)] sm:text-4xl" style={{ background: l.bg, color: l.fg }}>{l.c}</div>
          </div>
        ))}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-monad-border" aria-hidden />
      </div>
    </section>
  );
}
