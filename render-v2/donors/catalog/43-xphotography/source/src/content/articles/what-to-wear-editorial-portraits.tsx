import { Link } from "react-router-dom";
import PullQuote from "@/components/PullQuote";
import Faq from "@/components/Faq";
import { Article } from "../types";
import cover from "@/assets/photos/portrait.jpg";

const meta = {
  slug: "what-to-wear-editorial-portraits",
  title: "What to Wear for an Editorial Portrait Session",
  description: "An Atlanta photographer's plain-language guide to dressing for editorial portraits — color, texture, fit, and the three things that always photograph badly.",
  datePublished: "2025-10-02",
  dateModified: "2025-10-02",
  author: "Xavier Jordan",
  category: "Portraits",
  tags: ["portraits", "wardrobe", "editorial", "atlanta"],
  coverImage: cover,
  readingTime: "8 min",
};

const article: Article = {
  ...meta,
  body: () => (
    <>
      <p>
        Most clients arrive at a portrait session having spent more time on their outfit than on anything else. That is correct, and it is also the wrong thing to worry about. The outfit is not the photograph. The light is the photograph. The outfit's only job is to not fight the light. Most of what people pick fights the light. This piece is here to fix that.
      </p>

      <p>
        I am writing this from the back of my car on a Tuesday between sessions, so I am going to keep it direct. Twelve years of editorial portraits across Atlanta, and the rules barely change.
      </p>

      <h2>The three things that always photograph badly</h2>

      <p>
        Save yourself a re-shoot. These three never work in editorial portraits.
      </p>

      <ul>
        <li><strong>Pure white in direct sun.</strong> The sensor cannot hold both your face and the shirt. You will lose detail in the fabric or detail in your skin. Pick ivory, cream, oatmeal, or bone instead.</li>
        <li><strong>Tight, busy patterns under three inches across.</strong> Small herringbones, tiny gingham, micro-dot ties. They moiré on a digital sensor and they pull the eye away from your face.</li>
        <li><strong>Logos and bright synthetic colors.</strong> The eye reads them first, before the face. Your portrait becomes a photograph of a logo with a person attached to it.</li>
      </ul>

      <h2>What works, in order of importance</h2>

      <h3>Texture over color</h3>

      <p>
        A single texture in a single color does more for a portrait than five colors in a flat fabric. Linen, cashmere, wool, raw silk, brushed cotton, leather. Texture catches light from different angles and gives the photograph dimension. A flat polyester shirt absorbs light and goes dead.
      </p>

      <p>
        If you take one rule from this guide: pick the most interesting fabric you own and build the outfit around it.
      </p>

      <h3>Mid-tones over extremes</h3>

      <p>
        Editorial portraits live in mid-tones. Olive, charcoal, oxblood, espresso, camel, deep navy, dusty rose, terra cotta, ivory. These are colors the camera can hold without crushing or blowing out. They also flatter most skin tones because they push warmth back into the face instead of competing with it.
      </p>

      <PullQuote cite="said to a CEO before a brand session">
        Wear what you would wear to dinner with someone you respect, not what you would wear to a meeting you want to win.
      </PullQuote>

      <h3>Fit over fashion</h3>

      <p>
        Tailoring matters more than label. A fifty-dollar shirt that fits in the shoulders will out-photograph a five-hundred-dollar shirt that does not. The single most-noticeable thing on camera is shoulder seam placement. If your shoulder seam falls past the edge of your actual shoulder, the camera reads "too big." If it falls inside the shoulder, the camera reads "too tight." It should land at the corner.
      </p>

      <h2>Building an outfit for a session, step by step</h2>

      <p>
        Here is how I tell people to build a portrait outfit when they ask. It works for headshots, brand portraits, family sessions, and engagements.
      </p>

      <ol>
        <li>Pick the location and the season first. Atlanta in October needs a layer. Atlanta in July needs breathable fabric. The location dictates whether you have brick, hedge, or skyline behind you, and the wardrobe needs to contrast with that backdrop.</li>
        <li>Pick the most interesting texture you own as the hero piece. A wool overcoat, a knit turtleneck, a leather jacket, a heavy linen shirt, a vintage denim jacket.</li>
        <li>Build the rest in tones that contrast gently with the hero. Not high contrast. Adjacent tones — espresso with camel, navy with stone, charcoal with ivory.</li>
        <li>Add one accent with weight. A scarf, a hat, a watch, a structured bag. Accents anchor the eye.</li>
        <li>Choose shoes you can actually walk in. Editorial sessions move. We are not standing in one spot.</li>
      </ol>

      <h2>For couples</h2>

      <p>
        Coordinate, do not match. Couples in identical colors flatten the photograph. Pick a palette of three to four tones from the same family and split them between you. If she is in cream and camel, he is in espresso and oatmeal. If he is in deep olive and brown, she is in rust and ivory. The eye should read "they belong together," not "they shopped together."
      </p>

      <h3>For families</h3>

      <p>
        Same rule scaled. Pick four to five tones from one family and let everyone choose within the family. Avoid putting any single person in the strongest color in the group — it pulls the eye and breaks the family read. Children look best in textures with a bit of give: cotton knits, linen blends, chunky wool. Stiff fabrics look uncomfortable on small bodies and the photograph reads as posed.
      </p>

      <h2>For corporate and brand portraits</h2>

      <p>
        Editorial brand portraits are not headshots. The wardrobe should signal the level you are operating at, not the role on a business card. A founder of a design studio wears the jacket she would wear to dinner with a major client. A managing partner at a law firm wears the suit he would wear to court, not the one he wears in the office. The piece on <Link to="/journal/corporate-headshot-lighting-atlanta" className="text-molten underline underline-offset-4">corporate headshot lighting</Link> goes deeper on the technical side. For wardrobe specifically: one strong piece, neutral around it, no logos.
      </p>

      <h2>What to bring on the day</h2>

      <ul>
        <li>The outfit you decided on the night before, ironed.</li>
        <li>One backup top in a different tone, in case the first one looks wrong on the day.</li>
        <li>A lint roller. Atlanta is a humid city full of pollen, dog hair, and the dust that lives in every closet.</li>
        <li>Translucent powder if your skin tends to shine. Not foundation — powder.</li>
        <li>Water and a snack. Hunger reads on the face before anywhere else.</li>
      </ul>

      <h2>If you want to see what color does</h2>

      <p>
        Drop one of your own outfit photos into the <Link to="/studio" className="text-molten underline underline-offset-4">Frame Studio</Link> and try it through Ivory Linen and Buckhead Noir. You will see immediately how a grade reads texture versus pattern. Then browse the <Link to="/portraits" className="text-molten underline underline-offset-4">portraits reel</Link>. When you are ready to plan a session, <Link to="/contact" className="text-molten underline underline-offset-4">reserve here</Link>.
      </p>

      <Faq items={[
        { q: "Should I get my hair and makeup done?", a: "For editorial portraits, professional hair and makeup is worth it but not required. Look for a stylist who shoots editorial regularly — wedding-day makeup is too heavy for portraits in natural light." },
        { q: "Can I bring multiple outfit changes?", a: "Yes. Two outfits inside a ninety-minute session is normal, three is the maximum. Pick a strong primary and a contrasting secondary in a different palette." },
        { q: "What if I do not like how I look in photos?", a: "Most people who think this have only seen themselves in bad photographs. Light, lens choice, and direction do most of the work. Bring trust, and we build from there." },
      ]} />
    </>
  ),
};

export default article;
