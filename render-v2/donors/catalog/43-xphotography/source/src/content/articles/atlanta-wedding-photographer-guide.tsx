import { Link } from "react-router-dom";
import PullQuote from "@/components/PullQuote";
import Faq from "@/components/Faq";
import { Article } from "../types";
import cover from "@/assets/photos/wedding.jpg";

const meta = {
  slug: "atlanta-wedding-photographer-guide",
  title: "An Atlanta Wedding Photographer's Guide to Light, Venues, and the Hour Before",
  description: "How an Atlanta editorial wedding photographer reads light at city venues, plans the day around it, and keeps the camera quiet enough to remember.",
  datePublished: "2025-09-12",
  dateModified: "2025-09-12",
  author: "Xavier Jordan",
  category: "Weddings",
  tags: ["weddings", "atlanta", "editorial", "documentary", "lighting"],
  coverImage: cover,
  readingTime: "9 min",
};

const article: Article = {
  ...meta,
  body: () => (
    <>
      <p>
        I have photographed weddings across Atlanta for years, and I have learned that the day is never won by the camera. It is won by paying attention long before anyone presses a shutter. The bouquet is set down on a bedside table at 11:48. The groom's father loosens his tie at 4:13. The light through the Swan House dining room turns gold at 5:34 in late September and lavender by 6:09. None of those minutes belong to me. My job is to know they are coming.
      </p>

      <p>
        This guide is for couples planning a wedding in Atlanta who want to understand how an editorial wedding photographer thinks. Not pose ideas. Not Pinterest boards. Just the things that actually decide whether your photos hold up in a frame on your wall ten years from now.
      </p>

      <h2>Atlanta light has a personality</h2>

      <p>
        Atlanta sits on a plateau of red clay, hardwoods, and a humid sky that diffuses the sun like a softbox most of the year. That gives us something rare: a long, forgiving golden hour and a midday sun that, while strong, rarely goes nuclear the way it does in West Texas or Phoenix. In June you have usable directional light from about 7:45 a.m. until almost 8:45 p.m. In December the window narrows to roughly 8:30 a.m. to 5:00 p.m., with golden hour starting around 4:00.
      </p>

      <p>
        That window is the most important sentence in your timeline. If your ceremony is at 6:30 in October, the portraits made between 5:00 and 5:45 will be the ones you frame. Plan backwards from that. Hair and makeup, the first look, family formals — every block compresses or stretches around protecting the gold.
      </p>

      <h3>Reading windows before the day</h3>

      <p>
        I walk every wedding venue at least once before the date, ideally at the same hour the ceremony will run. I am looking at three things: where the largest north-facing window opens onto a clean wall, where the warm afternoon light raked across a textured material like brick or limestone, and where the venue's interior light fights with the daylight. Most venue tours skip all of this. They show you the bar.
      </p>

      <h2>Atlanta venues, and what they actually give you</h2>

      <p>
        Every venue in this city has a personality, and that personality decides what kind of photographs you will leave with. A few notes from the field, from a photographer's eye, not a planner's.
      </p>

      <p>
        <strong>Swan House at the Atlanta History Center</strong> gives you architectural symmetry, gardens with depth, and a staircase that is unforgivable to a photographer who does not understand symmetry. Late afternoon ceremonies on the back lawn put the sun behind the couple at the right angle if you book the right month.
      </p>

      <p>
        <strong>Summerour Studio</strong> is a brick warehouse on the Westside with an enormous window wall facing the rooftop. That window wall is the entire reason to book it for a portrait session. Stand the couple ten feet inside the window with no flash and the photograph already exists.
      </p>

      <p>
        <strong>The Estate</strong> on Piedmont gives you a manicured garden, a long ballroom, and a portico that is genuinely difficult to light at sunset because of the way the columns cut the sky. It is doable. It just requires planning and a second photographer.
      </p>

      <p>
        <strong>Ventanas</strong> downtown gives you skyline. That is its gift and its problem. Skyline photography requires you to be on the rooftop fifteen minutes before official sunset, not at sunset.
      </p>

      <p>
        <strong>The Stave Room</strong> and <strong>The Goat Farm</strong> give you texture: barrel staves, raw brick, mossy concrete. Texture is what makes a photograph readable on a wall instead of vanishing into the noise of a gallery.
      </p>

      <PullQuote cite="Xavier Jordan, on the day before a wedding">
        The wedding is photographed during the rehearsal. By the time the music starts, the camera should already know where it stands.
      </PullQuote>

      <h2>The hour before the ceremony</h2>

      <p>
        If I had to keep one hour of every wedding day, it would be the sixty minutes before the ceremony begins. The room is calm. The bride or groom is alone with a parent or a closest friend. Someone fixes a cuff. Someone sits down because they cannot anymore. The photographs from that hour are the photographs that travel best to a frame on your wall, because they hold something the public part of the day will not.
      </p>

      <p>
        I plan that hour deliberately. We block ten minutes for a quiet portrait in the best window light I scouted. We leave thirty minutes for the people in the room to do whatever they need to do. I am present and quiet. The camera is in my hand at chest height. I am not directing.
      </p>

      <h2>What documentary actually means</h2>

      <p>
        Documentary does not mean uninvolved. It means I will direct when direction makes the photograph stronger and disappear when it does not. A first look gets gentle staging — angle, distance, one cue about timing. A father seeing his daughter for the first time gets nothing from me. The photograph is already happening. My only job is to be in the right spot, with the right lens, with the camera awake.
      </p>

      <p>
        If you want to understand the line I draw, it is this: I will move you for light, but I will not move you for emotion. The emotion is yours.
      </p>

      <h2>How to talk to your photographer before booking</h2>

      <p>
        A few questions that will tell you more about a wedding photographer than any portfolio:
      </p>

      <ul>
        <li>Walk me through how you build a timeline around light.</li>
        <li>What lens do you keep on the camera during the ceremony, and why?</li>
        <li>How do you handle the first thirty minutes of the reception?</li>
        <li>How many frames does a typical wedding deliver, and what is your reasoning behind that number?</li>
        <li>What is one wedding you photographed that you would shoot differently today?</li>
      </ul>

      <p>
        The answer to the last question is the most revealing. A photographer who cannot name something they would change is either lying or not paying attention. Both are bad signs.
      </p>

      <h2>If you want to see what I mean</h2>

      <p>
        The best way to feel the difference is to look at frames in motion. Browse the <Link to="/weddings" className="text-molten underline underline-offset-4">weddings reel</Link>, then put one of your own photos through the <Link to="/studio" className="text-molten underline underline-offset-4">Frame Studio</Link> to see what an editorial grade does to color and contrast. When you are ready to talk about your date, <Link to="/contact" className="text-molten underline underline-offset-4">reserve a session</Link> and tell me what time the ceremony begins. Everything else, we plan from there.
      </p>

      <Faq items={[
        { q: "How early should we book a wedding photographer in Atlanta?", a: "For Saturdays in April, May, October and November, six to twelve months ahead is normal. For peak weekends I take a small number of weddings each year and close the calendar quickly." },
        { q: "Do you travel outside Atlanta?", a: "Yes. Statewide travel is included in most packages. Out-of-state and international weddings are quoted with travel and a planning consult included." },
        { q: "What happens if it rains?", a: "We have a rain plan from the first conversation. Diffused overcast light is often better for portraits than direct sun. The day still works." },
      ]} />
    </>
  ),
};

export default article;
