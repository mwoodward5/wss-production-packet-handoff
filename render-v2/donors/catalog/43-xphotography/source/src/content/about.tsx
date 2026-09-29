import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BRAND } from "./brand";

export const aboutMeta = {
  title: "About Xavier Jordan — Atlanta Photographer · XPhotography",
  description: "Atlanta-native editorial photographer Xavier Jordan. Documentary weddings, portraits, families, and brands across Georgia since 2018.",
};

export default function AboutBody(): ReactNode {
  return (
    <>
      <p>
        I'm Xavier Jordan. I'm an Atlanta native, and I have been photographing in this city since {BRAND.yearStarted}. The work began the way most working photographers' work begins — with the people closest to me, on weekends, with a camera I could not really afford. It became a practice the day I realized I was paying attention to the room before anyone else in it.
      </p>
      <p>
        Today I run XPhotography full time. The studio sits in {BRAND.address.neighborhood}, and the work moves across Atlanta most weeks of the year. Weddings make up about half of it. Editorial portraits — for founders, partners, families, and creatives — make up most of the rest. Corporate days for Atlanta firms round out the calendar.
      </p>
      <p>
        I grew up reading the way light moves in this city. The way mid-morning hits Westside brick. The way Buckhead hedges hold shadow at five. The way late summer turns every face the color of warm wood. None of those observations made it into a sentence until later. They made it into the camera first.
      </p>

      <h2 className="font-display text-[1.6875rem] text-ivory mt-12 mb-5">How I work</h2>
      <p>
        Editorial in finish, documentary in spirit. I direct when direction makes the photograph stronger. I disappear when it does not. The first ten minutes of any session are spent letting you forget I am holding a camera. The last ten minutes are usually the strongest frames.
      </p>
      <p>
        I shoot on a small kit of prime lenses — 35mm, 50mm, 85mm — because constraint forces decisions. I work primarily on a {BRAND.gear[0]} body paired with Sony G Master glass, and I bring Profoto strobes when a room needs them. I color-grade every frame personally. Galleries are short on purpose. A wedding day delivers three hundred fifty to four hundred fifty photographs, edited for pacing, not for inflation.
      </p>

      <h2 className="font-display text-[1.6875rem] text-ivory mt-12 mb-5">Background, briefly</h2>
      <p>
        Born and raised in Atlanta, {BRAND.upbringing}. I studied {BRAND.fieldOfStudy} at {BRAND.school} before pivoting fully to photography in {BRAND.yearOfPivot}. The single influence I name most often is {BRAND.influence} — a photographer whose patience taught me that the photograph is almost always one beat after you would have pressed the shutter.
      </p>

      <h2 className="font-display text-[1.6875rem] text-ivory mt-12 mb-5">What I believe about photography</h2>
      <p>
        I believe a photograph is a small act of memory on behalf of someone else. I believe color grade is a finish, not a personality. I believe the frames that hold up over decades are the quiet ones. I believe Atlanta is one of the most under-photographed cities in America by people who actually live here, and I plan to spend a long career fixing that.
      </p>
      <p>
        If you're ready to talk, <Link to="/reserve" className="text-molten underline underline-offset-4">reserve a session</Link>, browse <Link to="/pricing" className="text-molten underline underline-offset-4">pricing</Link>, or <Link to="/contact" className="text-molten underline underline-offset-4">get in touch</Link>.
      </p>
      <p className="font-display italic text-2xl text-molten pt-4">— Xavier Jordan</p>

    </>
  );
}
