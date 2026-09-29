import { Link } from "react-router-dom";
import PullQuote from "@/components/PullQuote";
import Faq from "@/components/Faq";
import { Article } from "../types";
import cover from "@/assets/photos/hero.jpg";

const meta = {
  slug: "choosing-an-atl-wedding-photographer",
  title: "Choosing an Atlanta Wedding Photographer: A Practical Filter",
  description: "How to evaluate Atlanta wedding photographers without Pinterest, Instagram, or wedding-industry awards. Five filters that actually predict the gallery you will receive.",
  datePublished: "2025-11-02",
  dateModified: "2025-11-02",
  author: "Xavier Jordan",
  category: "Weddings",
  tags: ["weddings", "atlanta", "hiring", "guide"],
  coverImage: cover,
  readingTime: "8 min",
};

const article: Article = {
  ...meta,
  body: () => (
    <>
      <p>
        Choosing a wedding photographer in Atlanta is one of the harder vendor decisions a couple makes, and most of the advice online does not help. Pinterest favors photographers who shoot for Pinterest. Instagram favors photographers who shoot for Instagram. Wedding-industry awards are mostly pay-to-enter. None of those signals predict the gallery you will actually receive ten weeks after your wedding.
      </p>

      <p>
        These are the five filters I would use if I were hiring a wedding photographer for my own wedding. They have nothing to do with style and everything to do with judgment.
      </p>

      <h2>Filter one: Look at full galleries, not portfolios</h2>

      <p>
        Every wedding photographer in Atlanta has a portfolio of fifteen extraordinary frames. Almost no wedding photographer in Atlanta has a hundred extraordinary frames in a row. Ask to see two or three full galleries — every photograph delivered, not just the highlight set. Look for consistency. Look for whether the bad-light photographs (the harsh sun at noon, the over-lit reception room) hold up. Look at the grandparents' formal portraits, which most photographers treat as an obligation. The grandparents' portraits will tell you everything.
      </p>

      <p>
        If a photographer hesitates to send full galleries, they know something you should know.
      </p>

      <h2>Filter two: Read how they communicate, not what they say</h2>

      <p>
        The way a photographer responds to your first email is the way they will respond to every email for the next eighteen months. Look for: speed (within twenty-four hours is the floor), specificity (do they answer your actual questions or send a brochure), and tone (does the email sound like a person or a template).
      </p>

      <p>
        Plan a phone call before booking. Fifteen minutes is enough. You are not auditioning their photography on the call. You are auditioning whether you want this person walking around your hotel room while you get dressed. If the energy on the call is wrong, the energy on the day will be wrong.
      </p>

      <h2>Filter three: Ask about timeline thinking</h2>

      <p>
        Ask the photographer to walk you through how they would build the day around your venue and your ceremony time. A photographer who thinks in timelines understands light. A photographer who answers in pricing tiers does not.
      </p>

      <p>
        Specifically, listen for whether they bring up the position of the sun, the windows in the bridal suite, the direction the ceremony faces, and where the family formals would happen. If the answer is "we'll figure that out closer to the day," book someone else. The day is figured out three months before the day.
      </p>

      <PullQuote cite="advice given in a consult last winter">
        Hire the photographer who asks better questions than you do. The questions are the work.
      </PullQuote>

      <h2>Filter four: Check the contract, not the price</h2>

      <p>
        A clean wedding photography contract should answer five questions in plain language: what is delivered, when, in what format, what happens if the photographer cannot make the day, and what rights you have to the images. If any of those answers are vague or missing, fix them before signing — or hire a photographer whose contract already addresses them.
      </p>

      <p>
        Specifically, look for: a named backup photographer protocol in case of emergency, a clear delivery window for the gallery (not "as soon as possible"), full personal-use print rights included, and a cancellation/postponement clause that works in both directions. Most disputes between couples and wedding photographers come from contracts that left everything to good faith.
      </p>

      <h2>Filter five: Look at the photographer's life, not the brand</h2>

      <p>
        The photographer you hire on Saturday is the same human all week. Look at who they are when the camera is down. Are they a working photographer who shoots editorial, brand, or portraits during the week, or are they someone who only photographs weddings? Both can be excellent. The first usually has a stronger overall visual literacy. The second usually has more reps inside the specific theater of a wedding day. Decide which mix fits your day.
      </p>

      <p>
        The <Link to="/about" className="text-molten underline underline-offset-4">About page</Link> is where to start. If the page is a brand statement, you are looking at a brand. If the page is a person, you are looking at a person.
      </p>

      <h2>What you can ignore</h2>

      <ul>
        <li><strong>Award badges.</strong> Most are paid placements or peer-judged contests with low signal.</li>
        <li><strong>Instagram follower count.</strong> The photographers with the most followers are usually the photographers who post the most, not the photographers who shoot the best weddings.</li>
        <li><strong>"Featured in" lists.</strong> Most wedding blogs publish anyone who submits a clean gallery. It is a curation signal, not a quality signal.</li>
        <li><strong>Sample album mockups.</strong> Every studio uses the same three album companies. The album is the printer's work, not the photographer's.</li>
      </ul>

      <h2>How to make the final decision</h2>

      <p>
        After you have run two or three photographers through these filters, the answer is usually obvious. If it is still not obvious, sit with the full galleries from each photographer for a week. Open them on a Tuesday morning when nothing is happening. Look at the grandparents. Look at the moment after the ceremony when the couple is walking back up the aisle. Look at the third dance of the night, when most photographers have run out of attention. The photographer whose work still feels alive in those frames is the photographer to hire.
      </p>

      <h2>If you want to test the filters on me</h2>

      <p>
        Send a real email about your real wedding from the <Link to="/contact" className="text-molten underline underline-offset-4">contact page</Link>. Read how I respond. Browse a full <Link to="/portfolio" className="text-molten underline underline-offset-4">portfolio</Link>. Read the <Link to="/journal/cinematic-wedding-storytelling" className="text-molten underline underline-offset-4">cinematic wedding piece</Link> to understand how I edit. If the answers feel right, we put a date on the calendar. If they feel wrong, you have at least sharpened your filter for the next conversation.
      </p>

      <Faq items={[
        { q: "Should we ask for references from past couples?", a: "Yes, and any photographer worth hiring will provide them. Ask the references about communication during the planning year, not the wedding day itself." },
        { q: "Is the most expensive photographer the best photographer?", a: "Not always, but very rarely is the cheapest the best. Wedding photography pricing tracks loosely with experience, demand, and the cost of running a real business that will still exist in ten years to send you reprints." },
        { q: "How many photographers should we meet before booking?", a: "Two or three is usually enough. More than five and you are not deciding, you are stalling." },
      ]} />
    </>
  ),
};

export default article;
