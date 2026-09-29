import { Link } from "react-router-dom";
import PullQuote from "@/components/PullQuote";
import Faq from "@/components/Faq";
import { Article } from "../types";
import cover from "@/assets/photos/portrait.jpg";

const meta = {
  slug: "corporate-headshot-lighting-atlanta",
  title: "Corporate Headshot Lighting in Atlanta: A Photographer's Working Method",
  description: "How an Atlanta editorial photographer lights corporate headshots that don't look like corporate headshots — modifiers, ratios, color, and the human variables.",
  datePublished: "2025-10-12",
  dateModified: "2025-10-12",
  author: "Xavier Jordan",
  category: "Corporate",
  tags: ["corporate", "headshots", "lighting", "atlanta", "editorial"],
  coverImage: cover,
  readingTime: "9 min",
};

const article: Article = {
  ...meta,
  body: () => (
    <>
      <p>
        The phrase "corporate headshot" carries a lot of bad photography behind it. Flat key light. A grey backdrop. Eye glare. A smile that arrived three seconds before the shutter and left immediately after. I have spent the past decade trying to make corporate portraits that do not look like that, for Atlanta firms that have stopped accepting it. This piece is the working method.
      </p>

      <p>
        It is partly technical. It is mostly about people. The technical part is reproducible. The human part is the work.
      </p>

      <h2>What I am actually trying to do</h2>

      <p>
        An editorial corporate portrait should do three things on first read: signal seniority without arrogance, signal trust without softness, and look like the same person who showed up to the meeting. If the photograph requires explaining, I have failed. If a client's mother says "that's him," I have succeeded.
      </p>

      <h2>The lighting kit, briefly</h2>

      <p>
        I keep the kit small on purpose. Bigger kits invite over-design. For Atlanta corporate sessions on location — which is most of them — I bring:
      </p>

      <ul>
        <li>One large soft modifier (a 5-foot octa or a deep softbox) as the key.</li>
        <li>A 4x4 negative fill flag to control shadow density.</li>
        <li>A small kicker — bare strobe with a tight grid — for the back of the head when the location demands separation from the wall.</li>
        <li>A continuous LED panel as a hair light for video portraits.</li>
        <li>One reflector. White on one side, silver on the other. The silver almost never comes out.</li>
      </ul>

      <p>
        That is the entire kit for a thirty-person executive shoot. Add a backdrop only when the location does not give us a clean wall.
      </p>

      <h2>Modifier choice is the entire game</h2>

      <p>
        The most important decision in an editorial corporate portrait is the size and distance of the key light. Bigger and closer means softer shadows and more falloff on the rest of the body. Smaller and further means more defined facial structure and a cleaner read of the eyes. There is no universal correct setting. There is a correct setting for the person in front of the camera.
      </p>

      <p>
        For most senior executives I default to a 5-foot octa positioned roughly 45 degrees off-axis, eight to ten inches above eye level, three to four feet from the subject. That gives a strong directional shadow, defines the brow ridge, and keeps catchlights at a believable angle. For founders and creatives I will pull the modifier in closer and lower, soften everything, and let the photograph feel less institutional.
      </p>

      <PullQuote cite="from a session at a Midtown law firm">
        The partner sat down and asked me what to do with his face. I told him: nothing. The light is doing the work. Just look at me when I count to two.
      </PullQuote>

      <h3>Negative fill is the difference between editorial and corporate</h3>

      <p>
        If you remember one technical thing from this article, remember this: a 4x4 black flag on the shadow side, two feet from the subject, is what makes an editorial portrait look editorial. It deepens the shadow side without cutting detail and gives the face dimension that flat-lit headshots cannot achieve. Most photographers skip it because it adds a step. The step is what they are paying you for.
      </p>

      <h2>Color and white balance</h2>

      <p>
        I shoot corporate sessions at a custom Kelvin temperature between 4800 and 5200, slightly cooler than the strobes' native daylight. That gives a small color shift toward the warm end on the skin once I grade in post, which reads as "professional and human" instead of "AI rendered." Pure 5500K under daylight strobes looks too clean for a portrait.
      </p>

      <p>
        For backgrounds I lean into the room when possible. A deep walnut wall, a stone fireplace, a window with city light behind it — these all do more for an editorial corporate portrait than any backdrop. When a backdrop is required, I keep two: a deep charcoal canvas and a warm bone canvas. Grey backdrops belong in 1996.
      </p>

      <h2>The human variables</h2>

      <p>
        Lighting is solvable. People are not. Most professionals over forty have been photographed badly enough times that they have a defensive face they default to under any camera. My job in the first ninety seconds of a session is to break that face. I do this in three ways.
      </p>

      <p>
        First, I do not photograph for the first ninety seconds. I set up the camera, ask them about something specific in their work — not their job, their work — and let them talk while I check exposure. The first frames they think we are taking are actually frames I have already taken.
      </p>

      <p>
        Second, I count. I tell them I will count to two and they should look at the lens on two. The counting gives them a clear job and removes the smile-to-shutter delay that ruins every defensive headshot.
      </p>

      <p>
        Third, I show them the back of the camera once, around frame ten. Not a perfect frame. A frame where they look like themselves. Once they see it, the defensive face dissolves.
      </p>

      <h2>Group portraits, briefly</h2>

      <p>
        For executive group portraits — partners, leadership team, founding team — the rule is simple: stagger heights, vary distance from camera, and never line everyone up at the same depth. A group photographed at a single plane reads as a class photo. A group staggered in depth reads as a portrait.
      </p>

      <h3>What I deliver</h3>

      <p>
        Editorial corporate sessions deliver a small, considered set: a primary portrait, a horizontal alternate, and an environmental wide. Three frames per executive, color-graded, sized for LinkedIn, the firm site, press, and print. More frames than that means the firm has too many options and uses none of them well. The full <Link to="/corporate" className="text-molten underline underline-offset-4">corporate workflow</Link> is on the services page.
      </p>

      <h2>If you want to see what this method produces</h2>

      <p>
        Browse the <Link to="/corporate" className="text-molten underline underline-offset-4">corporate reel</Link>. Test what color does to a portrait by dropping any image into the <Link to="/studio" className="text-molten underline underline-offset-4">Frame Studio</Link> and toggling Buckhead Noir. When you are ready to schedule for your firm, <Link to="/contact" className="text-molten underline underline-offset-4">reserve a session</Link> and tell me how many people, what location, and what the firm is announcing this quarter. We plan around that.
      </p>

      <Faq items={[
        { q: "How long do corporate sessions take per person?", a: "Twelve to fifteen minutes per executive once the lighting is set. A group of ten typically runs three hours including setup, breakdown, and a short break." },
        { q: "Do you photograph at our office or in a studio?", a: "Both. On-location at the office is the default — it gives the firm visual identity and saves your team the travel. I bring a portable studio kit when needed." },
        { q: "Can you match an existing visual brand?", a: "Yes. Send the brand guidelines and current portraits before the session. I match color grade, framing, and tonal language so the new work integrates cleanly." },
      ]} />
    </>
  ),
};

export default article;
