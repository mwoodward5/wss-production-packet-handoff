import { Link } from "react-router-dom";
import PullQuote from "@/components/PullQuote";
import Faq from "@/components/Faq";
import { Article } from "../types";
import cover from "@/assets/photos/wedding.jpg";

const meta = {
  slug: "cinematic-wedding-storytelling",
  title: "Cinematic Wedding Storytelling: How a Wedding Becomes a Film",
  description: "What it actually means to photograph a wedding cinematically — pacing, frame language, color, and the difference between drama and noise.",
  datePublished: "2025-10-22",
  dateModified: "2025-10-22",
  author: "Xavier Jordan",
  category: "Weddings",
  tags: ["weddings", "cinematic", "editorial", "storytelling", "atlanta"],
  coverImage: cover,
  readingTime: "9 min",
};

const article: Article = {
  ...meta,
  body: () => (
    <>
      <p>
        "Cinematic" is the most over-used word in wedding photography. It usually means the photographer applied a teal-and-orange grade in Lightroom and called it a day. Cinematic is not a filter. It is a way of seeing — pacing, frame language, restraint, and a willingness to let a photograph breathe. This piece is about what it actually takes to make a wedding feel like a film.
      </p>

      <h2>A film has pacing. So does a wedding gallery.</h2>

      <p>
        The most common mistake in wedding galleries is treating every frame with equal weight. Five hundred photographs, all roughly the same size, all roughly the same crop, scrolled through on a phone. That is a slideshow, not a film. Films alternate. They open wide, hold on a face, cut to a hand, return to wide. The cumulative effect is rhythm. Rhythm is what makes you feel something.
      </p>

      <p>
        I edit wedding galleries with the same instinct. A wide of the church exterior. A close of a hand on a missal. A medium of a guest laughing. A held wide of the aisle as the bride begins to walk. The order matters. The rests matter. A gallery that knows when to be quiet is a gallery you remember.
      </p>

      <h2>Frame language: what each lens says</h2>

      <p>
        Different focal lengths do different psychological things. Cinematographers know this. Wedding photographers often forget.
      </p>

      <ul>
        <li><strong>28mm and wider</strong> says "you are inside the room." It pulls the viewer into the scene as a participant.</li>
        <li><strong>35mm</strong> says "you are an observer at the edge of the room." It is the documentary lens. Most of my wedding day lives on 35mm.</li>
        <li><strong>50mm</strong> says "you are sitting across the table." It is the conversation lens. First looks, vows, intimate moments.</li>
        <li><strong>85mm</strong> says "you are watching from a respectful distance." Ceremony close-ups, parents during the vows, reactions during the toasts.</li>
        <li><strong>135mm</strong> says "you do not know I am here." For the ceremony itself, when stepping closer would intrude.</li>
      </ul>

      <p>
        A cinematic wedding rotates through this range deliberately. Not because variety is fashionable but because each focal length creates a different relationship between viewer and subject, and the gallery needs all of them.
      </p>

      <h2>Color is a narrative tool</h2>

      <p>
        Editorial color grading is not about preset packs. It is about deciding what story the day is telling and grading toward that story. A late-October wedding at a working farm gets a warmer, slightly desaturated grade — the colors of the season, held back so the people stay the loudest thing in the frame. A spring black-tie reception in a downtown hotel gets a cooler, cleaner grade with deeper shadows — the colors of the architecture, sharpened.
      </p>

      <PullQuote cite="from a wedding outside Athens, GA">
        She walked out of the chapel and the sky behind her had gone exactly the color of the inside of her bouquet. I waited the extra three seconds. The photograph is the three seconds.
      </PullQuote>

      <p>
        Consistency inside the gallery is the rule. The grade carries from the morning prep through the dance floor without resetting. If the grade resets between sections, the gallery feels like four different photographers worked the day.
      </p>

      <h2>What to leave out</h2>

      <p>
        A cinematic gallery is short. Three hundred fifty to four hundred fifty frames for a full wedding day is enough. More than that and the gallery loses pacing. Less than that and you start cutting moments that mattered. The hard part of editing is throwing away frames that are technically good in service of the gallery's rhythm.
      </p>

      <p>
        Specifically: I cut almost all the staged ceremony reaction frames where the timing was a half-second off. I cut the third-best frame of every smile. I cut every dance-floor frame where someone is mid-blink. I keep the imperfect frames where the moment is unmistakable — the photograph that is slightly soft because the dad turned at the wrong instant, but his face is the entire wedding.
      </p>

      <h2>Sound shapes a film. So does silence in a gallery.</h2>

      <p>
        I leave deliberate empty pages in printed wedding albums. A spread of one full-bleed photograph and one blank page. The blank page is not wasted real estate. It is the held breath. Fast-paced wedding albums with eight images per spread are slideshows on paper. They do not stay on coffee tables.
      </p>

      <h3>What goes on the wall</h3>

      <p>
        Roughly five frames from a wedding day are wall photographs. Maybe seven. They are usually quiet — the bride looking at herself in a mirror before the dress comes on, a parent holding the back of a chair during the ceremony, the couple alone in a hallway between the ceremony and the reception. The dance-floor frame goes in the album. The hallway frame goes on the wall.
      </p>

      <h2>The role of the photographer in a cinematic wedding</h2>

      <p>
        I work quietly. I rarely speak above a low voice. I do not direct during the ceremony. I direct sparingly during portraits and the rest of the time I am present, watching, and waiting for the frame that is already happening. The whole approach is described on the <Link to="/weddings" className="text-molten underline underline-offset-4">weddings services page</Link>, but the short version is this: I am there to remember the day the way it actually felt, not to perform photography during it.
      </p>

      <p>
        Couples who want a director, a hype-person, or a "let's all do something fun" photographer should hire a different photographer. Couples who want their wedding remembered the way they will tell it to their grandchildren — that is the work.
      </p>

      <h2>If you want to feel the difference</h2>

      <p>
        Browse the <Link to="/portfolio" className="text-molten underline underline-offset-4">full portfolio</Link>. Read the <Link to="/journal/atlanta-wedding-photographer-guide" className="text-molten underline underline-offset-4">Atlanta wedding photographer guide</Link> for the planning side. Try the <Link to="/studio" className="text-molten underline underline-offset-4">Frame Studio</Link> with a photo from your own life and see how a cinematic grade changes what the image tells you. When you are ready, <Link to="/contact" className="text-molten underline underline-offset-4">reserve a wedding</Link>.
      </p>

      <Faq items={[
        { q: "Do you provide a highlight film as well?", a: "I am a stills photographer. I work alongside videographers regularly and can recommend collaborators whose pacing matches the way I shoot." },
        { q: "Can I see a full gallery instead of a highlight set?", a: "Yes. I send full recent galleries during the consult so you can see how the work holds at scale, not just the greatest hits." },
        { q: "How long until we get our wedding gallery?", a: "Four to six weeks for a fully edited and color-graded gallery. A small preview set is sent within the first week." },
      ]} />
    </>
  ),
};

export default article;
