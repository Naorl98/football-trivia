// The inline boot layer in index.html.
//
// WHY THIS FILE EXISTS, AND IT IS NOT A HYPOTHETICAL
//
// The boot layer is the code that has to run when the rest of the app could
// not. It paints the background, dismisses the loading shell, offers the
// recovery screen and arms the failsafe. If it does not parse, none of that
// happens: the shell never comes down, and every route serves a permanent dark
// screen with a spinner on it — the exact failure the layer was written to
// prevent, caused by the layer itself.
//
// That is not a thought experiment. While fixing the blank screen this very
// file is about, a one-character escaping mistake turned
//
//     /,\s*0\s*\)$/        into        /,s*0s*)$/
//
// which is an invalid regular expression, which is a SyntaxError at parse time,
// which took out the whole block. It was deployed, and it broke every route
// until the next deploy. Nothing caught it: TypeScript does not look inside
// index.html, the bundler does not parse inline scripts, and the browser
// reports it only in a console nobody is watching.
//
// So the inline script is extracted and parsed here, on every test run.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync("index.html", "utf8");

/** The inline boot script, by its nonce placeholder. */
function bootScript(): string {
  const match = html.match(/<script nonce="__CSP_NONCE__">([\s\S]*?)<\/script>/);
  assert.ok(match, "the inline boot script is not in index.html — it is the floor under every other guard");
  return match![1];
}

describe("the inline boot layer", () => {
  it("parses", () => {
    const source = bootScript();
    // `new vm.Script` compiles without running, which is exactly the check:
    // a SyntaxError here is a dark screen on every route in production.
    assert.doesNotThrow(() => new vm.Script(source, { filename: "index.html#boot" }));
  });

  it("is ES5, because it runs on whatever browser the failure turned out to be", () => {
    // Comments stripped first: the block is heavily documented and quotes
    // CSS and identifiers in backticks, which is prose rather than syntax.
    const source = bootScript()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    /*
      A syntax error from a modern construct is the same catastrophe as an
      invalid regex, and arrives on exactly the browsers least able to afford
      it. Checked as source text rather than by parsing, since Node would
      happily accept all of it.
    */
    assert.ok(!/=>/.test(source), "no arrow functions");
    assert.ok(!/`/.test(source), "no template literals");
    assert.ok(!/\?\./.test(source), "no optional chaining");
    assert.ok(!/\?\?/.test(source), "no nullish coalescing");
    assert.ok(!/\b(const|let)\s/.test(source), "no block-scoped declarations");
  });

  it("still contains the mechanisms the blank-screen fixes added", () => {
    const source = bootScript();
    // Each of these is load-bearing and each was added in response to a real
    // production failure. A refactor that drops one should fail here.
    assert.match(source, /selfDismiss/, "the shell must be able to dismiss itself without the app's handshake");
    assert.match(source, /watchForCollapse/, "the app disappearing after mount must be detected");
    assert.match(source, /pointerEvents/, "a stuck pointer-transparent curtain must be detected");
    assert.match(source, /addEventListener\(\s*\n?\s*"error"/, "asset load failures must be caught in the capture phase");
    assert.match(source, /unhandledrejection/, "a rejected startup promise must be recorded");
    assert.match(source, /setTimeout\(function \(\) \{\s*\n\s*if \(settled\) return;/, "the failsafe must still be armed");
  });

  it("paints a Football IQ background without the stylesheet", () => {
    /*
      The difference between "white screen" and "dark screen" in every report
      has been whether the external stylesheet arrived. The inline style is what
      makes a missing stylesheet a shabby page instead of a blank one, so the
      background has to be declared in index.html itself.
    */
    const style = html.match(/<style>([\s\S]*?)<\/style>/);
    assert.ok(style, "index.html has no inline style block");
    assert.match(style![1], /body\s*\{[^}]*background:\s*#0d1522/, "body background must be set inline");
    assert.match(style![1], /#boot\s*\{[^}]*position:\s*fixed/, "the shell must be styled without the stylesheet");
    assert.match(style![1], /#boot\[hidden\]\s*\{\s*display:\s*none/, "hiding the shell must beat its own display:flex");
  });
});

describe("full-screen curtains cannot be left on screen", () => {
  /*
    THE ROOT CAUSE OF THE INTERMITTENT BLANK SCREEN, as a rule rather than a
    fix of one instance.

    `.kick` — the quiz's opening whistle — is a 92%-opaque full-screen fixed
    element with `pointer-events: none`, and the only thing that removed it was
    a setTimeout. iOS suspends timers for a backgrounded page, so switching apps
    during the one second it is up left it on screen over a perfectly rendered
    quiz, with nothing to tap and no recovery.

    Any future element of that shape has the same failure mode, so the shape is
    what is tested: if a rule is fixed, full-bleed and pointer-transparent, it
    must carry its own animation that ends hidden — CSS is the only mechanism
    here that survives a suspended page, because an animation is paused and
    resumed where a timer is simply dropped.
  */
  const css = readFileSync("src/client/components/Kickoff.css", "utf8");

  it("the kickoff curtain hides itself with CSS alone", () => {
    const block = css.match(/\.kick\s*\{([\s\S]*?)\}/);
    assert.ok(block, ".kick rule not found");
    assert.match(block![1], /animation:\s*kick-safety/, "the curtain needs its own failsafe animation");
    assert.match(block![1], /pointer-events:\s*none/, "unchanged — but it is why the hit test could not see it");
  });

  it("that animation ends invisible and out of the paint order", () => {
    const frames = css.match(/@keyframes kick-safety\s*\{([\s\S]*?)\n\}/);
    assert.ok(frames, "kick-safety keyframes not found");
    assert.match(frames![1], /100%[^}]*opacity:\s*0/, "it must end fully transparent");
    assert.match(
      frames![1],
      /100%[^}]*visibility:\s*hidden/,
      "opacity 0 alone leaves a full-screen box in the paint order"
    );
  });

  it("the component ends the flourish on a deadline, not only on a timer", () => {
    const tsx = readFileSync("src/client/components/Kickoff.tsx", "utf8");
    assert.match(tsx, /visibilitychange/, "a suspended timer is recovered from when the page comes back");
    assert.match(tsx, /pageshow/, "the back/forward cache restores without visibilitychange");
    assert.match(tsx, /Date\.now\(\)/, "elapsed time must be read, not counted");
  });
});
